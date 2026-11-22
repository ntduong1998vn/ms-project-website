import type { ILink, ITask } from '@svar-ui/react-gantt'
import type { GanttResource } from '@/types/gantt'
import type { IntegrationFieldMapping, IssueTrackerProvider, PushContext, RemoteFieldDescriptor, RemoteIssue, RemoteRelation } from '@/lib/integrations/types'
import type { ProjectCalendarConfig } from '@/lib/scheduler'
import { autoScheduleTasks, calculateTaskDuration } from '@/lib/scheduler'
import { applyRemoteIssues, normalizeRemoteHierarchy } from '@/lib/integrations/sync'
import { syncTaskFields } from '@/lib/integrations/fields'
import { baselineFieldKey, baselineHasField, ensureSyncIdentities, parentIdFromIdentity, syncEqual, syncFields, syncValue, taskBaseline, withBaseline } from '@/lib/integrations/baseline'
import { applyRelations, localRelations, pushRelations, relationsEqual } from '@/lib/integrations/relations'

export type SyncConflict = { id: string; issueKey: string; task: string; field: string; fieldLabel: string; local: unknown; remote: unknown }
export type SyncChoice = 'local' | 'remote'
type Change = { field: string; remoteKey: string; local: unknown; remote: unknown; action: 'push' | 'pull' | 'equal' | 'conflict' | 'skip'; conflictId: string }
type TaskPlan = { original: ITask; remote?: RemoteIssue; changes: Change[]; relations?: Change; skipped: string[] }
export type SyncPlan = {
  tasks: ITask[]; links: ILink[]; resources: GanttResource[]; inserted: ITask[]
  entries: TaskPlan[]; conflicts: SyncConflict[]; mapping: IntegrationFieldMapping; autoPull: boolean
  calendar: ProjectCalendarConfig; durationUnit: 'day' | 'hour'; autoSchedule: boolean
  skipped: Array<{ key: string; error: string }>
}
export type SyncReport = { pulled: number; pushed: number; inserted: number; conflictsResolved: number; failed: Array<{ key: string; task: string; error: string }>; skipped?: Array<{ key: string; error: string }>; relationsAdded?: number; relationsRemoved?: number }
type SyncScheduling = Pick<SyncPlan, 'calendar' | 'durationUnit' | 'autoSchedule' | 'links'> & { acceptedFields?: Map<string, Set<string>> }

function scheduleMergedTasks(tasks: ITask[], scheduling: SyncScheduling): ITask[] {
  const before = new Map(tasks.map((task) => [String(task.id), task]))
  const scheduled = scheduling.autoSchedule ? autoScheduleTasks(tasks, scheduling.links, scheduling.calendar, scheduling.durationUnit) : tasks
  return scheduled.map((task) => {
    const baseline = taskBaseline(task)
    const accepted = scheduling.acceptedFields?.get(String(task.externalKey))
    if (!baseline || !accepted?.size) return task
    const base = { ...baseline.base }
    for (const field of accepted) {
      const original = before.get(String(task.id))!
      if (syncEqual(syncValue(original, field, tasks), baseline.base[field], field)) base[field] = structuredClone(syncValue(task, field, scheduled) ?? null)
    }
    return { ...task, externalSync: { ...baseline, base } }
  })
}

export async function pushNewTasks(tasks: ITask[], provider: Pick<IssueTrackerProvider, 'createIssue'>, ctx: PushContext, onCreated: (task: ITask) => void) {
  for (const task of tasks) {
    const key = await provider.createIssue(task, ctx)
    ctx.keyByTaskId.set(String(task.id), key)
    const linked = Array.from(ctx.keyByTaskId, ([id, externalKey]) => ({ id, externalSource: 'redmine', externalKey }))
    onCreated(withBaseline({ ...task, externalSource: 'redmine', externalKey: key }, ctx.mapping, undefined, linked))
  }
}

export function mergeSyncTasks(before: ITask[], current: ITask[], incoming: ITask[], mapping: IntegrationFieldMapping, scheduling?: SyncScheduling): ITask[] {
  const originals = new Map(before.map((task) => [String(task.id), task]))
  const results = new Map(incoming.map((task) => [String(task.id), task]))
  const ids = new Set(current.map((task) => String(task.id)))
  const mergedTasks = normalizeRemoteHierarchy([...current.map((task) => {
    const original = originals.get(String(task.id))
    const result = results.get(String(task.id))
    if (!original || !result) return task
    const merged: ITask = { ...task, externalSync: result.externalSync, syncIdentity: result.syncIdentity ?? task.syncIdentity }
    for (const { field } of syncFields(mapping)) if (syncEqual(task[field], original[field], field)) merged[field] = result[field]
    if (syncEqual(task.duration, original.duration) && (!syncEqual(result.start, original.start, 'start') || !syncEqual(result.end, original.end, 'end'))) merged.duration = result.duration
    return merged
  }), ...incoming.filter((task) => !originals.has(String(task.id)) && !ids.has(String(task.id)))])
  return scheduling ? scheduleMergedTasks(mergedTasks, scheduling) : mergedTasks
}

export function planSync(input: {
  tasks: ITask[]; links: ILink[]; resources: GanttResource[]; issues: RemoteIssue[]
  descriptors: RemoteFieldDescriptor[]; mapping: IntegrationFieldMapping
  calendar: ProjectCalendarConfig; durationUnit: 'day' | 'hour'; autoPull?: boolean; autoSchedule?: boolean
}): SyncPlan {
  const { links, resources, issues, descriptors, mapping, calendar, durationUnit } = input
  const tasks = ensureSyncIdentities(input.tasks)
  const seed = tasks.map((task) => {
    const baseline = taskBaseline(task)
    if (!baseline) return task
    const copy = { ...task }
    for (const { field, remoteKey } of syncFields(mapping)) if (baselineHasField(task, field, remoteKey)) copy[field] = field === 'parent' ? parentIdFromIdentity(baseline.base[field], tasks) : structuredClone(baseline.base[field])
    for (const field of ['start', 'end']) if (copy[field]) copy[field] = new Date(copy[field] as string)
    return copy
  })
  const converted = applyRemoteIssues(issues, descriptors, mapping, { tasks: seed, links, resources }, 'redmine', calendar, durationUnit, !!input.autoSchedule)
  const remoteTasks = converted.kind === 'success' ? converted.tasks : []
  const existingKeys = new Set(tasks.filter((t) => t.externalSource === 'redmine').map((t) => String(t.externalKey)))
  const inserted = remoteTasks.filter((t) => t.externalSource === 'redmine' && !existingKeys.has(String(t.externalKey)))
  const byKey = new Map(issues.map((issue) => [issue.key, issue]))
  const convertedByKey = new Map(remoteTasks.filter((t) => t.externalSource === 'redmine').map((t) => [String(t.externalKey), t]))
  const conflicts: SyncConflict[] = []
  const entries = tasks.filter((t) => t.externalSource === 'redmine' && t.externalKey).map((original): TaskPlan => {
    const key = String(original.externalKey)
    const remote = byKey.get(key)
    const remoteTask = convertedByKey.get(key)
    const baseline = taskBaseline(original)
    const changes = syncFields(mapping).map(({ field, remoteKey }): Change => {
      const local = original[field]
      const value = remoteTask?.[field]
      const localValue = syncValue(original, field, tasks)
      const remoteValue = remoteTask ? syncValue(remoteTask, field, remoteTasks) : undefined
      const known = baselineHasField(original, field, remoteKey)
      const localChanged = !known || !syncEqual(localValue, baseline!.base[field], field)
      const remoteChanged = remote && (!known || !syncEqual(remoteValue, baseline!.base[field], field))
      const equal = remote && syncEqual(localValue, remoteValue, field)
      let action: Change['action'] = equal ? 'equal' : localChanged && remoteChanged ? 'conflict' : localChanged && known ? 'push' : remoteChanged ? 'pull' : 'skip'
      if (input.autoPull && localChanged) action = remoteChanged && !equal ? 'conflict' : 'skip'
      const conflictId = JSON.stringify([key, field])
      if (action === 'conflict') conflicts.push({ id: conflictId, issueKey: key, task: String(original.text ?? key), field,
        fieldLabel: syncTaskFields.find((candidate) => candidate.key === field)?.label || descriptors.find((candidate) => candidate.key === remoteKey)?.label || field,
        local, remote: value })
      return { field, remoteKey, local, remote: value, action, conflictId }
    })
    let relations: Change | undefined
    const localLinks = localRelations(original, [...tasks, ...inserted], links, calendar.workingHoursPerDay, durationUnit)
    if (mapping.fields.successors) {
      const keys = new Set([...tasks, ...inserted].filter((row) => row.externalSource === 'redmine').map((row) => String(row.externalKey)))
      const base = (baseline?.relations ?? []).filter((row) => keys.has(row.key))
      const remoteLinks = ((remote?.fields[mapping.fields.successors] ?? []) as RemoteRelation[]).filter((row) => keys.has(row.key))
      for (const row of (remote?.fields[mapping.fields.successors] ?? []) as RemoteRelation[]) if (!keys.has(row.key)) localLinks.skipped.push(`Successor issue ${row.key}: no linked task in this project.`)
      const known = baseline?.relationsMapping === mapping.fields.successors && baseline.relations !== undefined
      const localChanged = !known || !relationsEqual(localLinks.relations, base)
      const remoteChanged = !!remote && (!known || !relationsEqual(remoteLinks, base))
      const equal = !!remote && relationsEqual(localLinks.relations, remoteLinks)
      let action: Change['action'] = equal ? 'equal' : localChanged && remoteChanged ? 'conflict' : localChanged && known ? 'push' : remoteChanged ? 'pull' : 'skip'
      if (input.autoPull && localChanged) action = remoteChanged && !equal ? 'conflict' : 'skip'
      const conflictId = JSON.stringify([key, 'successors'])
      relations = { field: 'successors', remoteKey: mapping.fields.successors, local: localLinks.relations, remote: remote ? remoteLinks : base, action, conflictId }
      if (action === 'conflict') conflicts.push({ id: conflictId, issueKey: key, task: String(original.text ?? key), field: 'successors', fieldLabel: 'Successors', local: localLinks.relations, remote: remoteLinks })
    }
    return { original, remote, changes, relations, skipped: mapping.fields.successors ? localLinks.skipped : [] }
  })
  return { tasks, links, resources: converted.kind === 'success' ? converted.resources : resources,
    inserted, entries, conflicts, mapping, autoPull: !!input.autoPull, calendar, durationUnit, autoSchedule: !!input.autoSchedule,
    skipped: mapping.fields.successors ? links.filter((link) => !tasks.some((task) => String(task.id) === String(link.source) && task.externalSource === 'redmine' && task.externalKey)).map((link) => ({ key: `local:${link.source}`, error: `Link to task ${link.target}: source task is not linked to Redmine.` })) : [] }
}

export async function executeSync(plan: SyncPlan, choices: Record<string, SyncChoice>, push: (key: string, task: ITask, keys: ReadonlySet<string>) => Promise<void>, relationProvider?: Pick<IssueTrackerProvider, 'createRelation' | 'deleteRelation'>) {
  if (!plan.autoPull && plan.conflicts.some((c) => !choices[c.id])) throw new Error('Choose a value for every conflict.')
  const report: SyncReport = { pulled: 0, pushed: 0, inserted: plan.inserted.length, conflictsResolved: 0, failed: [], skipped: [...plan.skipped, ...plan.entries.flatMap((entry) => entry.skipped.map((error) => ({ key: String(entry.original.externalKey), error })))], relationsAdded: 0, relationsRemoved: 0 }
  let mergedLinks = [...plan.links]
  const allTasks = [...plan.tasks, ...plan.inserted]
  for (const task of plan.inserted) if (plan.mapping.fields.successors) mergedLinks = applyRelations(mergedLinks, task, allTasks, taskBaseline(task)?.relations ?? [], plan.calendar.workingHoursPerDay, plan.durationUnit)
  const completed = new Map<string, ITask>()
  const acceptedFields = new Map<string, Set<string>>()
  let index = 0
  await Promise.all(Array.from({ length: Math.min(4, plan.entries.length) }, async () => {
    while (index < plan.entries.length) {
      const { original, remote, changes, relations } = plan.entries[index++]
      const key = String(original.externalKey)
      const next = { ...original }
      const base = { ...taskBaseline(original)?.base }
      const baseMapping = { ...taskBaseline(original)?.mapping }
      const pushKeys = new Set<string>()
      let pulled = false
      let pulledDate = false
      const accepted = new Set<string>()
      let resolved = 0
      for (const change of changes) {
        let action = change.action
        if (action === 'conflict') {
          if (plan.autoPull) continue
          action = choices[change.conflictId] === 'local' ? 'push' : 'pull'
          resolved++
        }
        if (action === 'skip') continue
        if (action === 'pull') {
          next[change.field] = structuredClone(change.remote)
          pulled = true
          if (change.field === 'start' || change.field === 'end') pulledDate = true
        }
        if (action === 'push') pushKeys.add(change.remoteKey)
        base[change.field] = structuredClone(syncValue(next, change.field, [...plan.tasks, ...plan.inserted]) ?? null)
        baseMapping[change.field] = baselineFieldKey(change.field, change.remoteKey)
        accepted.add(change.field)
      }
      if (pulledDate && !plan.mapping.fields.duration && plan.mapping.fields.end && next.start instanceof Date && next.end instanceof Date) {
        next.duration = next.type === 'milestone' ? 0 : Math.max(1, calculateTaskDuration(next.start, next.end, plan.calendar, plan.durationUnit))
      }
      try {
        if (pushKeys.size && !plan.autoPull) await push(key, next, pushKeys)
        let syncedRelations = taskBaseline(original)?.relations
        let relationAction = relations?.action
        if (relationAction === 'conflict') {
          if (plan.autoPull) relationAction = 'skip'
          else { relationAction = choices[relations!.conflictId] === 'local' ? 'push' : 'pull'; resolved++ }
        }
        if (relations && relationAction !== 'skip') {
          syncedRelations = relations.remote as RemoteRelation[]
          if (relationAction === 'push') {
            if (!relationProvider) throw new Error('Relation writes are unavailable.')
            const result = await pushRelations(key, relations.local as RemoteRelation[], syncedRelations, relationProvider)
            syncedRelations = result.relations
            report.relationsAdded! += result.added
            report.relationsRemoved! += result.removed
          }
          if (relationAction === 'pull') { mergedLinks = applyRelations(mergedLinks, original, allTasks, syncedRelations, plan.calendar.workingHoursPerDay, plan.durationUnit); pulled = true }
          const knownKeys = new Set(allTasks.filter((task) => task.externalSource === 'redmine').map((task) => String(task.externalKey)))
          const allRemote = (remote?.fields[relations.remoteKey] ?? taskBaseline(original)?.relations ?? []) as RemoteRelation[]
          syncedRelations = [...syncedRelations, ...allRemote.filter((row) => !knownKeys.has(row.key))]
        }
        next.externalSync = { ...taskBaseline(original), updatedOn: remote?.updatedOn ?? taskBaseline(original)?.updatedOn, base, mapping: baseMapping,
          ...(relations && relationAction !== 'skip' ? { relations: syncedRelations, relationsMapping: plan.mapping.fields.successors! } : {}) }
        completed.set(key, next)
        acceptedFields.set(key, accepted)
        if (pulled) report.pulled++
        if (pushKeys.size || relationAction === 'push') report.pushed++
        report.conflictsResolved += resolved
      } catch (error) {
        report.failed.push({ key, task: String(original.text ?? key), error: error instanceof Error ? error.message : String(error) })
      }
    }
  }))
  const mergedTasks = normalizeRemoteHierarchy([...plan.tasks.map((t) => t.externalSource === 'redmine' ? completed.get(String(t.externalKey)) ?? t : t), ...plan.inserted])
  return { tasks: scheduleMergedTasks(mergedTasks, { ...plan, links: mergedLinks, acceptedFields }),
    links: mergedLinks, resources: plan.resources, report, acceptedFields }
}
