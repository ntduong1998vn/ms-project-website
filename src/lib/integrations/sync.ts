import type { ILink, ITask } from '@svar-ui/react-gantt'
import type { GanttResource } from '@/types/gantt'
import type {
  IntegrationFieldMapping,
  RemoteFieldDescriptor,
  RemoteFieldValueType,
  RemoteIssue,
  SyncTaskField,
} from '@/lib/integrations/types'
import { parseLocalDate } from '@/lib/integrations/fields'
import {
  autoScheduleTasks,
  calculateEndDate,
  calculateTaskDuration,
  getNextWorkingDay,
  inclusiveFinishToExclusiveEnd,
  type ProjectCalendarConfig,
} from '@/lib/scheduler'
import { getNextNumericTaskId, hasParentCycle, sameTaskId } from '@/lib/task-helpers'

export type RemoteSyncResult =
  | { kind: 'success'; tasks: ITask[]; links: ILink[]; resources: GanttResource[]; inserted: number; updated: number }
  | { kind: 'no-issues' }

type RemoteEntry = {
  issue: RemoteIssue
  existing: ITask | undefined
  id: string | number
  type: ITask['type']
}

type RemoteSuccessor = { key: string; delay: number }

/** Tasks not yet linked to a remote issue of this provider — candidates for Push New. */
export function unlinkedTasks(tasks: ITask[], providerId: string): ITask[] {
  return tasks.filter((task) => task.externalSource !== providerId || !task.externalKey)
}

/** Tasks already linked to a remote issue of this provider — candidates for Sync. */
export function linkedTasks(tasks: ITask[], providerId: string): ITask[] {
  return tasks.filter((task) => task.externalSource === providerId && !!task.externalKey)
}

export function applyRemoteIssues(
  issues: RemoteIssue[],
  descriptors: RemoteFieldDescriptor[],
  mapping: IntegrationFieldMapping,
  existing: { tasks: ITask[]; links: ILink[]; resources: GanttResource[] },
  providerId: string,
  calendarConfig: ProjectCalendarConfig,
  durationUnit: 'day' | 'hour',
  isAutoSchedule: boolean
): RemoteSyncResult {
  if (issues.length === 0) return { kind: 'no-issues' }

  // 1. Match remote issues to existing tasks by external identity.
  const existingByKey = new Map<string, ITask>()
  for (const task of existing.tasks) {
    if (task.id !== undefined && task.externalSource && task.externalKey) {
      const key = `${task.externalSource}:${task.externalKey}`
      if (!existingByKey.has(key)) existingByKey.set(key, task)
    }
  }

  // 2. Field readers: mapping.fields[taskField] -> remote key -> issue value.
  const descriptorByKey = new Map<string, RemoteFieldDescriptor>()
  for (const descriptor of descriptors) {
    if (!descriptorByKey.has(descriptor.key)) descriptorByKey.set(descriptor.key, descriptor)
  }
  const field = (issue: RemoteIssue, taskField: SyncTaskField): unknown => {
    const key = mapping.fields[taskField]
    return key === null ? undefined : issue.fields[key]
  }
  const valueType = (taskField: SyncTaskField): RemoteFieldValueType => {
    const key = mapping.fields[taskField]
    return (key !== null && descriptorByKey.get(key)?.valueType) || 'string'
  }
  const toDate = (value: unknown): Date | undefined => {
    if (typeof value !== 'string' || value.trim() === '') return undefined
    const date = parseLocalDate(value)
    return Number.isNaN(date.getTime()) ? undefined : date
  }

  // 3. Pass 1 — classify update vs insert; assign numeric ids to inserts.
  // keyToTaskId covers EVERY task linked to this provider (not only issues in
  // this fetch — parents/successors may reference previously-synced tasks).
  const keyToTaskId = new Map<string, string | number>()
  for (const task of existing.tasks) {
    if (task.id !== undefined && task.externalSource === providerId && task.externalKey) {
      keyToTaskId.set(String(task.externalKey), task.id)
    }
  }
  const usedIds = new Set<string>()
  for (const task of existing.tasks) {
    if (task.id !== undefined) usedIds.add(String(task.id))
  }
  const entries: RemoteEntry[] = issues.map((issue) => {
    const matched = existingByKey.get(`${providerId}:${issue.key}`)
    let id: string | number
    if (matched) {
      id = matched.id as string | number
    } else {
      id = getNextNumericTaskId(existing.tasks)
      while (usedIds.has(String(id))) id = (id as number) + 1
      usedIds.add(String(id))
    }
    keyToTaskId.set(issue.key, id)
    const typeValue = String(field(issue, 'type') ?? '').toLowerCase()
    const type: ITask['type'] =
      typeValue === 'summary' || typeValue === 'milestone' ? typeValue : (matched?.type ?? 'task')
    return { issue, existing: matched, id, type }
  })

  const typeById = new Map<string, ITask['type']>()
  for (const task of existing.tasks) {
    if (task.id !== undefined) typeById.set(String(task.id), task.type ?? 'task')
  }
  for (const entry of entries) typeById.set(String(entry.id), entry.type)

  // 4. Pass 2 — resolve parents. Seed with existing parent links so cycle
  // checks see the full post-sync hierarchy.
  const parents = new Map<string, string | number>()
  for (const task of existing.tasks) {
    if (task.id !== undefined && task.parent !== undefined) parents.set(String(task.id), task.parent)
  }
  for (const entry of entries) {
    if (mapping.fields.parent === null) continue
    const rawParent = field(entry.issue, 'parent')
    if (rawParent === undefined || rawParent === null || rawParent === '') {
      // Remote says root issue — clear the local parent on updates.
      if (entry.existing) parents.delete(String(entry.id))
      continue
    }
    const parent = keyToTaskId.get(String(rawParent))
    if (
      parent !== undefined &&
      typeById.get(String(parent)) !== 'milestone' &&
      !sameTaskId(parent, entry.id) &&
      !hasParentCycle(entry.id, parent, parents)
    ) {
      parents.set(String(entry.id), parent)
    }
    // Unresolvable parent key: leave existing parent unchanged (update) / unset (insert).
  }
  const parentIds = new Set(Array.from(parents.values(), (parent) => String(parent)))

  // 5. Resource resolution: externalKey match, then label (case-insensitive),
  // then create. NOTE: assigned_to/assigned_to_id are Redmine-specific keys
  // inside the provider-agnostic engine — acceptable for v1.
  const nextResources = [...existing.resources]
  const resourceIdsByName = new Map<string, number>()
  for (const resource of nextResources) {
    const key = resource.label.trim().toLowerCase()
    if (key && !resourceIdsByName.has(key)) resourceIdsByName.set(key, resource.id)
  }
  let nextResourceId = nextResources.reduce((max, resource) => Math.max(max, resource.id), 0) + 1
  const resolveResource = (name: string | undefined, externalKey: string | undefined): number | undefined => {
    if (externalKey !== undefined) {
      const byKey = nextResources.find(
        (resource) => resource.externalSource === providerId && resource.externalKey === externalKey
      )
      if (byKey) return byKey.id
    }
    const labelKey = name?.trim().toLowerCase()
    if (labelKey) {
      const byName = resourceIdsByName.get(labelKey)
      if (byName !== undefined) return byName
    }
    if (externalKey === undefined && !labelKey) return undefined
    const createdId = nextResourceId
    nextResourceId += 1
    const created: GanttResource = { id: createdId, label: name ?? `User #${externalKey}` }
    if (externalKey !== undefined) {
      created.externalSource = providerId
      created.externalKey = externalKey
    }
    nextResources.push(created)
    if (labelKey) resourceIdsByName.set(labelKey, createdId)
    return createdId
  }

  // 6. Pass 3 — build updated copies of existing tasks and new inserted tasks.
  const updatesById = new Map<string, ITask>()
  const insertedTasks: ITask[] = []
  let inserted = 0
  let updated = 0
  for (const entry of entries) {
    const { issue, existing: matched, id, type } = entry

    const parsedStart = toDate(field(issue, 'start'))
    const start = parsedStart ?? (matched?.start ? new Date(matched.start) : getNextWorkingDay(new Date(), calendarConfig))

    // The remote end field is an INCLUSIVE finish date.
    const parsedFinish = toDate(field(issue, 'end'))
    let end: Date | undefined
    let endResolved = false
    if (parsedFinish) {
      const exclusiveEnd = inclusiveFinishToExclusiveEnd(parsedFinish)
      if (exclusiveEnd.getTime() >= start.getTime()) {
        end = exclusiveEnd
        endResolved = true
      }
    }

    // Duration resolves AFTER start/end: imported dates are authoritative, then
    // the mapped duration field (hours convert to the duration unit), then
    // existing/default. Milestones are always 0; other tasks clamp to >= 1.
    const rawDuration = field(issue, 'duration')
    const numericDuration = typeof rawDuration === 'number' && Number.isFinite(rawDuration) ? rawDuration : undefined
    let duration: number
    if (type === 'milestone') {
      duration = 0
    } else if (endResolved && end!.getTime() > start.getTime()) {
      duration = calculateTaskDuration(start, end!, calendarConfig, durationUnit)
    } else if (numericDuration !== undefined && valueType('duration') === 'hours') {
      duration =
        durationUnit === 'hour'
          ? numericDuration
          : Math.max(1, Math.ceil(numericDuration / calendarConfig.workingHoursPerDay))
    } else if (numericDuration !== undefined) {
      duration = numericDuration
    } else {
      duration = matched?.duration ?? 1
    }
    if (type !== 'milestone') duration = Math.max(1, duration)

    if (type === 'milestone') {
      end = start
    } else if (!endResolved && duration > 0) {
      end = calculateEndDate(start, duration, calendarConfig, durationUnit)
    }

    const rawProgress = field(issue, 'progress')
    const numericProgress = typeof rawProgress === 'number' && Number.isFinite(rawProgress) ? rawProgress : undefined
    const progress =
      numericProgress !== undefined ? Math.min(100, Math.max(0, numericProgress)) : (matched?.progress ?? 0)

    const rawText = field(issue, 'text')
    const text = typeof rawText === 'string' && rawText !== '' ? rawText : (matched?.text ?? `Issue #${issue.key}`)

    const rawDetails = field(issue, 'details')
    const details = typeof rawDetails === 'string' ? rawDetails : undefined

    const parent = parents.get(String(id))

    const resourcesMapped = mapping.fields.resources !== null
    let resources: number[] | undefined
    if (resourcesMapped) {
      const rawAssigned = field(issue, 'resources')
      const rawAssignedId = issue.fields['assigned_to_id']
      const name = typeof rawAssigned === 'string' && rawAssigned !== '' ? rawAssigned : undefined
      const externalKey =
        typeof rawAssignedId === 'number' && Number.isFinite(rawAssignedId) ? String(rawAssignedId) : undefined
      const resourceId = resolveResource(name, externalKey)
      resources = resourceId !== undefined ? [resourceId] : []
    }

    if (!matched) {
      inserted += 1
      const task: ITask = {
        id,
        text,
        start,
        end,
        duration,
        progress,
        type,
        open: type === 'summary' || parentIds.has(String(id)),
        externalSource: providerId,
        externalKey: issue.key,
      }
      if (parent !== undefined) task.parent = parent
      if (resources && resources.length > 0) task.resources = resources
      if (details !== undefined && details !== '') task.details = details
      for (const key of mapping.extraFields) {
        if (key in issue.fields) task[key] = issue.fields[key]
      }
      insertedTasks.push(task)
      continue
    }

    updated += 1
    const next: ITask = { ...matched }
    next.id = id
    next.type = type
    next.start = start
    next.end = end
    next.duration = duration
    next.progress = progress
    next.text = text
    next.externalSource = providerId
    next.externalKey = issue.key
    if (mapping.fields.parent !== null) {
      if (parent !== undefined) next.parent = parent
      else delete next.parent
    }
    if (resourcesMapped) {
      if (resources && resources.length > 0) next.resources = resources
      else delete next.resources
    }
    if (mapping.fields.details !== null) next.details = details ?? ''
    for (const key of mapping.extraFields) {
      if (key in issue.fields) next[key] = issue.fields[key]
    }
    updatesById.set(String(id), next)
  }

  const mergedTasks: ITask[] = existing.tasks.map((task) =>
    task.id !== undefined && updatesById.has(String(task.id)) ? updatesById.get(String(task.id))! : task
  )

  // 7. DFS over the inserted parent map so inserted parents precede children.
  const insertedById = new Map<string, ITask>()
  for (const task of insertedTasks) insertedById.set(String(task.id), task)
  const insertedChildren = new Map<string, ITask[]>()
  const insertedRoots: ITask[] = []
  for (const task of insertedTasks) {
    const parentKey = task.parent !== undefined ? String(task.parent) : undefined
    if (parentKey !== undefined && insertedById.has(parentKey)) {
      const siblings = insertedChildren.get(parentKey)
      if (siblings) siblings.push(task)
      else insertedChildren.set(parentKey, [task])
    } else {
      insertedRoots.push(task)
    }
  }
  const orderedInserted: ITask[] = []
  const visited = new Set<string>()
  const visit = (task: ITask) => {
    const key = String(task.id)
    if (visited.has(key)) return
    visited.add(key)
    orderedInserted.push(task)
    for (const child of insertedChildren.get(key) ?? []) visit(child)
  }
  for (const root of insertedRoots) visit(root)
  for (const task of insertedTasks) visit(task)
  mergedTasks.push(...orderedInserted)

  // 8. Links: remote relations are authoritative only between tasks synced in
  // this fetch — links to local-only tasks survive.
  const syncedInFetch = new Set<string>(entries.map((entry) => String(entry.id)))
  const syncedTaskIds = new Set<string>(Array.from(keyToTaskId.values(), (id) => String(id)))
  const mergedLinks =
    mapping.fields.successors === null
      ? [...existing.links]
      : existing.links.filter(
          (link) => !(syncedInFetch.has(String(link.source)) && syncedTaskIds.has(String(link.target)))
        )
  const relationshipKeys = new Set(mergedLinks.map((link) => `${String(link.source)}->${String(link.target)}`))
  let nextLinkId = existing.links.reduce((max, link) => Math.max(max, Number(link.id) || 0), 0) + 1
  if (mapping.fields.successors !== null) {
    for (const entry of entries) {
      const rawSuccessors = field(entry.issue, 'successors')
      if (!Array.isArray(rawSuccessors)) continue
      for (const raw of rawSuccessors) {
        if (raw === null || typeof raw !== 'object') continue
        const successor = raw as Partial<RemoteSuccessor>
        if (successor.key === undefined) continue
        const target = keyToTaskId.get(String(successor.key))
        if (target === undefined || sameTaskId(target, entry.id)) continue
        const linkKey = `${String(entry.id)}->${String(target)}`
        if (relationshipKeys.has(linkKey)) continue
        relationshipKeys.add(linkKey)
        const delay = typeof successor.delay === 'number' && Number.isFinite(successor.delay) ? successor.delay : 0
        const lag = durationUnit === 'hour' ? delay * calendarConfig.workingHoursPerDay : delay
        mergedLinks.push({ id: nextLinkId, source: entry.id, target, type: 'e2s', lag })
        nextLinkId += 1
      }
    }
  }

  // 9-10. Optional auto-schedule, then return counts.
  const tasks = isAutoSchedule ? autoScheduleTasks(mergedTasks, mergedLinks, calendarConfig, durationUnit) : mergedTasks
  return { kind: 'success', tasks, links: mergedLinks, resources: nextResources, inserted, updated }
}
