import type { ITask } from '@svar-ui/react-gantt'

export const BLANKS_OPTION = '(Blanks)'

export type TextFilterMode = 'contains' | 'equals' | 'in'
export type TextFilterValue = { mode: TextFilterMode; text?: string; values?: string[] }

function toCells(value: unknown): string[] {
  if (Array.isArray(value)) {
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

  if (filter.mode === 'equals') {
    return cells.some((cell) => cell.toLowerCase() === query)
  }

  return cells.some((cell) => cell.toLowerCase().includes(query))
}

export function collectDistinctOptions(
  tasks: ITask[],
  get: (t: ITask) => unknown
): { options: string[]; hasBlank: boolean } {
  const seen = new Set<string>()
  let hasBlank = false

  for (const task of tasks) {
    const raw = get(task)
    const cells = toCells(raw)
    for (const cell of cells) {
      if (cell === '') hasBlank = true
      else seen.add(cell)
    }
  }

  const options = [...seen].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  )

  return { options, hasBlank }
}

export function workHours(task: ITask, durationUnit: 'day' | 'hour', workingHoursPerDay: number): number {
  const duration = Number(task.duration)
  return Number.isFinite(duration) && duration >= 0
    ? durationUnit === 'day'
      ? duration * workingHoursPerDay
      : duration
    : 0
}
