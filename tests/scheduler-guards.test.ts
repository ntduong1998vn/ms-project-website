import { describe, expect, it } from 'vitest'
import {
  addWorkingDays,
  calculateWorkingDays,
  clampImportedDuration,
  isSchedulableEnd,
  isWorkingDay,
  MAX_TASK_DURATION_DAYS,
  subtractWorkingDays,
  type ProjectCalendarConfig,
} from '@/lib/scheduler'

/** The day-by-day walk `calculateWorkingDays` replaced, kept as the oracle. */
function referenceCount(start: Date, end: Date, calendar: ProjectCalendarConfig): number {
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  const e = new Date(end.getFullYear(), end.getMonth(), end.getDate())
  if (e.getTime() <= s.getTime()) return 0
  let cur = new Date(s)
  let count = 0
  while (cur.getTime() < e.getTime()) {
    if (isWorkingDay(cur, calendar)) count++
    cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1)
  }
  return count
}

function seededRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

const weekdays: ProjectCalendarConfig = { workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], holidays: [] }
const withHolidays: ProjectCalendarConfig = {
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5],
  holidays: [
    { id: '1', date: '2026-09-02', name: 'National Day' },
    { id: '2', date: '2026-10-12', name: 'Columbus Day' },
    { id: '3', date: '2026-12-25', name: 'Christmas' },
    { id: '4', date: '2027-01-01', name: 'New Year' },
    { id: '5', date: '2026-09-06', name: 'Holiday on a weekend' },
  ],
}
const weekendShift: ProjectCalendarConfig = {
  workingHoursPerDay: 6,
  workingDays: [0, 6],
  holidays: [{ id: '1', date: '2026-09-05', name: 'Break' }],
}
const singleDay: ProjectCalendarConfig = { workingHoursPerDay: 8, workingDays: [3], holidays: [] }

describe('calculateWorkingDays', () => {
  it('matches a day-by-day count across calendars and ranges', () => {
    const random = seededRandom(1337)
    for (const calendar of [weekdays, withHolidays, weekendShift, singleDay]) {
      for (let i = 0; i < 400; i++) {
        const startOffset = Math.floor(random() * 900) - 300
        const span = Math.floor(random() * 400)
        const start = new Date(2026, 0, 1 + startOffset)
        const end = new Date(2026, 0, 1 + startOffset + span)
        expect(calculateWorkingDays(start, end, calendar)).toBe(referenceCount(start, end, calendar))
      }
    }
  })

  it('handles DST transitions, empty ranges and reversed ranges', () => {
    const cases: Array<[Date, Date]> = [
      [new Date(2026, 2, 1), new Date(2026, 3, 1)],
      [new Date(2026, 9, 1), new Date(2026, 10, 1)],
      [new Date(2026, 5, 10), new Date(2026, 5, 10)],
      [new Date(2026, 5, 10), new Date(2026, 5, 1)],
    ]
    for (const [start, end] of cases) {
      expect(calculateWorkingDays(start, end, withHolidays)).toBe(referenceCount(start, end, withHolidays))
    }
  })

  it('returns a bounded answer for a far-future end date instead of walking to it', () => {
    const start = new Date(2026, 0, 1)
    const end = new Date(3000, 0, 1)
    const startedAt = Date.now()
    expect(calculateWorkingDays(start, end, withHolidays)).toBeGreaterThan(200_000)
    expect(Date.now() - startedAt).toBeLessThan(200)
  })
})

describe('import guards', () => {
  it('clamps an absurd duration to the schedulable window', () => {
    expect(clampImportedDuration(5, weekdays, 'day')).toBe(5)
    expect(clampImportedDuration(1e9, weekdays, 'day')).toBe(MAX_TASK_DURATION_DAYS)
    expect(clampImportedDuration(1e9, weekdays, 'hour')).toBe(MAX_TASK_DURATION_DAYS * 8)
  })

  it('rejects an end date far outside the schedulable window', () => {
    const start = new Date(2026, 0, 1)
    expect(isSchedulableEnd(start, new Date(2026, 5, 1))).toBe(true)
    expect(isSchedulableEnd(start, new Date(3000, 0, 1))).toBe(false)
    expect(isSchedulableEnd(start, new Date(2025, 0, 1))).toBe(false)
  })

  it('terminates on a duration far past the clamp', () => {
    const startedAt = Date.now()
    addWorkingDays(new Date(2026, 0, 1), 1e9, weekdays)
    subtractWorkingDays(new Date(2026, 0, 1), 1e9, weekdays)
    expect(Date.now() - startedAt).toBeLessThan(2000)
  })

  it('terminates when the calendar has no working day at all', () => {
    const broken: ProjectCalendarConfig = { workingHoursPerDay: 8, workingDays: [], holidays: [] }
    const startedAt = Date.now()
    addWorkingDays(new Date(2026, 0, 1), 10, broken)
    expect(Date.now() - startedAt).toBeLessThan(200)
  })
})
