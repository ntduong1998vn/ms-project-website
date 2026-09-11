import { describe, expect, it } from 'vitest'
import type { ILink, ITask } from '@svar-ui/react-gantt'
import {
  addWorkingDays,
  addWorkingHours,
  autoScheduleTasks,
  calculateEndDate,
  calculateTaskDuration,
  calculateWorkingDays,
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
})
