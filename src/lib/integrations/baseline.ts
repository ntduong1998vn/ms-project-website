import type { ILink, ITask } from '@svar-ui/react-gantt'
import type { IntegrationFieldMapping, IntegrationSettings, RemoteRelation } from '@/lib/integrations/types'
import type { TaskWithResources } from '@/types/gantt'
import { parseLocalDate } from '@/lib/integrations/fields'
import { localRelations, relationsEqual } from '@/lib/integrations/relations'

export function syncFields(mapping: IntegrationFieldMapping): Array<{ field: string; remoteKey: string }> {
  return [
    ...Object.entries(mapping.fields).filter(([field, key]) => key && field !== 'successors').map(([field, key]) => ({ field, remoteKey: key! })),
    ...mapping.extraFields.filter((key) => key !== 'successors').map((key) => ({ field: key, remoteKey: key })),
  ]
}

function normalize(value: unknown, field: string): unknown {
  if (value === '' || value === null || value === undefined) return null
  if (field === 'start' || field === 'end' || value instanceof Date) {
    const date = value instanceof Date ? value : /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? parseLocalDate(String(value)) : new Date(String(value))
    if (!Number.isNaN(date.getTime())) return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
  }
  if (typeof value === 'number') return Math.round(value * 1e6) / 1e6
  if (Array.isArray(value)) {
    const values = value.map((v) => normalize(v, ''))
    return field === 'resources' ? values.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : values
  }
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, normalize(v, key)]))
  return value
}

export function syncEqual(a: unknown, b: unknown, field = ''): boolean {
  return JSON.stringify(normalize(a, field)) === JSON.stringify(normalize(b, field))
}

export function taskBaseline(task: ITask): TaskWithResources['externalSync'] {
  return task.externalSync as TaskWithResources['externalSync']
}

export function mappingFingerprint(mapping: IntegrationFieldMapping): string {
  return JSON.stringify([Object.entries(mapping.fields).sort(([a], [b]) => a.localeCompare(b)), [...mapping.extraFields].sort()])
}

export function baselineHasField(task: ITask, field: string, remoteKey: string): boolean {
  const baseline = taskBaseline(task)
  return !!baseline && Object.hasOwn(baseline.base, field) && baseline.mapping?.[field] === baselineFieldKey(field, remoteKey)
}

export function baselineFieldKey(field: string, remoteKey: string): string {
  return field === 'parent' ? `${remoteKey}:identity` : remoteKey
}

export function ensureSyncIdentities(tasks: ITask[]): ITask[] {
  return tasks.map((task) => task.syncIdentity || (task.externalSource && task.externalKey) ? task : { ...task, syncIdentity: crypto.randomUUID() })
}

export function syncValue(task: ITask, field: string, tasks: ITask[]): unknown {
  if (field !== 'parent') return task[field]
  if (task.parent == null || String(task.parent) === '0') return null
  const parent = tasks.find((candidate) => String(candidate.id) === String(task.parent))
  if (parent?.externalSource && parent.externalKey) return `remote:${parent.externalSource}:${parent.externalKey}`
  return parent?.syncIdentity ? `local:${parent.syncIdentity}` : `unresolved:${task.parent}`
}

export function parentIdFromIdentity(identity: unknown, tasks: ITask[]): ITask['parent'] {
  return tasks.find((candidate) => syncValue({ parent: candidate.id }, 'parent', tasks) === identity)?.id
}

export function syncFetchCursor(settings: IntegrationSettings, linked: ITask[]): string | undefined {
  return settings.syncMappingFingerprint === mappingFingerprint(settings.mapping) && linked.length > 0 && linked.every((task) => syncFields(settings.mapping).every(({ field, remoteKey }) => baselineHasField(task, field, remoteKey)) && (!settings.mapping.fields.successors || taskBaseline(task)?.relationsMapping === settings.mapping.fields.successors))
    ? settings.syncCursor : undefined
}

export function snapshot(task: ITask, mapping: IntegrationFieldMapping, tasks: ITask[] = []): Record<string, unknown> {
  return Object.fromEntries(syncFields(mapping).map(({ field }) => [field, structuredClone(syncValue(task, field, tasks) ?? null)]))
}

export function withBaseline(task: ITask, mapping: IntegrationFieldMapping, updatedOn?: string, tasks: ITask[] = [], relations: RemoteRelation[] = []): ITask {
  return { ...task, externalSync: { updatedOn, base: snapshot(task, mapping, tasks), mapping: Object.fromEntries(syncFields(mapping).map(({ field, remoteKey }) => [field, baselineFieldKey(field, remoteKey)])),
    ...(mapping.fields.successors ? { relations: structuredClone(relations), relationsMapping: mapping.fields.successors } : {}) } }
}

export function hasLocalChanges(task: ITask, mapping: IntegrationFieldMapping, tasks: ITask[] = [], links: ILink[] = [], hoursPerDay = 8, unit: 'day' | 'hour' = 'day'): boolean {
  const baseline = taskBaseline(task)
  const keys = new Set(tasks.filter((row) => row.externalSource === 'redmine').map((row) => String(row.externalKey)))
  const local = mapping.fields.successors ? localRelations(task, tasks, links, hoursPerDay, unit) : undefined
  return !baseline || syncFields(mapping).some(({ field, remoteKey }) => !baselineHasField(task, field, remoteKey) || !syncEqual(syncValue(task, field, tasks), baseline.base[field], field)) || !!(local && (local.blocked || baseline.relationsMapping !== mapping.fields.successors || !relationsEqual(local.relations, (baseline.relations ?? []).filter((row) => keys.has(row.key)))))
}

export function maxCursor(current: string | undefined, values: Array<string | undefined>): string | undefined {
  return values.reduce((max, value) => value && Number.isFinite(Date.parse(value)) && (!max || Date.parse(value) > Date.parse(max)) ? value : max, current)
}
