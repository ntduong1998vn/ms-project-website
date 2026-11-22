import { describe, expect, it } from 'vitest'
import type { ITask } from '@svar-ui/react-gantt'

import {
  BLANKS_OPTION,
  collectDistinctOptions,
  createTaskMatcher,
  describeColumnFilter,
  isColumnFilterActive,
  isQuickFilterActive,
  matchesTaskPreset,
  presetLabel,
  toDayKey,
  taskDateFilter,
  taskFinishDate,
  taskNumberFilter,
  taskQuickFilter,
  taskTextFilter,
  workHours,
} from '@/lib/gantt-filters'

function task(id: number, text = `task ${id}`, options: Partial<ITask> = {}): ITask {
  return { id, text, type: 'task', ...options } as ITask
}

describe('taskTextFilter', () => {
  it('returns true for null or undefined filter', () => {
    expect(taskTextFilter('anything', null)).toBe(true)
    expect(taskTextFilter('anything', undefined)).toBe(true)
  })

  it('contains is case-insensitive', () => {
    expect(taskTextFilter('Design Phase', { mode: 'contains', text: 'design' })).toBe(true)
    expect(taskTextFilter('Design Phase', { mode: 'contains', text: 'PHASE' })).toBe(true)
    expect(taskTextFilter('Design Phase', { mode: 'contains', text: 'research' })).toBe(false)
  })

  it('contains with empty or whitespace text passes everything', () => {
    expect(taskTextFilter('Design', { mode: 'contains', text: '' })).toBe(true)
    expect(taskTextFilter('Design', { mode: 'contains', text: '   ' })).toBe(true)
    expect(taskTextFilter('', { mode: 'contains', text: '   ' })).toBe(true)
  })

  it('equals is exact and case-insensitive', () => {
    expect(taskTextFilter('Design', { mode: 'equals', text: 'design' })).toBe(true)
    expect(taskTextFilter('Design', { mode: 'equals', text: 'Design' })).toBe(true)
    expect(taskTextFilter('Design Phase', { mode: 'equals', text: 'design' })).toBe(false)
  })

  it('equals with empty query passes everything', () => {
    expect(taskTextFilter('Design', { mode: 'equals', text: '' })).toBe(true)
  })

  it('in matches selected values and rejects non-members', () => {
    expect(taskTextFilter('Alpha', { mode: 'in', values: ['Alpha', 'Beta'] })).toBe(true)
    expect(taskTextFilter('Gamma', { mode: 'in', values: ['Alpha', 'Beta'] })).toBe(false)
    expect(taskTextFilter('', { mode: 'in', values: ['Alpha', 'Beta'] })).toBe(false)
  })

  it('in with BLANKS_OPTION matches empty values', () => {
    expect(taskTextFilter('', { mode: 'in', values: [BLANKS_OPTION] })).toBe(true)
    expect(taskTextFilter('Alpha', { mode: 'in', values: [BLANKS_OPTION] })).toBe(false)
  })

  it('in with no selection shows nothing', () => {
    expect(taskTextFilter('Alpha', { mode: 'in', values: [] })).toBe(false)
  })
  it('uses default values for omitted filter fields', () => {
    expect(taskTextFilter('Alpha', { mode: 'in' })).toBe(false)
    expect(taskTextFilter('Alpha', { mode: 'contains' })).toBe(true)
  })

  it('handles multi-value (array) cells', () => {
    const values = ['Frontend', 'Backend']
    expect(taskTextFilter(values, { mode: 'contains', text: 'back' })).toBe(true)
    expect(taskTextFilter(values, { mode: 'contains', text: 'design' })).toBe(false)
    expect(taskTextFilter(values, { mode: 'equals', text: 'frontend' })).toBe(true)
    expect(taskTextFilter(values, { mode: 'in', values: ['Backend'] })).toBe(true)
    expect(taskTextFilter(values, { mode: 'in', values: ['DevOps'] })).toBe(false)
  })
})

describe('collectDistinctOptions', () => {
  it('counts names that collide with Object.prototype keys', () => {
    const tasks = [{ text: '__proto__' }, { text: 'constructor' }, { text: 'constructor' }] as ITask[]
    const { options, counts } = collectDistinctOptions(tasks, (t) => t.text)
    expect(options).toEqual(['__proto__', 'constructor'])
    expect(counts['__proto__']).toBe(1)
    expect(counts['constructor']).toBe(2)
  })

  it('collects, dedupes, sorts, and reports blanks', () => {
    const tasks = [
      task(1, 'Design'),
      task(2, ''),
      task(3, 'Testing'),
      task(4, 'design'),
      task(5, ''),
    ]
    const { options, hasBlank } = collectDistinctOptions(tasks, (t) => t.text)
    expect(options).toEqual(['Design', 'design', 'Testing'])
    expect(hasBlank).toBe(true)
  })

  it('handles array values', () => {
    const tasks = [
      task(1, 'A', { resources: [1, 2] } as unknown as ITask),
      task(2, 'B', { resources: [2, 3] } as unknown as ITask),
    ]
    const { options, hasBlank } = collectDistinctOptions(tasks, (t) =>
      (t as unknown as { resources?: number[] }).resources?.map(String) ?? []
    )
    expect(options).toEqual(['1', '2', '3'])
    expect(hasBlank).toBe(false)
  })

  it('numeric sorting', () => {
    const tasks = [
      task(1, 'Task 10'),
      task(2, 'Task 2'),
      task(3, 'Task 1'),
    ]
    const { options } = collectDistinctOptions(tasks, (t) => t.text)
    expect(options).toEqual(['Task 1', 'Task 2', 'Task 10'])
  })
})

describe('workHours', () => {
  it('computes work in day or hour mode', () => {
    expect(workHours({ duration: 3 } as ITask, 'day', 8)).toBe(24)
    expect(workHours({ duration: 3 } as ITask, 'hour', 8)).toBe(3)
  })

  it('falls back to 0 for invalid durations', () => {
    expect(workHours({ duration: NaN } as ITask, 'day', 8)).toBe(0)
    expect(workHours({ duration: -1 } as ITask, 'day', 8)).toBe(0)
  })
})

describe('taskTextFilter extra modes', () => {
  it('startsWith matches the beginning only', () => {
    expect(taskTextFilter('Design Phase', { mode: 'startsWith', text: 'des' })).toBe(true)
    expect(taskTextFilter('Design Phase', { mode: 'startsWith', text: 'phase' })).toBe(false)
  })

  it('notContains excludes any matching cell', () => {
    expect(taskTextFilter('Design Phase', { mode: 'notContains', text: 'build' })).toBe(true)
    expect(taskTextFilter(['Alice', 'Bob'], { mode: 'notContains', text: 'bob' })).toBe(false)
  })
})

describe('taskNumberFilter', () => {
  it('ignores filters without a value', () => {
    expect(taskNumberFilter(5, { kind: 'number', op: 'gt', value: null })).toBe(true)
  })

  it('applies comparison operators', () => {
    expect(taskNumberFilter(5, { kind: 'number', op: 'gt', value: 3 })).toBe(true)
    expect(taskNumberFilter(3, { kind: 'number', op: 'gt', value: 3 })).toBe(false)
    expect(taskNumberFilter(3, { kind: 'number', op: 'gte', value: 3 })).toBe(true)
    expect(taskNumberFilter(2, { kind: 'number', op: 'lt', value: 3 })).toBe(true)
    expect(taskNumberFilter(3, { kind: 'number', op: 'lte', value: 3 })).toBe(true)
    expect(taskNumberFilter(3, { kind: 'number', op: 'eq', value: 3 })).toBe(true)
    expect(taskNumberFilter(3, { kind: 'number', op: 'neq', value: 3 })).toBe(false)
  })

  it('between is inclusive and order-independent', () => {
    expect(taskNumberFilter(4, { kind: 'number', op: 'between', value: 2, to: 4 })).toBe(true)
    expect(taskNumberFilter(4, { kind: 'number', op: 'between', value: 6, to: 3 })).toBe(true)
    expect(taskNumberFilter(7, { kind: 'number', op: 'between', value: 2, to: 4 })).toBe(false)
  })

  it('rejects non-numeric cells', () => {
    expect(taskNumberFilter(undefined, { kind: 'number', op: 'gte', value: 0 })).toBe(false)
  })
})

describe('taskDateFilter', () => {
  const day = new Date(2026, 2, 10, 15, 30)

  it('compares by local calendar day', () => {
    expect(taskDateFilter(day, { kind: 'date', op: 'on', from: '2026-03-10' })).toBe(true)
    expect(taskDateFilter(day, { kind: 'date', op: 'onOrBefore', from: '2026-03-09' })).toBe(false)
    expect(taskDateFilter(day, { kind: 'date', op: 'onOrAfter', from: '2026-03-10' })).toBe(true)
  })

  it('supports open and closed ranges', () => {
    expect(taskDateFilter(day, { kind: 'date', op: 'between', from: '2026-03-01', to: '2026-03-31' })).toBe(true)
    expect(taskDateFilter(day, { kind: 'date', op: 'between', from: '2026-03-11', to: '2026-03-31' })).toBe(false)
    expect(taskDateFilter(day, { kind: 'date', op: 'between', to: '2026-03-10' })).toBe(true)
  })

  it('is inactive without dates and rejects missing cells', () => {
    expect(taskDateFilter(day, { kind: 'date', op: 'on' })).toBe(true)
    expect(taskDateFilter(null, { kind: 'date', op: 'on', from: '2026-03-10' })).toBe(false)
  })
})

describe('taskFinishDate', () => {
  it('converts exclusive end to inclusive finish', () => {
    const finish = taskFinishDate(task(1, 'a', { start: new Date(2026, 2, 2), end: new Date(2026, 2, 5) }))
    expect(finish?.getDate()).toBe(4)
  })

  it('uses start for milestones', () => {
    const finish = taskFinishDate(task(1, 'm', { type: 'milestone', start: new Date(2026, 2, 2) }))
    expect(finish?.getDate()).toBe(2)
  })
})

describe('matchesTaskPreset', () => {
  const today = new Date(2026, 2, 10)
  const done = task(1, 'done', { progress: 100, end: new Date(2026, 2, 1) })
  const half = task(2, 'half', { progress: 50, end: new Date(2026, 2, 5) })
  const fresh = task(3, 'fresh', { progress: 0, end: new Date(2026, 2, 20), resources: [1] } as Partial<ITask>)
  const milestone = task(4, 'ms', { type: 'milestone', start: new Date(2026, 2, 15) })
  const summary = task(5, 'phase', { type: 'summary', progress: 0 })

  it('all matches everything', () => {
    expect([done, half, fresh, milestone, summary].every((t) => matchesTaskPreset(t, 'all', today))).toBe(true)
  })

  it('progress-based presets', () => {
    expect(matchesTaskPreset(done, 'completed', today)).toBe(true)
    expect(matchesTaskPreset(done, 'incomplete', today)).toBe(false)
    expect(matchesTaskPreset(half, 'inProgress', today)).toBe(true)
    expect(matchesTaskPreset(fresh, 'notStarted', today)).toBe(true)
    expect(matchesTaskPreset(half, 'notStarted', today)).toBe(false)
  })

  it('late means unfinished with a finish day before today', () => {
    expect(matchesTaskPreset(half, 'late', today)).toBe(true)
    expect(matchesTaskPreset(done, 'late', today)).toBe(false)
    expect(matchesTaskPreset(fresh, 'late', today)).toBe(false)
  })

  it('type and assignment presets', () => {
    expect(matchesTaskPreset(milestone, 'milestones', today)).toBe(true)
    expect(matchesTaskPreset(half, 'milestones', today)).toBe(false)
    expect(matchesTaskPreset(summary, 'summary', today)).toBe(true)
    expect(matchesTaskPreset(summary, 'notStarted', today)).toBe(false)
    expect(matchesTaskPreset(half, 'unassigned', today)).toBe(true)
    expect(matchesTaskPreset(fresh, 'unassigned', today)).toBe(false)
  })
})

describe('taskQuickFilter', () => {
  const t = task(12, 'Write Specs', { progress: 0 })

  it('searches by name or exact id', () => {
    expect(taskQuickFilter(t, { search: 'spec' })).toBe(true)
    expect(taskQuickFilter(t, { search: '12' })).toBe(true)
    expect(taskQuickFilter(t, { search: '1' })).toBe(false)
  })

  it('combines search with preset', () => {
    expect(taskQuickFilter(t, { preset: 'completed', search: 'spec' })).toBe(false)
    expect(taskQuickFilter(t, { preset: 'notStarted', search: 'spec' })).toBe(true)
  })
})

describe('filter activity and descriptions', () => {
  it('detects active filters', () => {
    expect(isColumnFilterActive({ mode: 'contains', text: '  ' })).toBe(false)
    expect(isColumnFilterActive({ mode: 'in', values: [] })).toBe(true)
    expect(isColumnFilterActive({ kind: 'number', op: 'gt', value: 0 })).toBe(true)
    expect(isColumnFilterActive({ kind: 'date', op: 'on' })).toBe(false)
    expect(isQuickFilterActive({ preset: 'all', search: '' })).toBe(false)
    expect(isQuickFilterActive({ preset: 'late' })).toBe(true)
  })

  it('describes filters for chips', () => {
    expect(describeColumnFilter('Duration', { kind: 'number', op: 'gte', value: 3 })).toBe('Duration ≥ 3')
    expect(describeColumnFilter('Duration', { kind: 'number', op: 'between', value: 2, to: 5 })).toBe('Duration 2–5')
    expect(describeColumnFilter('Start', { kind: 'date', op: 'between', from: '2026-03-01', to: '2026-03-31' })).toBe(
      'Start 2026-03-01 → 2026-03-31'
    )
    expect(describeColumnFilter('Resource', { mode: 'in', values: ['Alice', 'Bob', 'Carol'] })).toBe('Resource: 3 values')
  })
})

describe('createTaskMatcher', () => {
  const columns = [
    { id: 'text', header: { filter: { config: { handler: taskTextFilter } } } },
    { id: 'duration', header: { filter: { config: { handler: taskNumberFilter } } } },
  ]

  it('combines every column filter', () => {
    const matcher = createTaskMatcher(
      { text: { mode: 'contains', text: 'spec' }, duration: { kind: 'number', op: 'gte', value: 3 } },
      columns
    )
    expect(matcher(task(1, 'Specs', { duration: 4 }))).toBe(true)
    expect(matcher(task(2, 'Specs', { duration: 1 }))).toBe(false)
    expect(matcher(task(3, 'Build', { duration: 4 }))).toBe(false)
  })

  it('matches everything without filters', () => {
    expect(createTaskMatcher({}, columns)(task(1))).toBe(true)
  })
})

describe('collectDistinctOptions counts', () => {
  it('counts each value once per task', () => {
    const tasks = [task(1, 'A'), task(2, 'A'), task(3, '')]
    const result = collectDistinctOptions(tasks, (t) => t.text)
    expect(result.counts).toEqual({ A: 2, [BLANKS_OPTION]: 1 })
    expect(result.options).toEqual(['A'])
  })
})

describe('empty multi-value cells', () => {
  it('count as blank', () => {
    expect(taskTextFilter([], { mode: 'in', values: [BLANKS_OPTION] })).toBe(true)
    const result = collectDistinctOptions([task(1), task(2)], (t) => (t.id === 1 ? ['Alice'] : []))
    expect(result.hasBlank).toBe(true)
    expect(result.counts[BLANKS_OPTION]).toBe(1)
  })
})

describe('filter edge cases', () => {
  it('number filter parses numeric strings and open between', () => {
    expect(taskNumberFilter('5', { kind: 'number', op: 'gt', value: 3 })).toBe(true)
    expect(taskNumberFilter('', { kind: 'number', op: 'gt', value: 3 })).toBe(false)
    expect(taskNumberFilter(5, { kind: 'number', op: 'between', value: 3 })).toBe(true)
    expect(taskNumberFilter(5, null)).toBe(true)
  })

  it('date filter handles open ranges, strings and missing filters', () => {
    expect(taskDateFilter(new Date(2026, 2, 10), null)).toBe(true)
    expect(taskDateFilter(new Date(2026, 2, 10), { kind: 'date', op: 'between', from: '2026-03-10' })).toBe(true)
    expect(taskDateFilter(new Date(2026, 2, 10), { kind: 'date', op: 'between', from: '2026-03-31', to: '2026-03-01' })).toBe(true)
    expect(toDayKey('not a date')).toBeNull()
    expect(toDayKey('')).toBeNull()
    expect(toDayKey(new Date(2026, 0, 5).getTime())).toBe('2026-01-05')
  })

  it('finish date is null without dates', () => {
    expect(taskFinishDate(task(1))).toBeNull()
    expect(taskFinishDate(task(1, 'm', { type: 'milestone' }))).toBeNull()
  })

  it('presets and quick filter tolerate missing values', () => {
    expect(matchesTaskPreset(task(1), undefined)).toBe(true)
    expect(matchesTaskPreset(task(1), 'notStarted')).toBe(true)
    expect(matchesTaskPreset(task(1), 'late')).toBe(false)
    expect(taskQuickFilter(task(1), null)).toBe(true)
    expect(taskQuickFilter(task(1), { search: '  ' })).toBe(true)
    expect(taskQuickFilter({ id: 7 }, { search: 'x' })).toBe(false)
  })

  it('activity checks cover every kind', () => {
    expect(isColumnFilterActive(null)).toBe(false)
    expect(isColumnFilterActive({ kind: 'number', op: 'gt', value: null })).toBe(false)
    expect(isColumnFilterActive({ kind: 'date', op: 'between', to: '2026-03-01' })).toBe(true)
    expect(isColumnFilterActive({ kind: 'date', op: 'on', from: '2026-03-01' })).toBe(true)
    expect(isColumnFilterActive({ mode: 'contains', text: 'a' })).toBe(true)
    expect(isColumnFilterActive({ mode: 'contains' })).toBe(false)
    expect(isQuickFilterActive(null)).toBe(false)
    expect(isQuickFilterActive({ search: 'a' })).toBe(true)
    expect(isQuickFilterActive({})).toBe(false)
  })

  it('describes every filter shape', () => {
    expect(describeColumnFilter('Work', { kind: 'number', op: 'lt', value: 1.234 })).toBe('Work < 1.23')
    expect(describeColumnFilter('Work', { kind: 'number', op: 'between', value: 2 })).toBe('Work ≥ 2')
    expect(describeColumnFilter('Work', { kind: 'number', op: 'gt' })).toBe('Work > 0')
    expect(describeColumnFilter('Start', { kind: 'date', op: 'on', from: '2026-03-01' })).toBe('Start on 2026-03-01')
    expect(describeColumnFilter('Start', { kind: 'date', op: 'between', from: '2026-03-01' })).toBe(
      'Start on or after 2026-03-01'
    )
    expect(describeColumnFilter('Start', { kind: 'date', op: 'between', to: '2026-03-01' })).toBe(
      'Start on or before 2026-03-01'
    )
    expect(describeColumnFilter('Name', { mode: 'in', values: [] })).toBe('Name: none selected')
    expect(describeColumnFilter('Name', { mode: 'in' })).toBe('Name: none selected')
    expect(describeColumnFilter('Name', { mode: 'in', values: ['A', 'B'] })).toBe('Name: A, B')
    expect(describeColumnFilter('Name', { mode: 'startsWith', text: ' de ' })).toBe('Name begins with "de"')
    expect(describeColumnFilter('Name', { mode: 'contains' })).toBe('Name contains ""')
  })

  it('labels presets', () => {
    expect(presetLabel('late')).toBe('Late Tasks')
    expect(presetLabel('bogus' as never)).toBe('bogus')
  })

  it('matcher uses getters, header arrays and skips unusable filters', () => {
    const columns = [
      { id: 'name', getter: (t: ITask) => t.text, header: [{}, { filter: { config: { handler: taskTextFilter } } }] },
      { id: 'plain', header: { text: 'Plain' } },
      { id: 'noHeader' },
    ]
    const matcher = createTaskMatcher(
      { name: { mode: 'equals', text: 'alpha' }, plain: { mode: 'contains', text: 'x' }, missing: 1, none: null },
      columns
    )
    expect(matcher(task(1, 'Alpha'))).toBe(true)
    expect(matcher(task(2, 'Beta'))).toBe(false)
    expect(createTaskMatcher(undefined, columns)(task(1))).toBe(true)
    expect(createTaskMatcher({ noHeader: { mode: 'contains', text: 'x' } }, columns)(task(1))).toBe(true)
  })

  it('collectDistinctOptions ignores null array entries as blanks', () => {
    const result = collectDistinctOptions([task(1)], () => ['A', null])
    expect(result.hasBlank).toBe(true)
    expect(result.options).toEqual(['A'])
  })
})
