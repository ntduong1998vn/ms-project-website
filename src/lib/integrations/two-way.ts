import type { ILink, ITask } from '@svar-ui/react-gantt'
import type { GanttResource } from '@/types/gantt'
import type { IntegrationFieldMapping, IssueTrackerProvider, PushContext, RemoteFieldDescriptor, RemoteIssue } from '@/lib/integrations/types'
import type { ProjectCalendarConfig } from '@/lib/scheduler'
import { autoScheduleTasks } from '@/lib/scheduler'
import { applyRemoteIssues, normalizeRemoteHierarchy } from '@/lib/integrations/sync'
import { syncTaskFields } from '@/lib/integrations/fields'
import { baselineHasField, syncEqual, syncFields, taskBaseline, withBaseline } from '@/lib/integrations/baseline'

export type SyncConflict = { id: string; issueKey: string; task: string; field: string; fieldLabel: string; local: unknown; remote: unknown }
export type SyncChoice = 'local' | 'remote'
type Change = { field: string; remoteKey: string; local: unknown; remote: unknown; action: 'push' | 'pull' | 'equal' | 'conflict' | 'skip'; conflictId: string }
type TaskPlan = { original: ITask; remote?: RemoteIssue; changes: Change[] }
export type SyncPlan = {
  tasks: ITask[]; links: ILink[]; resources: GanttResource[]; inserted: ITask[]
  entries: TaskPlan[]; conflicts: SyncConflict[]; mapping: IntegrationFieldMapping; autoPull: boolean
  calendar: ProjectCalendarConfig; durationUnit: 'day' | 'hour'; autoSchedule: boolean
}
export type SyncReport = { pulled: number; pushed: number; inserted: number; conflictsResolved: number; failed: Array<{ key: string; task: string; error: string }> }

export async function pushNewTasks(tasks: ITask[], provider: Pick<IssueTrackerProvider, 'createIssue'>, ctx: PushContext, onCreated: (task: ITask) => void) {
  for (const task of tasks) {
    const key = await provider.createIssue(task, ctx)
    ctx.keyByTaskId.set(String(task.id), key)
    onCreated(withBaseline({ ...task, externalSource: 'redmine', externalKey: key }, ctx.mapping))
  }
}

export function mergeSyncTasks(before: ITask[], current: ITask[], incoming: ITask[], mapping: IntegrationFieldMapping, scheduling?: Pick<SyncPlan, 'calendar' | 'durationUnit' | 'autoSchedule' | 'links'>): ITask[] {
  const originals = new Map(before.map((task) => [String(task.id), task]))
  const results = new Map(incoming.map((task) => [String(task.id), task]))
  const ids = new Set(current.map((task) => String(task.id)))
  const mergedTasks = normalizeRemoteHierarchy([...current.map((task) => {
    const original = originals.get(String(task.id))
    const result = results.get(String(task.id))
    if (!original || !result) return task
    const merged: ITask = { ...task, externalSync: result.externalSync }
    for (const { field } of syncFields(mapping)) if (syncEqual(task[field], original[field], field)) merged[field] = result[field]
    return merged
  }), ...incoming.filter((task) => !originals.has(String(task.id)) && !ids.has(String(task.id)))])
  return scheduling?.autoSchedule ? autoScheduleTasks(mergedTasks, scheduling.links, scheduling.calendar, scheduling.durationUnit) : mergedTasks
}

export function planSync(input: {
  tasks: ITask[]; links: ILink[]; resources: GanttResource[]; issues: RemoteIssue[]
  descriptors: RemoteFieldDescriptor[]; mapping: IntegrationFieldMapping
  calendar: ProjectCalendarConfig; durationUnit: 'day' | 'hour'; autoPull?: boolean; autoSchedule?: boolean
}): SyncPlan {
  const { tasks, links, resources, issues, descriptors, mapping, calendar, durationUnit } = input
  const seed = tasks.map((task) => {
    const baseline = taskBaseline(task)
    if (!baseline) return task
    const copy = { ...task }
    for (const { field, remoteKey } of syncFields(mapping)) if (baselineHasField(task, field, remoteKey)) copy[field] = structuredClone(baseline.base[field])
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
      const known = baselineHasField(original, field, remoteKey)
      const localChanged = !known || !syncEqual(local, baseline!.base[field], field)
      const remoteChanged = remote && (!known || !syncEqual(value, baseline!.base[field], field))
      const equal = remote && syncEqual(local, value, field)
      let action: Change['action'] = equal ? 'equal' : localChanged && remoteChanged ? 'conflict' : localChanged && known ? 'push' : remoteChanged ? 'pull' : 'skip'
      if (input.autoPull && localChanged) action = remoteChanged && !equal ? 'conflict' : 'skip'
      const conflictId = JSON.stringify([key, field])
      if (action === 'conflict') conflicts.push({ id: conflictId, issueKey: key, task: String(original.text ?? key), field,
        fieldLabel: syncTaskFields.find((candidate) => candidate.key === field)?.label || descriptors.find((candidate) => candidate.key === remoteKey)?.label || field,
        local, remote: value })
      return { field, remoteKey, local, remote: value, action, conflictId }
    })
    return { original, remote, changes }
  })
  return { tasks, links: converted.kind === 'success' ? converted.links : links, resources: converted.kind === 'success' ? converted.resources : resources,
    inserted, entries, conflicts, mapping, autoPull: !!input.autoPull, calendar, durationUnit, autoSchedule: !!input.autoSchedule }
}

export async function executeSync(plan: SyncPlan, choices: Record<string, SyncChoice>, push: (key: string, task: ITask, keys: ReadonlySet<string>) => Promise<void>) {
  if (!plan.autoPull && plan.conflicts.some((c) => !choices[c.id])) throw new Error('Choose a value for every conflict.')
  const report: SyncReport = { pulled: 0, pushed: 0, inserted: plan.inserted.length, conflictsResolved: 0, failed: [] }
  const completed = new Map<string, ITask>()
  let index = 0
  await Promise.all(Array.from({ length: Math.min(4, plan.entries.length) }, async () => {
    while (index < plan.entries.length) {
      const { original, remote, changes } = plan.entries[index++]
      const key = String(original.externalKey)
      const next = { ...original }
      const base = { ...taskBaseline(original)?.base }
      const baseMapping = { ...taskBaseline(original)?.mapping }
      const pushKeys = new Set<string>()
      let pulled = false
      let resolved = 0
      for (const change of changes) {
        let action = change.action
        if (action === 'conflict') {
          if (plan.autoPull) continue
          action = choices[change.conflictId] === 'local' ? 'push' : 'pull'
          resolved++
        }
        if (action === 'skip') continue
        if (action === 'pull') { next[change.field] = structuredClone(change.remote); pulled = true }
        if (action === 'push') pushKeys.add(change.remoteKey)
        base[change.field] = structuredClone(next[change.field] ?? null)
        baseMapping[change.field] = change.remoteKey
      }
      try {
        if (pushKeys.size && !plan.autoPull) await push(key, next, pushKeys)
        next.externalSync = { updatedOn: remote?.updatedOn ?? taskBaseline(original)?.updatedOn, base, mapping: baseMapping }
        completed.set(key, next)
        if (pulled) report.pulled++
        if (pushKeys.size) report.pushed++
        report.conflictsResolved += resolved
      } catch (error) {
        report.failed.push({ key, task: String(original.text ?? key), error: error instanceof Error ? error.message : String(error) })
      }
    }
  }))
  const mergedTasks = normalizeRemoteHierarchy([...plan.tasks.map((t) => t.externalSource === 'redmine' ? completed.get(String(t.externalKey)) ?? t : t), ...plan.inserted.map((task) => withBaseline(task, plan.mapping, taskBaseline(task)?.updatedOn))])
  return { tasks: plan.autoSchedule ? autoScheduleTasks(mergedTasks, plan.links, plan.calendar, plan.durationUnit) : mergedTasks,
    links: plan.links, resources: plan.resources, report }
}
