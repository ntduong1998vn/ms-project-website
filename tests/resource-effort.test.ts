import { describe, expect, it } from 'vitest'
import type { ITask } from '@svar-ui/react-gantt'
import { getResourceEffortWarnings } from '@/lib/resource-effort'
import type { ProjectCalendarConfig } from '@/lib/scheduler'
import type { GanttResource, TaskWithResources } from '@/types/gantt'

const calendar: ProjectCalendarConfig = {
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5],
  holidays: [{ id: 'holiday', date: '2026-09-02', name: 'Holiday' }],
}
const resources: GanttResource[] = [
  { id: 1, label: 'Alex' },
  { id: 2, label: 'Sam' },
]

function task(id: number, start: Date, end: Date, duration: number, assigned: number[], type: ITask['type'] = 'task'): ITask {
  return { id, text: `Task ${id}`, start, end, duration, type, resources: assigned } as TaskWithResources
}

describe('getResourceEffortWarnings', () => {
  it('aggregates overloads by resource and date for multi-resource assignments', () => {
    const warnings = getResourceEffortWarnings([
      task(1, new Date(2026, 8, 7), new Date(2026, 8, 8), 1, [1, 2]),
      task(2, new Date(2026, 8, 7), new Date(2026, 8, 8), 1, [1]),
      task(3, new Date(2026, 8, 7), new Date(2026, 8, 8), 1, [2]),
    ], resources, calendar, 'day')

    expect(warnings.get('1')).toHaveLength(2)
    expect(warnings.get('1')?.map((warning) => warning.resourceLabel).sort()).toEqual(['Alex', 'Sam'])
    expect(warnings.get('2')?.[0]).toMatchObject({ resourceLabel: 'Alex', date: '2026-09-07', totalHours: 12, capacityHours: 8 })
    expect(warnings.get('3')?.[0]).toMatchObject({ resourceLabel: 'Sam', date: '2026-09-07', totalHours: 12, capacityHours: 8 })
    expect(warnings.get('2')?.[0].tasks.map((entry) => entry.id).sort()).toEqual([1, 2])
  })

  it('distributes day and hour effort over working days and skips holidays and weekends', () => {
    const dayWarnings = getResourceEffortWarnings([
      task(5, new Date(2026, 8, 5), new Date(2026, 8, 7), 1, [1]),
      task(4, new Date(2026, 8, 1), new Date(2026, 8, 4), 2, [1]),
    ], resources, calendar, 'day')
    const hourWarnings = getResourceEffortWarnings([
      task(6, new Date(2026, 8, 1), new Date(2026, 8, 4), 16, [1]),
      task(7, new Date(2026, 8, 1), new Date(2026, 8, 4), 16, [1]),
    ], resources, calendar, 'hour')

    expect(dayWarnings.size).toBe(0)
    expect(hourWarnings.get('6')?.[0]).toMatchObject({ date: '2026-09-01', totalHours: 16, capacityHours: 8 })
    expect(hourWarnings.get('6')).toHaveLength(2)
    expect(hourWarnings.get('6')?.map((warning) => warning.date)).toEqual(['2026-09-01', '2026-09-03'])
  })

  it('excludes summaries, milestones, zero-duration tasks, and unassigned tasks', () => {
    const warnings = getResourceEffortWarnings([
      task(8, new Date(2026, 8, 7), new Date(2026, 8, 8), 1, [1], 'summary'),
      task(9, new Date(2026, 8, 7), new Date(2026, 8, 8), 0, [1], 'milestone'),
      task(10, new Date(2026, 8, 7), new Date(2026, 8, 8), 1, [], 'task'),
      task(11, new Date(2026, 8, 7), new Date(2026, 8, 8), 0, [1], 'task'),
    ], resources, calendar, 'day')

    expect(warnings.size).toBe(0)
  })
  it('ignores unknown or missing assignments and uses a fallback resource label', () => {
    const missing = task(12, new Date(2026, 8, 7), new Date(2026, 8, 8), 1, [1])
    delete (missing as TaskWithResources).resources
    const unknownWarnings = getResourceEffortWarnings([
      missing,
      task(13, new Date(2026, 8, 7), new Date(2026, 8, 8), 1, [999]),
    ], resources, calendar, 'day')
    const fallbackWarnings = getResourceEffortWarnings([
      task(14, new Date(2026, 8, 7), new Date(2026, 8, 8), 1, [3]),
      task(15, new Date(2026, 8, 7), new Date(2026, 8, 8), 1, [3]),
    ], [{ id: 3, label: '' }], calendar, 'day')

    expect(unknownWarnings).toEqual(new Map())
    expect(fallbackWarnings.get('14')?.[0]).toMatchObject({ resourceLabel: 'Resource 3', totalHours: 16 })
  })
})
