import { describe, expect, it } from 'vitest'
import type { ILink, ITask } from '@svar-ui/react-gantt'
import {
  addWorkingDays,
  addWorkingHours,
  autoScheduleTasks,
  calculateEndDate,
  calculateTaskDuration,
  calculateWorkingDays,
  createSvarCalendarAdapter,
  exclusiveEndToInclusiveFinish,
  formatToDateString,
  getNextWorkingDay,
  getPreviousWorkingDay,
  getWorkingDayAfter,
  inclusiveFinishToExclusiveEnd,
  isWorkingDay,
  subtractWorkingDays,
  type ProjectCalendarConfig,
} from '@/lib/scheduler'

const localDate = (year: number, month: number, day: number) =>
  new Date(year, month - 1, day)

const dateString = (date: Date) => formatToDateString(date)

const calendar: ProjectCalendarConfig = {
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5],
  holidays: [{ id: 'national-day', date: '2026-09-02', name: 'National Day' }],
}

const workWeekCalendar: ProjectCalendarConfig = {
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5],
  holidays: [],
}

function task(
  id: number,
  start: Date,
  duration: number,
  type: 'task' | 'milestone' = 'task'
): ITask {
  return {
    id,
    text: `Task ${id}`,
    start,
    duration,
    progress: 0,
    type,
  }
}

function link(id: number, source: number, target: number, type: ILink['type']): ILink {
  return { id, source, target, type }
}

function scheduledTask(tasks: ITask[], id: number): ITask {
  const result = tasks.find((item) => item.id === id)
  if (!result) throw new Error(`Missing task ${id}`)
  return result
}

describe('working-day calendar boundaries', () => {
  it('recognizes weekdays, weekends, and configured holidays', () => {
    expect(isWorkingDay(localDate(2026, 9, 1), calendar)).toBe(true)
    expect(isWorkingDay(localDate(2026, 9, 2), calendar)).toBe(false)
    expect(isWorkingDay(localDate(2026, 9, 5), calendar)).toBe(false)
  })

  it('finds the next and previous working day across weekends and holidays', () => {
    expect(dateString(getNextWorkingDay(localDate(2026, 9, 2), calendar))).toBe('2026-09-03')
    expect(dateString(getNextWorkingDay(localDate(2026, 9, 5), calendar))).toBe('2026-09-07')
    expect(dateString(getPreviousWorkingDay(localDate(2026, 9, 2), calendar))).toBe('2026-09-01')
    expect(dateString(getPreviousWorkingDay(localDate(2026, 9, 6), calendar))).toBe('2026-09-04')
  })

  it('gets a working day strictly after the input and handles non-positive counts', () => {
    expect(dateString(getWorkingDayAfter(localDate(2026, 9, 1), 1, calendar))).toBe('2026-09-03')
    expect(dateString(getWorkingDayAfter(localDate(2026, 9, 2), 0, calendar))).toBe('2026-09-03')
    expect(dateString(getWorkingDayAfter(localDate(2026, 9, 5), -1, calendar))).toBe('2026-09-07')
  })
})

describe('working-day durations and boundaries', () => {
  it('adds and subtracts working days with an exclusive end boundary', () => {
    expect(dateString(addWorkingDays(localDate(2026, 9, 4), 2, calendar))).toBe('2026-09-08')
    expect(dateString(addWorkingDays(localDate(2026, 9, 2), 1, calendar))).toBe('2026-09-04')
    expect(dateString(addWorkingDays(localDate(2026, 9, 6), 0, calendar))).toBe('2026-09-06')

    expect(dateString(subtractWorkingDays(localDate(2026, 9, 8), 2, calendar))).toBe('2026-09-04')
    expect(dateString(subtractWorkingDays(localDate(2026, 9, 8), 0, calendar))).toBe('2026-09-08')
  })

  it('calculates day and hour durations over a half-open interval', () => {
    const start = localDate(2026, 9, 4)
    const exclusiveEnd = localDate(2026, 9, 8)

    expect(calculateWorkingDays(start, exclusiveEnd, calendar)).toBe(2)
    expect(calculateTaskDuration(start, exclusiveEnd, calendar, 'day')).toBe(2)
    expect(calculateTaskDuration(start, exclusiveEnd, calendar, 'hour')).toBe(16)
    expect(calculateTaskDuration(exclusiveEnd, start, calendar, 'day')).toBe(0)
  })

  it('calculates exclusive ends in day and hour units and preserves zero duration', () => {
    const start = localDate(2026, 9, 4)

    expect(dateString(calculateEndDate(start, 2, calendar, 'day'))).toBe('2026-09-08')
    expect(dateString(calculateEndDate(start, 9, calendar, 'hour'))).toBe('2026-09-08')
    expect(dateString(addWorkingHours(start, 0, calendar))).toBe('2026-09-04')
    expect(dateString(calculateEndDate(start, 0, calendar, 'day'))).toBe('2026-09-04')
  })

  it('converts between exclusive task ends and inclusive finish dates', () => {
    const finish = localDate(2026, 9, 4)
    const exclusiveEnd = inclusiveFinishToExclusiveEnd(finish)

    expect(dateString(exclusiveEnd)).toBe('2026-09-05')
    expect(dateString(exclusiveEndToInclusiveFinish(exclusiveEnd))).toBe('2026-09-04')
  })
})
describe('SVAR calendar adapter', () => {
  it('adapts day and hour calendar operations, including negative offsets', () => {
    for (const durationUnit of ['day', 'hour'] as const) {
      const adapter = createSvarCalendarAdapter(workWeekCalendar, durationUnit)

      expect(adapter.durationUnit).toBe(durationUnit)
      expect(adapter.isWorkingDay(new Date(2026, 8, 5, 15))).toBe(false)
      expect(dateString(adapter.getNextWorkingDay(localDate(2026, 9, 5)))).toBe(
        '2026-09-07'
      )
      expect(dateString(adapter.getPreviousWorkingDay(localDate(2026, 9, 6)))).toBe(
        '2026-09-04'
      )
      expect(dateString(adapter.addWorkingDays(localDate(2026, 9, 4), 2))).toBe(
        '2026-09-08'
      )
      expect(dateString(adapter.addWorkingDays(localDate(2026, 9, 7), -1))).toBe(
        '2026-09-04'
      )
      expect(adapter.getWorkingDays(localDate(2026, 9, 4), localDate(2026, 9, 8))).toBe(2)
      expect(adapter.getWorkingDays(localDate(2026, 9, 8), localDate(2026, 9, 4))).toBe(2)
      expect(adapter.getWorkingDays(localDate(2026, 9, 4), localDate(2026, 9, 4))).toBe(0)
      expect(dateString(adapter.addWorkingHours(localDate(2026, 9, 4), 9))).toBe(
        '2026-09-08'
      )
      expect(adapter.getWorkingHours(localDate(2026, 9, 4))).toBe(8)
      expect(adapter.getWorkingHours(localDate(2026, 9, 5))).toBe(0)
      expect(adapter.getWorkingHours(localDate(2026, 9, 4), localDate(2026, 9, 8))).toBe(16)
    }
  })

  it('uses eight working hours as the fallback when configured hours are zero', () => {
    const fallbackCalendar = { ...workWeekCalendar, workingHoursPerDay: 0 }
    const adapter = createSvarCalendarAdapter(fallbackCalendar, 'hour')

    expect(adapter.getWorkingHours(localDate(2026, 9, 7))).toBe(8)
    expect(adapter.getWorkingHours(localDate(2026, 9, 7), localDate(2026, 9, 8))).toBe(8)
    expect(dateString(adapter.addWorkingHours(localDate(2026, 9, 7), 1))).toBe('2026-09-08')
    expect(calculateTaskDuration(localDate(2026, 9, 7), localDate(2026, 9, 8), fallbackCalendar, 'hour')).toBe(8)
  })
})


describe('autoScheduleTasks dependency semantics', () => {
  it('schedules finish-to-start dependencies from the predecessor exclusive end', () => {
    const result = autoScheduleTasks(
      [
        task(1, localDate(2026, 9, 7), 2),
        task(2, localDate(2026, 9, 1), 1),
      ],
      [link(1, 1, 2, 'e2s')],
      workWeekCalendar,
      'day'
    )

    expect(dateString(scheduledTask(result, 1).end!)).toBe('2026-09-09')
    expect(dateString(scheduledTask(result, 2).start)).toBe('2026-09-09')
    expect(dateString(scheduledTask(result, 2).end!)).toBe('2026-09-10')
  })

  it('schedules start-to-start dependencies from the predecessor start', () => {
    const result = autoScheduleTasks(
      [
        task(1, localDate(2026, 9, 8), 2),
        task(2, localDate(2026, 9, 11), 1),
      ],
      [link(2, 1, 2, 's2s')],
      workWeekCalendar,
      'day'
    )

    expect(dateString(scheduledTask(result, 2).start)).toBe('2026-09-08')
    expect(dateString(scheduledTask(result, 2).end!)).toBe('2026-09-09')
  })

  it('schedules finish-to-finish dependencies by matching exclusive ends', () => {
    const result = autoScheduleTasks(
      [
        task(1, localDate(2026, 9, 7), 2),
        task(2, localDate(2026, 9, 11), 2),
      ],
      [link(3, 1, 2, 'e2e')],
      workWeekCalendar,
      'day'
    )

    expect(dateString(scheduledTask(result, 1).end!)).toBe('2026-09-09')
    expect(dateString(scheduledTask(result, 2).start)).toBe('2026-09-07')
    expect(dateString(scheduledTask(result, 2).end!)).toBe('2026-09-09')
  })

  it('schedules start-to-finish dependencies so the successor ends at the predecessor start', () => {
    const result = autoScheduleTasks(
      [
        task(1, localDate(2026, 9, 9), 1),
        task(2, localDate(2026, 9, 11), 2),
      ],
      [link(4, 1, 2, 's2e')],
      workWeekCalendar,
      'day'
    )

    expect(dateString(scheduledTask(result, 2).start)).toBe('2026-09-07')
    expect(dateString(scheduledTask(result, 2).end!)).toBe('2026-09-09')
  })

  it('keeps milestones zero-width when dependency scheduling moves them', () => {
    const result = autoScheduleTasks(
      [
        task(1, localDate(2026, 9, 7), 1),
        task(2, localDate(2026, 9, 12), 0, 'milestone'),
      ],
      [link(5, 1, 2, 'e2s')],
      workWeekCalendar,
      'day'
    )

    const milestone = scheduledTask(result, 2)
    expect(dateString(milestone.start)).toBe('2026-09-08')
    expect(dateString(milestone.end!)).toBe('2026-09-08')
    expect(milestone.duration).toBe(0)
  })
  it('applies positive, negative, and unknown dependency lags', () => {
    const result = autoScheduleTasks(
      [
        task(1, localDate(2026, 9, 7), 3),
        task(2, localDate(2026, 9, 1), 1),
        task(3, localDate(2026, 9, 1), 1),
        task(4, localDate(2026, 9, 1), 1),
        task(5, localDate(2026, 9, 1), 1),
      ],
      [
        { ...link(6, 1, 2, 'e2s'), lag: 1 },
        { ...link(7, 1, 3, 'e2s'), lag: -1 },
        { ...link(8, 1, 4, 'unknown' as ILink['type']) },
        { ...link(9, 1, 5, undefined as unknown as ILink['type']) },
      ],
      workWeekCalendar,
      'day'
    )

    expect(dateString(scheduledTask(result, 1).end!)).toBe('2026-09-10')
    expect(dateString(scheduledTask(result, 2).start)).toBe('2026-09-11')
    expect(dateString(scheduledTask(result, 5).start)).toBe('2026-09-10')
    expect(dateString(scheduledTask(result, 3).start)).toBe('2026-09-09')
    expect(dateString(scheduledTask(result, 4).start)).toBe('2026-09-10')
  })

  it('applies positive lags to start-to-start, finish-to-finish, and start-to-finish links', () => {
    const result = autoScheduleTasks(
      [
        task(1, localDate(2026, 9, 7), 2),
        task(2, localDate(2026, 9, 1), 1),
        task(3, localDate(2026, 9, 1), 2),
        task(4, localDate(2026, 9, 1), 2),
      ],
      [
        { ...link(9, 1, 2, 's2s'), lag: 2 },
        { ...link(10, 1, 3, 'e2e'), lag: 1 },
        { ...link(11, 1, 4, 's2e'), lag: 2 },
      ],
      workWeekCalendar,
      'day'
    )

    expect(dateString(scheduledTask(result, 2).start)).toBe('2026-09-09')
    expect(dateString(scheduledTask(result, 3).start)).toBe('2026-09-08')
    expect(dateString(scheduledTask(result, 3).end!)).toBe('2026-09-10')
    expect(dateString(scheduledTask(result, 4).start)).toBe('2026-09-07')
    expect(dateString(scheduledTask(result, 4).end!)).toBe('2026-09-09')
  })

  it('keeps e2e and s2e milestones zero-width at their lagged constraints', () => {
    const result = autoScheduleTasks(
      [
        task(1, localDate(2026, 9, 7), 2),
        task(2, localDate(2026, 9, 1), 0, 'milestone'),
        task(3, localDate(2026, 9, 7), 0, 'milestone'),
        task(4, localDate(2026, 9, 1), 0, 'milestone'),
      ],
      [
        link(12, 1, 2, 'e2e'),
        { ...link(13, 3, 4, 's2e'), lag: 1 },
      ],
      workWeekCalendar,
      'day'
    )

    expect(dateString(scheduledTask(result, 2).start)).toBe('2026-09-09')
    expect(dateString(scheduledTask(result, 2).end!)).toBe('2026-09-09')
    expect(dateString(scheduledTask(result, 4).start)).toBe('2026-09-08')
    expect(dateString(scheduledTask(result, 4).end!)).toBe('2026-09-08')
    expect(scheduledTask(result, 2).duration).toBe(0)
    expect(scheduledTask(result, 4).duration).toBe(0)
  })

  it('uses hour durations and converts hour lags into working-day constraints', () => {
    const result = autoScheduleTasks(
      [
        task(1, localDate(2026, 9, 7), 16),
        task(2, localDate(2026, 9, 1), 9),
        task(3, localDate(2026, 9, 7), 8),
        task(4, localDate(2026, 9, 1), 16),
        task(5, localDate(2026, 9, 7), 8),
        task(6, localDate(2026, 9, 1), 16),
      ],
      [
        { ...link(14, 1, 2, 'e2s'), lag: 9 },
        { ...link(15, 3, 4, 'e2e'), lag: 8 },
        { ...link(16, 5, 6, 's2e'), lag: 8 },
      ],
      workWeekCalendar,
      'hour'
    )

    expect(dateString(scheduledTask(result, 1).end!)).toBe('2026-09-09')
    expect(dateString(scheduledTask(result, 2).start)).toBe('2026-09-11')
    expect(dateString(scheduledTask(result, 2).end!)).toBe('2026-09-15')
    expect(dateString(scheduledTask(result, 4).start)).toBe('2026-09-07')
    expect(dateString(scheduledTask(result, 4).end!)).toBe('2026-09-09')
    expect(dateString(scheduledTask(result, 6).start)).toBe('2026-09-04')
    expect(dateString(scheduledTask(result, 6).end!)).toBe('2026-09-08')
  })

  it('ignores missing predecessors and invalid public task or link inputs', () => {
    const noId = { text: 'No id', start: localDate(2026, 9, 7), duration: 1 } as ITask
    const result = autoScheduleTasks(
      [
        task(21, localDate(2026, 9, 7), 1),
        noId,
      ],
      [
        { id: 17, source: 999, target: 21, type: 'e2s' },
        { id: 18, source: 21, target: undefined, type: 'e2s' } as ILink,
        { id: 19, source: undefined, target: 21, type: 'e2s' } as ILink,
      ],
      workWeekCalendar,
      'day'
    )

    expect(dateString(scheduledTask(result, 21).start)).toBe('2026-09-07')
    expect(dateString(scheduledTask(result, 21).end!)).toBe('2026-09-08')
    expect(result[1]).toBe(noId)
  })

  it('normalizes a task with a missing start without throwing', () => {
    const result = autoScheduleTasks(
      [{ id: 22, text: 'Missing start', duration: 2, type: 'task' } as ITask],
      [],
      workWeekCalendar,
      'day'
    )
    const resolved = scheduledTask(result, 22)

    expect(resolved.start).toBeInstanceOf(Date)
    expect(resolved.end).toBeInstanceOf(Date)
    expect(resolved.duration).toBe(2)
  })

  it('breaks dependency cycles while still returning scheduled tasks', () => {
    const result = autoScheduleTasks(
      [
        task(23, localDate(2026, 9, 7), 1),
        task(24, localDate(2026, 9, 7), 1),
      ],
      [link(20, 23, 24, 'e2s'), link(21, 24, 23, 'e2s')],
      workWeekCalendar,
      'day'
    )

    expect(dateString(scheduledTask(result, 24).start)).toBe('2026-09-08')
    expect(dateString(scheduledTask(result, 23).start)).toBe('2026-09-09')
  })

  it('aggregates summary dates and duration across regular and milestone children', () => {
    const summary = {
      id: 30,
      text: 'Summary',
      start: localDate(2026, 9, 1),
      duration: 1,
      progress: 0,
      type: 'summary',
    } as ITask
    const emptySummary = {
      id: 31,
      text: 'Empty summary',
      start: localDate(2026, 9, 1),
      duration: 1,
      progress: 0,
      type: 'summary',
    } as ITask
    const result = autoScheduleTasks(
      [
        summary,
        emptySummary,
        { ...task(32, localDate(2026, 9, 7), 0, 'milestone'), parent: 30 },
        { ...task(33, localDate(2026, 9, 4), 1), parent: 30 },
        { ...task(34, localDate(2026, 9, 9), 1), parent: 30 },
      ],
      [],
      workWeekCalendar,
      'day'
    )

    expect(dateString(scheduledTask(result, 32).start)).toBe('2026-09-07')
    expect(dateString(scheduledTask(result, 32).end!)).toBe('2026-09-07')
    expect(dateString(scheduledTask(result, 30).start)).toBe('2026-09-04')
    expect(dateString(scheduledTask(result, 30).end!)).toBe('2026-09-10')
    expect(scheduledTask(result, 30).duration).toBe(4)
    expect(dateString(scheduledTask(result, 31).start)).toBe('2026-09-01')
    expect(dateString(scheduledTask(result, 31).end!)).toBe('2026-09-02')
  })
  it('aggregates dates and duration into a regular task parent without changing its type', () => {
    const result = autoScheduleTasks(
      [
        { ...task(40, localDate(2026, 9, 7), 5), open: false },
        { ...task(41, localDate(2026, 9, 1), 1), parent: 40 },
      ],
      [],
      workWeekCalendar,
      'day'
    )

    const parent = scheduledTask(result, 40)
    expect(parent).toMatchObject({ type: 'task', open: false, duration: 1 })
    expect(dateString(parent.start)).toBe('2026-09-01')
    expect(dateString(parent.end!)).toBe('2026-09-02')
    expect(dateString(scheduledTask(result, 41).start)).toBe('2026-09-01')
    expect(dateString(scheduledTask(result, 41).end!)).toBe('2026-09-02')
  })
  it('drops raw children assigned to a milestone parent', () => {
    const result = autoScheduleTasks(
      [
        task(50, localDate(2026, 9, 7), 0, 'milestone'),
        { ...task(51, localDate(2026, 9, 8), 2), parent: 50 },
      ],
      [],
      workWeekCalendar,
      'day'
    )

    expect(scheduledTask(result, 50).type).toBe('milestone')
    expect(scheduledTask(result, 51)).not.toHaveProperty('parent')
  })
})
