import type { IntegrationFieldMapping, SyncTaskField } from './types'

export const syncTaskFields: Array<{ key: SyncTaskField; label: string; required: boolean }> = [
  { key: 'text', label: 'Task Name', required: true },
  { key: 'start', label: 'Start Date', required: false },
  { key: 'end', label: 'Finish Date', required: false },
  { key: 'duration', label: 'Duration', required: false },
  { key: 'progress', label: 'Progress %', required: false },
  { key: 'type', label: 'Task Type', required: false },
  { key: 'parent', label: 'Parent Task', required: false },
  { key: 'resources', label: 'Assigned Resources', required: false },
  { key: 'successors', label: 'Successors', required: false },
  { key: 'details', label: 'Notes / Description', required: false },
]

export function defaultFieldMapping(): IntegrationFieldMapping {
  return {
    fields: {
      text: 'subject',
      start: 'start_date',
      end: 'due_date',
      duration: 'estimated_hours',
      progress: 'done_ratio',
      type: null,
      parent: 'parent_id',
      resources: 'assigned_to',
      successors: 'successors',
      details: 'description',
    },
    extraFields: [],
  }
}

/** 'YYYY-MM-DD' → local midnight via new Date(y, m-1, d).
 *  NEVER new Date(s) — UTC parse shifts a day in UTC− zones.
 *  Garbage input (bad shape or out-of-range components) → Invalid Date;
 *  callers guard with isNaN(date.getTime()). */
export function parseLocalDate(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return new Date(NaN)
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const date = new Date(y, mo - 1, d)
  // new Date() rolls out-of-range components over (e.g. month 13 → next year)
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) {
    return new Date(NaN)
  }
  return date
}
