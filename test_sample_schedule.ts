import assert from 'node:assert/strict'
import type { ILink, ITask } from '@svar-ui/react-gantt'
import {
  autoScheduleTasks,
  calculateEndDate,
  createSvarCalendarAdapter,
  defaultCalendarConfig,
  exclusiveEndToInclusiveFinish,
  formatToDateString,
} from './src/lib/scheduler.ts'

function localDate(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day, 0, 0, 0, 0)
}

function dateString(date: Date): string {
  return formatToDateString(date)
}

const start = localDate(2026, 9, 1)
const holiday = localDate(2026, 9, 2)
const exclusiveEnd = localDate(2026, 9, 4)
const calendar = createSvarCalendarAdapter(defaultCalendarConfig, 'day')

assert.equal(calendar.isWorkingDay(holiday), false)
assert.equal(dateString(calendar.addWorkingDays(start, 2)), '2026-09-04')
assert.equal(calendar.getWorkingDays(start, exclusiveEnd, false), 2)
assert.equal(dateString(calendar.addWorkingDays(start, 0)), '2026-09-01')

const calculatedEnd = calculateEndDate(start, 2, defaultCalendarConfig, 'day')
assert.equal(dateString(calculatedEnd), '2026-09-04')
assert.equal(
  dateString(exclusiveEndToInclusiveFinish(calculatedEnd)),
  '2026-09-03'
)

const tasks = [
  {
    id: 'regression-task',
    text: 'Two working days',
    start,
    duration: 2,
    type: 'task',
  },
  {
    id: 'regression-milestone',
    text: 'Milestone',
    start,
    duration: 0,
    type: 'milestone',
  },
] as unknown as ITask[]
const scheduled = autoScheduleTasks(
  tasks,
  [] as ILink[],
  defaultCalendarConfig,
  'day'
)
const scheduledTask = scheduled.find((task) => task.id === 'regression-task')
const scheduledMilestone = scheduled.find(
  (task) => task.id === 'regression-milestone'
)

assert.ok(scheduledTask)
assert.equal(dateString(scheduledTask.start as Date), '2026-09-01')
assert.equal(dateString(scheduledTask.end as Date), '2026-09-04')
assert.ok(scheduledMilestone)
assert.equal(dateString(scheduledMilestone.start as Date), '2026-09-01')
assert.equal(dateString(scheduledMilestone.end as Date), '2026-09-01')

console.log('PASS: SVAR calendar adapter preserves working-day and milestone boundaries')
