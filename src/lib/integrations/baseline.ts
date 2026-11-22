import type { ITask } from '@svar-ui/react-gantt'
import type { IntegrationFieldMapping, IntegrationSettings } from '@/lib/integrations/types'
import type { TaskWithResources } from '@/types/gantt'
import { parseLocalDate } from '@/lib/integrations/fields'

export function syncFields(mapping: IntegrationFieldMapping): Array<{ field: string; remoteKey: string }> {
  return [
    ...Object.entries(mapping.fields).filter(([field, key]) => key && field !== 'successors').map(([field, key]) => ({ field, remoteKey: key! })),
    ...mapping.extraFields.map((key) => ({ field: key, remoteKey: key })),
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
  return !!baseline && Object.hasOwn(baseline.base, field) && baseline.mapping?.[field] === remoteKey
}

export function syncFetchCursor(settings: IntegrationSettings, linked: ITask[]): string | undefined {
  return settings.syncMappingFingerprint === mappingFingerprint(settings.mapping) && linked.length > 0 && linked.every((task) => syncFields(settings.mapping).every(({ field, remoteKey }) => baselineHasField(task, field, remoteKey)))
    ? settings.syncCursor : undefined
}

export function snapshot(task: ITask, mapping: IntegrationFieldMapping): Record<string, unknown> {
  return Object.fromEntries(syncFields(mapping).map(({ field }) => [field, structuredClone(task[field] ?? null)]))
}

export function withBaseline(task: ITask, mapping: IntegrationFieldMapping, updatedOn?: string): ITask {
  return { ...task, externalSync: { updatedOn, base: snapshot(task, mapping), mapping: Object.fromEntries(syncFields(mapping).map(({ field, remoteKey }) => [field, remoteKey])) } }
}

export function hasLocalChanges(task: ITask, mapping: IntegrationFieldMapping): boolean {
  const baseline = taskBaseline(task)
  return !baseline || syncFields(mapping).some(({ field, remoteKey }) => !baselineHasField(task, field, remoteKey) || !syncEqual(task[field], baseline.base[field], field))
}

export function maxCursor(current: string | undefined, values: Array<string | undefined>): string | undefined {
  return values.reduce((max, value) => value && Number.isFinite(Date.parse(value)) && (!max || Date.parse(value) > Date.parse(max)) ? value : max, current)
}
