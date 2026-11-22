import type { ITask } from '@svar-ui/react-gantt'

import { exclusiveEndToInclusiveFinish } from '@/lib/scheduler'

export const BLANKS_OPTION = '(Blanks)'
export const QUICK_FILTER_COLUMN_ID = 'quickFilter'

export type TextFilterMode = 'contains' | 'notContains' | 'equals' | 'startsWith' | 'in'
export type TextFilterValue = { mode: TextFilterMode; text?: string; values?: string[] }

export type NumberFilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between'
export type NumberFilterValue = { kind: 'number'; op: NumberFilterOp; value?: number | null; to?: number | null }

export type DateFilterOp = 'on' | 'onOrBefore' | 'onOrAfter' | 'between'
/** Dates are local calendar days in `YYYY-MM-DD` form. */
export type DateFilterValue = { kind: 'date'; op: DateFilterOp; from?: string; to?: string }

export type TaskFilterPreset =
  | 'all'
  | 'incomplete'
  | 'completed'
  | 'inProgress'
  | 'notStarted'
  | 'late'
  | 'milestones'
  | 'summary'
  | 'unassigned'

export type QuickFilterValue = { preset?: TaskFilterPreset; search?: string }

export type ColumnFilterValue = TextFilterValue | NumberFilterValue | DateFilterValue

export const TASK_FILTER_PRESETS: ReadonlyArray<{ id: TaskFilterPreset; label: string; description: string }> = [
  { id: 'all', label: 'All Tasks', description: 'Show every task' },
  { id: 'incomplete', label: 'Incomplete Tasks', description: 'Progress below 100%' },
  { id: 'completed', label: 'Completed Tasks', description: 'Progress at 100%' },
  { id: 'inProgress', label: 'In Progress Tasks', description: 'Started but not finished' },
  { id: 'notStarted', label: 'Not Started Tasks', description: 'Progress at 0%' },
  { id: 'late', label: 'Late Tasks', description: 'Finish date passed, not complete' },
  { id: 'milestones', label: 'Milestones', description: 'Zero-duration checkpoints' },
  { id: 'summary', label: 'Summary Tasks', description: 'Phases and groups only' },
  { id: 'unassigned', label: 'Unassigned Tasks', description: 'No resource assigned' },
]

export const TEXT_MODE_LABELS: Record<TextFilterMode, string> = {
  contains: 'contains',
  notContains: 'does not contain',
  equals: 'equals',
  startsWith: 'begins with',
  in: 'is one of',
}

export const NUMBER_OP_LABELS: Record<NumberFilterOp, string> = {
  eq: '=',
  neq: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  between: 'between',
}

export const DATE_OP_LABELS: Record<DateFilterOp, string> = {
  on: 'on',
  onOrBefore: 'on or before',
  onOrAfter: 'on or after',
  between: 'between',
}

function toCells(value: unknown): string[] {
  if (Array.isArray(value)) {
    if (value.length === 0) return ['']
    return value.map((v) => (v == null || v === '' ? '' : String(v)))
  }
  if (value == null || value === '') return ['']
  return [String(value)]
}

export function taskTextFilter(value: unknown, filter: TextFilterValue | null | undefined): boolean {
  if (!filter) return true

  const cells = toCells(value)

  if (filter.mode === 'in') {
    const selected = filter.values ?? []
    if (selected.length === 0) return false
    return cells.some((cell) =>
      selected.some((sel) => {
        if (sel === BLANKS_OPTION) return cell === ''
        return sel === cell
      })
    )
  }

  const query = (filter.text ?? '').trim().toLowerCase()
  if (!query) return true

  const lowered = cells.map((cell) => cell.toLowerCase())
  switch (filter.mode) {
    case 'equals':
      return lowered.some((cell) => cell === query)
    case 'startsWith':
      return lowered.some((cell) => cell.startsWith(query))
    case 'notContains':
      return lowered.every((cell) => !cell.includes(query))
    default:
      return lowered.some((cell) => cell.includes(query))
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function taskNumberFilter(value: unknown, filter: NumberFilterValue | null | undefined): boolean {
  if (!filter || !isFiniteNumber(filter.value)) return true
  const num = typeof value === 'number' ? value : value == null || value === '' ? NaN : Number(value)
  if (!Number.isFinite(num)) return false

  const a = filter.value
  switch (filter.op) {
    case 'eq':
      return num === a
    case 'neq':
      return num !== a
    case 'gt':
      return num > a
    case 'gte':
      return num >= a
    case 'lt':
      return num < a
    case 'lte':
      return num <= a
    case 'between': {
      if (!isFiniteNumber(filter.to)) return num >= a
      const [lo, hi] = a <= filter.to ? [a, filter.to] : [filter.to, a]
      return num >= lo && num <= hi
    }
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Local calendar-day key (`YYYY-MM-DD`) for a date, or null when it is missing or invalid. */
export function toDayKey(value: unknown): string | null {
  if (value == null || value === '') return null
  const date = value instanceof Date ? value : new Date(value as string | number)
  if (Number.isNaN(date.getTime())) return null
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function taskDateFilter(value: unknown, filter: DateFilterValue | null | undefined): boolean {
  if (!filter) return true
  const from = filter.from || undefined
  const to = filter.to || undefined
  if (!from && !(filter.op === 'between' && to)) return true

  const day = toDayKey(value)
  if (!day) return false

  switch (filter.op) {
    case 'on':
      return day === from
    case 'onOrBefore':
      return day <= from!
    case 'onOrAfter':
      return day >= from!
    case 'between': {
      if (from && to) {
        const [lo, hi] = from <= to ? [from, to] : [to, from]
        return day >= lo && day <= hi
      }
      return from ? day >= from : day <= to!
    }
  }
}

/** Inclusive finish day of a task (milestones finish on their start day). */
export function taskFinishDate(task: ITask): Date | null {
  if (task.type === 'milestone') return task.start ? new Date(task.start) : null
  if (!task.end) return null
  return exclusiveEndToInclusiveFinish(new Date(task.end))
}

function taskProgress(task: ITask): number {
  const progress = Number(task.progress)
  return Number.isFinite(progress) ? progress : 0
}

export function matchesTaskPreset(task: ITask, preset: TaskFilterPreset | undefined, today: Date = new Date()): boolean {
  if (!preset || preset === 'all') return true
  if (preset === 'summary') return task.type === 'summary'
  // Summary rows still appear as ancestors of matching tasks; they never match on their own.
  if (task.type === 'summary') return false

  const progress = taskProgress(task)
  switch (preset) {
    case 'incomplete':
      return progress < 100
    case 'completed':
      return progress >= 100
    case 'inProgress':
      return progress > 0 && progress < 100
    case 'notStarted':
      return progress <= 0
    case 'milestones':
      return task.type === 'milestone'
    case 'unassigned': {
      const resources = (task as ITask & { resources?: unknown[] }).resources
      return !resources?.length
    }
    case 'late': {
      if (progress >= 100) return false
      const finish = toDayKey(taskFinishDate(task))
      const todayKey = toDayKey(today)
      return finish != null && todayKey != null && finish < todayKey
    }
  }
}

export function taskQuickFilter(task: unknown, filter: QuickFilterValue | null | undefined, today?: Date): boolean {
  if (!filter) return true
  const t = task as ITask
  if (!matchesTaskPreset(t, filter.preset, today)) return false

  const query = (filter.search ?? '').trim().toLowerCase()
  if (!query) return true
  return String(t.text ?? '').toLowerCase().includes(query) || String(t.id ?? '') === query
}

function isNumberFilter(value: ColumnFilterValue): value is NumberFilterValue {
  return (value as NumberFilterValue).kind === 'number'
}

function isDateFilter(value: ColumnFilterValue): value is DateFilterValue {
  return (value as DateFilterValue).kind === 'date'
}

/** Whether a column filter value actually narrows the task list. */
export function isColumnFilterActive(value: ColumnFilterValue | null | undefined): value is ColumnFilterValue {
  if (!value) return false
  if (isNumberFilter(value)) return isFiniteNumber(value.value)
  if (isDateFilter(value)) return Boolean(value.from || (value.op === 'between' && value.to))
  if (value.mode === 'in') return true
  return Boolean((value.text ?? '').trim())
}

export function isQuickFilterActive(value: QuickFilterValue | null | undefined): value is QuickFilterValue {
  if (!value) return false
  return (value.preset != null && value.preset !== 'all') || Boolean((value.search ?? '').trim())
}

function formatNumber(n: number): string {
  return String(Math.round(n * 100) / 100)
}

/** Short human-readable summary of a column filter, e.g. `Duration ≥ 3`. */
export function describeColumnFilter(title: string, value: ColumnFilterValue): string {
  if (isNumberFilter(value)) {
    const a = formatNumber(value.value ?? 0)
    if (value.op === 'between') {
      return isFiniteNumber(value.to) ? `${title} ${a}–${formatNumber(value.to)}` : `${title} ≥ ${a}`
    }
    return `${title} ${NUMBER_OP_LABELS[value.op]} ${a}`
  }
  if (isDateFilter(value)) {
    if (value.op === 'between') {
      if (value.from && value.to) return `${title} ${value.from} → ${value.to}`
      return value.from ? `${title} on or after ${value.from}` : `${title} on or before ${value.to}`
    }
    return `${title} ${DATE_OP_LABELS[value.op]} ${value.from}`
  }
  if (value.mode === 'in') {
    const values = value.values ?? []
    if (values.length === 0) return `${title}: none selected`
    if (values.length <= 2) return `${title}: ${values.join(', ')}`
    return `${title}: ${values.length} values`
  }
  return `${title} ${TEXT_MODE_LABELS[value.mode]} "${(value.text ?? '').trim()}"`
}

export function presetLabel(preset: TaskFilterPreset): string {
  return TASK_FILTER_PRESETS.find((p) => p.id === preset)?.label ?? preset
}

type FilterableColumn = {
  id?: string | number
  getter?: (task: ITask) => unknown
  header?: unknown
}

function findFilterHandler(column: FilterableColumn): ((value: unknown, filter: unknown) => boolean) | null {
  const headers = Array.isArray(column.header) ? column.header : [column.header]
  for (const header of headers) {
    const handler = (header as { filter?: { config?: { handler?: unknown } } } | undefined)?.filter?.config?.handler
    if (typeof handler === 'function') return handler as (value: unknown, filter: unknown) => boolean
  }
  return null
}

/**
 * Builds the same predicate the Gantt applies for the given filter values, so
 * callers can count direct matches outside the grid.
 */
export function createTaskMatcher(
  filterValues: Record<string, unknown> | undefined,
  columns: FilterableColumn[]
): (task: ITask) => boolean {
  const checks: Array<(task: ITask) => boolean> = []
  for (const [key, value] of Object.entries(filterValues ?? {})) {
    if (value == null) continue
    const column = columns.find((c) => String(c.id) === key)
    if (!column) continue
    const handler = findFilterHandler(column)
    if (!handler) continue
    const get = column.getter ?? ((task: ITask) => (task as Record<string, unknown>)[key])
    checks.push((task) => handler(get(task), value))
  }
  return (task) => checks.every((check) => check(task))
}

export function collectDistinctOptions(
  tasks: ITask[],
  get: (t: ITask) => unknown
): { options: string[]; hasBlank: boolean; counts: Record<string, number> } {
  const counts: Record<string, number> = Object.create(null)
  let hasBlank = false

  for (const task of tasks) {
    const raw = get(task)
    const cells = new Set(toCells(raw))
    for (const cell of cells) {
      const key = cell === '' ? BLANKS_OPTION : cell
      if (cell === '') hasBlank = true
      counts[key] = (counts[key] ?? 0) + 1
    }
  }

  const options = Object.keys(counts)
    .filter((key) => key !== BLANKS_OPTION || !hasBlank)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))

  return { options, hasBlank, counts }
}

export function workHours(task: ITask, durationUnit: 'day' | 'hour', workingHoursPerDay: number): number {
  const duration = Number(task.duration)
  return Number.isFinite(duration) && duration >= 0
    ? durationUnit === 'day'
      ? duration * workingHoursPerDay
      : duration
    : 0
}
