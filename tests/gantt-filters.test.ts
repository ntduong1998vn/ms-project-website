import { describe, expect, it } from 'vitest'
import type { ITask } from '@svar-ui/react-gantt'

import { BLANKS_OPTION, collectDistinctOptions, taskTextFilter, workHours } from '@/lib/gantt-filters'

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
