import type { ILink, ITask } from '@svar-ui/react-gantt'
import type { CsvImportData, CsvTaskMapping } from '@/types/gantt-csv'
import type { GanttResource, TaskWithResources } from '@/types/gantt'
import { csvValue, parseCsvDateValue, parseCsvDependencyType, parseCsvResourceTokens } from '@/lib/gantt-csv'
import { autoScheduleTasks, calculateEndDate, clampImportedDuration, getNextWorkingDay, isSchedulableEnd, type ProjectCalendarConfig } from '@/lib/scheduler'
import { getNextNumericTaskId, hasParentCycle, sameTaskId, toPositiveNumericTaskId } from '@/lib/task-helpers'

export type GanttPasteResult =
  | { kind: 'success'; tasks: ITask[]; links: ILink[]; resources: GanttResource[]; inserted: number; updated: number }
  | { kind: 'no-importable-rows' }

type PasteEntry = {
  row: string[]
  existing: ITask | undefined
  id: string | number
  type: ITask['type']
}

export function applyGanttPaste(
  data: CsvImportData,
  mapping: CsvTaskMapping,
  existing: { tasks: ITask[]; links: ILink[]; resources: GanttResource[] },
  calendarConfig: ProjectCalendarConfig,
  durationUnit: 'day' | 'hour',
  isAutoSchedule: boolean
): GanttPasteResult {
  const rows = data.rows.filter((row) => row.some((cell) => cell.trim() !== ''))
  const usableRows = mapping.text === null ? rows : rows.filter((row) => csvValue(row, mapping, 'text') !== '')
  if (usableRows.length === 0) return { kind: 'no-importable-rows' }

  const existingById = new Map<string, ITask>()
  for (const task of existing.tasks) {
    if (task.id !== undefined && !existingById.has(String(task.id))) existingById.set(String(task.id), task)
  }

  // Pass 1: classify rows as update (id matches an existing task) or insert,
  // and assign ids to inserted rows so later rows can reference them.
  const usedIds = new Set(existingById.keys())
  const rawIdMap = new Map<string, string | number>()
  const entries: PasteEntry[] = usableRows.map((row) => {
    const rawId = csvValue(row, mapping, 'id')
    const matched = mapping.id !== null && rawId !== '' ? existingById.get(rawId) : undefined
    let id: string | number
    if (matched) {
      id = matched.id as string | number
    } else {
      const numeric = toPositiveNumericTaskId(rawId)
      if (numeric !== null && !usedIds.has(String(numeric))) {
        id = numeric
      } else {
        // Equivalent to getNextNumericTaskId over existing + already-inserted tasks.
        id = getNextNumericTaskId(existing.tasks)
        while (usedIds.has(String(id))) id = (id as number) + 1
      }
      usedIds.add(String(id))
    }
    if (rawId && !rawIdMap.has(rawId)) rawIdMap.set(rawId, id)
    if (!rawIdMap.has(String(id))) rawIdMap.set(String(id), id)
    const typeValue = csvValue(row, mapping, 'type').toLowerCase()
    const type: ITask['type'] =
      typeValue === 'summary' || typeValue === 'milestone' ? typeValue : typeValue ? 'task' : (matched?.type ?? 'task')
    return { row, existing: matched, id, type }
  })

  const typeById = new Map<string, ITask['type']>()
  for (const task of existing.tasks) {
    if (task.id !== undefined) typeById.set(String(task.id), task.type ?? 'task')
  }
  for (const entry of entries) typeById.set(String(entry.id), entry.type)

  // Pass 2: resolve parents. Seed with existing parent links so cycle checks
  // see the full post-paste hierarchy; updates overwrite or clear entries.
  const parents = new Map<string, string | number>()
  for (const task of existing.tasks) {
    if (task.id !== undefined && task.parent !== undefined) parents.set(String(task.id), task.parent)
  }
  for (const entry of entries) {
    if (mapping.parent === null) continue
    const rawParent = csvValue(entry.row, mapping, 'parent')
    if (!rawParent) {
      if (entry.existing) parents.delete(String(entry.id))
      continue
    }
    const resolved = rawIdMap.get(rawParent) ?? (existingById.has(rawParent) ? rawParent : undefined)
    const parent = resolved !== undefined ? (existingById.get(String(resolved))?.id ?? resolved) as string | number : undefined
    if (
      parent !== undefined &&
      typeById.get(String(parent)) !== 'milestone' &&
      !sameTaskId(parent, entry.id) &&
      !hasParentCycle(entry.id, parent, parents)
    ) {
      parents.set(String(entry.id), parent)
    }
  }
  const parentIds = new Set(Array.from(parents.values(), (parent) => String(parent)))

  // Resource resolution mirrors importGanttCsv: numeric id, then label match,
  // then create a new resource appended to the list.
  const nextResources = [...existing.resources]
  const resourceIdsByName = new Map<string, number>()
  for (const resource of nextResources) {
    const key = resource.label.trim().toLowerCase()
    if (key && !resourceIdsByName.has(key)) resourceIdsByName.set(key, resource.id)
  }
  let nextResourceId = nextResources.reduce((max, resource) => Math.max(max, resource.id), 0) + 1
  const resolveResources = (value: string): number[] => {
    const resolvedIds: number[] = []
    for (const token of parseCsvResourceTokens(value)) {
      const numericId = toPositiveNumericTaskId(token)
      const knownNumericId = numericId !== null && nextResources.some((resource) => resource.id === numericId) ? numericId : undefined
      const existingId = knownNumericId ?? resourceIdsByName.get(token.toLowerCase())
      const resourceId = existingId ?? (() => { const createdId = nextResourceId; nextResourceId += 1; nextResources.push({ id: createdId, label: token }); resourceIdsByName.set(token.toLowerCase(), createdId); return createdId })()
      if (!resolvedIds.includes(resourceId)) resolvedIds.push(resourceId)
    }
    return resolvedIds
  }

  // Pass 3: build updated copies of existing tasks and new inserted tasks.
  const updatesById = new Map<string, ITask>()
  const insertedTasks: ITask[] = []
  let inserted = 0
  let updated = 0
  for (const [index, entry] of entries.entries()) {
    const { row, existing: matched, id, type } = entry
    const parsedStart = parseCsvDateValue(csvValue(row, mapping, 'start'))
    const parsedEnd = parseCsvDateValue(csvValue(row, mapping, 'end'))
    const durationCell = csvValue(row, mapping, 'duration')
    const progressCell = csvValue(row, mapping, 'progress')
    const parsedDuration = durationCell === '' ? NaN : Number(durationCell)
    const parsedProgress = progressCell === '' ? NaN : Number(progressCell)
    const start = parsedStart ?? (matched?.start ? new Date(matched.start) : getNextWorkingDay(new Date(), calendarConfig))
    const duration =
      type === 'milestone'
        ? 0
        : Number.isFinite(parsedDuration) && parsedDuration >= 0
          ? clampImportedDuration(parsedDuration, calendarConfig, durationUnit)
          : (matched?.duration ?? 1)
    const end =
      type === 'milestone'
        ? start
        : parsedEnd && parsedEnd.getTime() >= start.getTime() && isSchedulableEnd(start, parsedEnd)
          ? parsedEnd
          : calculateEndDate(start, duration, calendarConfig, durationUnit)
    const parent = parents.get(String(id))

    if (!matched) {
      inserted += 1
      const progress = Number.isFinite(parsedProgress) ? Math.min(100, Math.max(0, parsedProgress)) : 0
      const resources = resolveResources(csvValue(row, mapping, 'resources'))
      insertedTasks.push({
        id,
        text: csvValue(row, mapping, 'text') || `Task ${index + 1}`,
        start,
        end,
        duration,
        progress,
        type,
        // Only a row that actually has children may be open: SVAR's tree walk
        // recurses into `data` whenever `open === true`, and a childless summary
        // has `data === null`, which throws and takes the whole view down.
        open: parentIds.has(String(id)),
        ...(parent !== undefined ? { parent } : {}),
        ...(resources.length > 0 ? { resources } : {}),
      })
      continue
    }

    updated += 1
    const next = { ...matched } as TaskWithResources
    next.id = id
    next.type = type
    next.start = start
    next.end = end
    next.duration = duration
    const text = csvValue(row, mapping, 'text')
    if (text) next.text = text
    if (Number.isFinite(parsedProgress)) next.progress = Math.min(100, Math.max(0, parsedProgress))
    if (mapping.parent !== null) {
      if (parent !== undefined) next.parent = parent
      else delete next.parent
    }
    if (mapping.resources !== null) {
      const resources = resolveResources(csvValue(row, mapping, 'resources'))
      if (resources.length > 0) next.resources = resources
      else delete next.resources
    }
    updatesById.set(String(id), next)
  }

  const mergedTasks: ITask[] = existing.tasks.map((task) =>
    task.id !== undefined && updatesById.has(String(task.id)) ? updatesById.get(String(task.id))! : task
  )
  mergedTasks.push(...insertedTasks)

  // Links: updates replace all incoming links for their target; inserts only add.
  const replacedTargets = new Set<string>()
  if (mapping.predecessors !== null) {
    for (const entry of entries) {
      if (entry.existing) replacedTargets.add(String(entry.id))
    }
  }
  const mergedLinks = existing.links.filter((link) => !replacedTargets.has(String(link.target)))
  const relationshipKeys = new Set(mergedLinks.map((link) => `${String(link.source)}->${String(link.target)}`))
  let nextLinkId = existing.links.reduce((max, link) => Math.max(max, Number(link.id) || 0), 0) + 1
  if (mapping.predecessors !== null) {
    for (const entry of entries) {
      const target = entry.id
      const predecessorIds = csvValue(entry.row, mapping, 'predecessors').split(/[,;|\s]+/).map((value) => value.trim()).filter(Boolean)
      const predecessorTypes = csvValue(entry.row, mapping, 'predecessorTypes').split(/[,;|\s]+/).map((value) => value.trim()).filter(Boolean)
      predecessorIds.forEach((rawSource, index) => {
        const resolved = rawIdMap.get(rawSource) ?? (existingById.has(rawSource) ? rawSource : undefined)
        const source = resolved !== undefined ? (existingById.get(String(resolved))?.id ?? resolved) as string | number : undefined
        if (source === undefined || sameTaskId(source, target)) return
        const key = `${String(source)}->${String(target)}`
        if (relationshipKeys.has(key)) return
        relationshipKeys.add(key)
        mergedLinks.push({ id: nextLinkId, source, target, type: parseCsvDependencyType(predecessorTypes[index] ?? 'e2s') })
        nextLinkId += 1
      })
    }
  }

  const tasks = isAutoSchedule ? autoScheduleTasks(mergedTasks, mergedLinks, calendarConfig, durationUnit) : mergedTasks
  return { kind: 'success', tasks, links: mergedLinks, resources: nextResources, inserted, updated }
}
