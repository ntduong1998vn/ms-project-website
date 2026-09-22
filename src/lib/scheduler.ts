import type { ILink, ITask } from '@svar-ui/react-gantt'

export interface Holiday {
  id: string
  date: string // YYYY-MM-DD
  name: string
}

export interface ProjectCalendarConfig {
  workingHoursPerDay: number
  workingDays: number[] // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  holidays: Holiday[]
}

export const defaultCalendarConfig: ProjectCalendarConfig = {
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5], // Monday - Friday
  holidays: [
    { id: '1', date: '2026-09-02', name: 'National Day' },
    { id: '2', date: '2026-10-12', name: 'Columbus Day' },
    { id: '3', date: '2026-12-25', name: 'Christmas' },
  ],
}

/**
 * Longest run of consecutive non-working days the calendar walkers will scan.
 * A calendar that cannot produce a single working day within a year cannot
 * schedule anything, so scanning further only burns the main thread.
 */
const MAX_NON_WORKING_RUN_DAYS = 366

/**
 * Upper bound for one task's duration, in working days (~10 years).
 * Durations arrive from CSV and clipboard imports, where a typo such as `1e9`
 * would otherwise make the day-by-day walkers spin long enough to hang the tab.
 */
export const MAX_TASK_DURATION_DAYS = 3650

const MS_PER_DAY = 86_400_000

/**
 * Format a Date to YYYY-MM-DD in local time
 */
export function formatToDateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Normalize a date to midnight local time
 */
export function normalizeDate(date: Date | string): Date {
  const d = new Date(date)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
}

/**
 * Check if a date is a working day (respects working days of week and holidays)
 */
export function isWorkingDay(date: Date, calendar: ProjectCalendarConfig): boolean {
  const dayOfWeek = date.getDay()
  if (!calendar.workingDays.includes(dayOfWeek)) {
    return false
  }

  const dateStr = formatToDateString(date)
  return !calendar.holidays.some((h) => h.date === dateStr)
}

/**
 * Clamp a duration that arrived from an import, expressed in the project's
 * current unit, to the schedulable window.
 */
export function clampImportedDuration(
  duration: number,
  calendar: ProjectCalendarConfig,
  unit: 'day' | 'hour'
): number {
  const max =
    unit === 'hour'
      ? MAX_TASK_DURATION_DAYS * Math.max(1, calendar.workingHoursPerDay || 8)
      : MAX_TASK_DURATION_DAYS
  return Math.min(duration, max)
}

/**
 * Whether an imported end date is close enough to `start` to be scheduled.
 *
 * A stray far-future date (a `3000-01-01` typo in a CSV) makes the day-by-day
 * effort walk in resource-effort.ts iterate hundreds of thousands of times per
 * task; callers fall back to start + duration instead.
 */
export function isSchedulableEnd(start: Date, end: Date): boolean {
  const spanDays = (normalizeDate(end).getTime() - normalizeDate(start).getTime()) / MS_PER_DAY
  // Working days map to at most 7/5 calendar days; x2 leaves room for holidays.
  return spanDays >= 0 && spanDays <= MAX_TASK_DURATION_DAYS * 2
}

/** Parse a YYYY-MM-DD holiday string into a local-midnight Date. */
function parseDateString(value: string): Date | null {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day)
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

/**
 * First working day on or after (step 1) / on or before (step -1) `from`.
 * Returns the last date scanned when the calendar has no working day at all.
 */
function walkToWorkingDay(from: Date, step: 1 | -1, calendar: ProjectCalendarConfig): Date {
  let cur = from
  for (let scanned = 0; scanned < MAX_NON_WORKING_RUN_DAYS; scanned++) {
    if (isWorkingDay(cur, calendar)) return cur
    cur = addDays(cur, step)
  }
  return cur
}

/**
 * Move `count` working days away from `from`, not counting `from` itself.
 *
 * The scan budget covers a fully non-working week per working day plus one
 * dead year, so a broken calendar or an absurd imported duration stops instead
 * of looping forever.
 */
function walkWorkingDays(
  from: Date,
  count: number,
  step: 1 | -1,
  calendar: ProjectCalendarConfig
): Date {
  const target = Math.min(count, MAX_TASK_DURATION_DAYS)
  const scanBudget = target * 7 + MAX_NON_WORKING_RUN_DAYS
  let cur = from
  let found = 0
  for (let scanned = 0; scanned < scanBudget && found < target; scanned++) {
    cur = addDays(cur, step)
    if (isWorkingDay(cur, calendar)) found++
  }
  return cur
}

/**
 * Find the next working day on or after the given date
 */
export function getNextWorkingDay(date: Date, calendar: ProjectCalendarConfig): Date {
  return walkToWorkingDay(normalizeDate(date), 1, calendar)
}

/**
 * Find the previous working day on or before the given date
 */
export function getPreviousWorkingDay(
  date: Date,
  calendar: ProjectCalendarConfig
): Date {
  return walkToWorkingDay(normalizeDate(date), -1, calendar)
}

/**
 * Get the N-th working day strictly after the given date.
 * If count <= 0, returns getNextWorkingDay(date, calendar).
 */
export function getWorkingDayAfter(
  date: Date,
  count: number,
  calendar: ProjectCalendarConfig
): Date {
  if (count <= 0) {
    return getNextWorkingDay(date, calendar)
  }

  return walkWorkingDays(normalizeDate(date), count, 1, calendar)
}

/**
 * Add working days to a start date and return the EXCLUSIVE end boundary.
 *
 * Convention (matches SVAR Gantt's half-open interval [start, end)):
 *   duration=1 starting Mon → returns Tue 00:00  (bar covers Mon only)
 *   duration=2 starting Fri → returns Tue 00:00  (bar covers Fri + Mon, skipping weekend)
 *
 * Milestones (duration=0) return the same day (start === end → zero-width marker).
 */
export function addWorkingDays(
  startDate: Date,
  days: number,
  calendar: ProjectCalendarConfig
): Date {
  if (days <= 0) {
    // Milestone: exclusive end == start (zero-width, SVAR renders as a diamond)
    return normalizeDate(startDate)
  }

  // Find the first actual working day on or after startDate
  const firstDay = getNextWorkingDay(startDate, calendar)
  const lastDay = walkWorkingDays(firstDay, days - 1, 1, calendar)

  // lastDay is the last inclusive working day; return the next calendar day (exclusive boundary)
  return addDays(lastDay, 1)
}

/**
 * Given an EXCLUSIVE end date, walk backward to find the task start for a given duration.
 * The exclusive end's preceding calendar day is the inclusive last working day.
 */
export function subtractWorkingDays(
  exclusiveEndDate: Date,
  days: number,
  calendar: ProjectCalendarConfig
): Date {
  if (days <= 0) {
    return normalizeDate(exclusiveEndDate)
  }

  // The inclusive last working day is one calendar day before the exclusive boundary
  const inclusiveLastDay = new Date(
    exclusiveEndDate.getFullYear(),
    exclusiveEndDate.getMonth(),
    exclusiveEndDate.getDate() - 1
  )
  const lastWorkingDay = getPreviousWorkingDay(inclusiveLastDay, calendar)
  return walkWorkingDays(lastWorkingDay, days - 1, -1, calendar)
}

/**
 * Add working hours to a start date, returning an EXCLUSIVE end boundary.
 */
export function addWorkingHours(
  startDate: Date,
  hours: number,
  calendar: ProjectCalendarConfig
): Date {
  if (hours <= 0) {
    return normalizeDate(startDate)
  }
  const hoursPerDay = Math.max(1, calendar.workingHoursPerDay || 8)
  const days = Math.max(1, Math.ceil(hours / hoursPerDay))
  return addWorkingDays(startDate, days, calendar)
}

/**
 * Count working days in the half-open interval [start, exclusiveEnd).
 * `exclusiveEnd` is the SVAR-style exclusive boundary; the inclusive last day is excluded.
 */
export function calculateWorkingDays(
  start: Date,
  exclusiveEnd: Date,
  calendar: ProjectCalendarConfig
): number {
  const s = normalizeDate(start)
  const e = normalizeDate(exclusiveEnd)
  if (e.getTime() <= s.getTime()) return 0

  // Counted by arithmetic rather than day by day: an imported end date decades
  // out would otherwise mean millions of iterations on the main thread.
  const totalDays = Math.round((e.getTime() - s.getTime()) / MS_PER_DAY)
  const workingDaysPerWeek = new Set(calendar.workingDays).size
  const fullWeeks = Math.floor(totalDays / 7)
  let count = fullWeeks * workingDaysPerWeek

  const remainderStart = addDays(s, fullWeeks * 7)
  for (let offset = 0; offset < totalDays % 7; offset++) {
    if (calendar.workingDays.includes(addDays(remainderStart, offset).getDay())) count++
  }

  // Holidays only reduce the count when they land on a working weekday inside the range.
  for (const holiday of calendar.holidays) {
    const date = parseDateString(holiday.date)
    if (!date) continue
    const time = date.getTime()
    if (time < s.getTime() || time >= e.getTime()) continue
    if (calendar.workingDays.includes(date.getDay())) count--
  }

  return Math.max(0, count)
}

/**
 * Calculate task duration from start to exclusive end according to durationUnit.
 */
export function calculateTaskDuration(
  start: Date,
  exclusiveEnd: Date,
  calendar: ProjectCalendarConfig,
  unit: 'day' | 'hour'
): number {
  const days = calculateWorkingDays(start, exclusiveEnd, calendar)
  if (unit === 'hour') {
    return days * (calendar.workingHoursPerDay || 8)
  }
  return days
}

/**
 * Calculate the EXCLUSIVE end date given start, duration, calendar and unit.
 */
export function calculateEndDate(
  start: Date,
  duration: number,
  calendar: ProjectCalendarConfig,
  unit: 'day' | 'hour'
): Date {
  if (duration <= 0) {
    return normalizeDate(start)
  }
  if (unit === 'hour') {
    return addWorkingHours(start, duration, calendar)
  }
  return addWorkingDays(start, duration, calendar)
}

export interface SvarCalendarAdapter {
  readonly durationUnit: 'day' | 'hour'
  isWorkingDay(date: Date): boolean
  getNextWorkingDay(date: Date): Date
  getPreviousWorkingDay(date: Date): Date
  addWorkingDays(date: Date, diff: number, inclusive?: boolean): Date
  getWorkingDays(start: Date, end: Date, inclusive?: boolean): number
  addWorkingHours(date: Date, hours: number): Date
  getWorkingHours(start: Date, end?: Date, inclusive?: boolean): number
}

/**
 * Adapt the project calendar helpers to SVAR's calendar duck type.
 *
 * SVAR uses half-open task ranges, with `end` representing the exclusive
 * midnight boundary. The adapter deliberately keeps all dates at local
 * midnight and returns the same exclusive boundary as `calculateEndDate`.
 */
export function createSvarCalendarAdapter(
  config: ProjectCalendarConfig,
  durationUnit: 'day' | 'hour'
): SvarCalendarAdapter {
  const hoursPerDay = Math.max(1, config.workingHoursPerDay || 8)

  const getWorkingInterval = (start: Date, end: Date): number => {
    const first = normalizeDate(start)
    const last = normalizeDate(end)
    if (first.getTime() === last.getTime()) return 0
    // SVAR's internal differ calls this method as (exclusiveEnd, start).
    // Treat either argument order as the same half-open interval.
    return first.getTime() < last.getTime()
      ? calculateWorkingDays(first, last, config)
      : calculateWorkingDays(last, first, config)
  }

  return {
    durationUnit,
    isWorkingDay: (date) => isWorkingDay(normalizeDate(date), config),
    getNextWorkingDay: (date) => getNextWorkingDay(date, config),
    getPreviousWorkingDay: (date) => getPreviousWorkingDay(date, config),
    addWorkingDays: (date, diff) => {
      if (diff >= 0) return addWorkingDays(date, diff, config)

      return walkWorkingDays(
        normalizeDate(date),
        Math.ceil(Math.abs(diff)),
        -1,
        config
      )
    },
    getWorkingDays: (start, end, _inclusive) => getWorkingInterval(start, end),
    addWorkingHours: (date, hours) => addWorkingHours(date, hours, config),
    getWorkingHours: (start, end, _inclusive) =>
      end === undefined
        ? isWorkingDay(normalizeDate(start), config)
          ? hoursPerDay
          : 0
        : getWorkingInterval(start, end) * hoursPerDay,
  }
}

/**
 * Convert an EXCLUSIVE end date to the inclusive finish date shown to the user.
 * e.g. exclusive Sep 5 00:00 → inclusive finish Sep 4
 */
export function exclusiveEndToInclusiveFinish(exclusiveEnd: Date): Date {
  return new Date(
    exclusiveEnd.getFullYear(),
    exclusiveEnd.getMonth(),
    exclusiveEnd.getDate() - 1
  )
}

/**
 * Convert a user-picked inclusive finish date to the EXCLUSIVE end stored in task.end.
 * e.g. user picks Sep 4 → exclusive Sep 5 00:00
 */
export function inclusiveFinishToExclusiveEnd(inclusiveFinish: Date): Date {
  return new Date(
    inclusiveFinish.getFullYear(),
    inclusiveFinish.getMonth(),
    inclusiveFinish.getDate() + 1
  )
}


interface SchedulableTask extends ITask {
  id: string | number
  start: Date
  end: Date
  duration: number
}

/**
 * Auto-reschedule tasks according to predecessors and project calendar.
 * Recursively updates successors when predecessors change.
 * Updates non-milestone parent tasks to encompass all children.
 */
export function autoScheduleTasks(
  tasks: ITask[],
  links: ILink[],
  calendar: ProjectCalendarConfig,
  durationUnit: 'day' | 'hour'
): ITask[] {
  // Drop invalid milestone parent links before any scheduling or roll-up work.
  const milestoneIds = new Set(
    tasks
      .filter((task) => task.type === 'milestone' && task.id !== undefined)
      .map((task) => String(task.id))
  )
  const taskMap = new Map<string | number, SchedulableTask>()
  for (const t of tasks) {
    if (t.id === undefined) continue
    const s = t.start ? new Date(t.start) : new Date()
    const isMilestone = t.type === 'milestone'
    const dur = isMilestone ? 0 : (t.duration ?? 1)
    const validStart = getNextWorkingDay(s, calendar)
    // Always recompute end from start+duration so stale or calendar-day input ends are replaced
    const e = isMilestone
      ? normalizeDate(validStart)
      : calculateEndDate(validStart, dur, calendar, durationUnit)
    const normalizedTask = { ...t }
    if (t.parent !== undefined && milestoneIds.has(String(t.parent))) {
      delete normalizedTask.parent
    }

    taskMap.set(t.id, {
      ...normalizedTask,
      id: t.id,
      start: validStart,
      end: e,
      duration: dur,
    })
  }


  // Build dependency graph (incoming links: predecessor -> successor)
  const incomingLinks = new Map<string | number, ILink[]>()
  for (const link of links) {
    if (link.target === undefined || link.source === undefined) continue
    const list = incomingLinks.get(link.target) ?? []
    list.push(link)
    incomingLinks.set(link.target, list)
  }

  // Topological sort of task IDs
  const visited = new Set<string | number>()
  const inStack = new Set<string | number>()
  const topoOrder: (string | number)[] = []

  function visit(id: string | number) {
    if (inStack.has(id)) return // Cycle detected, break cycle
    if (visited.has(id)) return

    inStack.add(id)
    const linksForTask = incomingLinks.get(id) ?? []
    for (const link of linksForTask) {
      if (link.source !== undefined && taskMap.has(link.source)) {
        visit(link.source)
      }
    }
    inStack.delete(id)
    visited.add(id)
    topoOrder.push(id)
  }

  for (const id of taskMap.keys()) {
    visit(id)
  }

  // Process tasks in topological order (predecessors first)
  for (const id of topoOrder) {
    const task = taskMap.get(id)
    if (!task) continue

    // Summary task dates are derived from children later
    if (task.type === 'summary') continue

    const taskLinks = incomingLinks.get(id) ?? []
    if (taskLinks.length === 0) {
      // Ensure standalone task starts on a working day and end date respects calendar
      const validStart = getNextWorkingDay(task.start, calendar)
      task.start = validStart
      task.end =
        task.type === 'milestone'
          ? validStart
          : calculateEndDate(validStart, task.duration, calendar, durationUnit)
      continue
    }


    let maxConstraintStart: Date | null = null

    for (const link of taskLinks) {
      if (link.source === undefined) continue
      const pred = taskMap.get(link.source)
      if (!pred) continue

      const lag = Number(link.lag) || 0
      const type = link.type || 'e2s'
      const lagDays =
        durationUnit === 'hour'
          ? Math.ceil(lag / (calendar.workingHoursPerDay || 8))
          : lag

      let candidateStart: Date

      if (type === 'e2s') {
        // pred.end is exclusive. getNextWorkingDay(pred.end) naturally gives the first
        // working day the successor can occupy — correct for both regular tasks AND milestones
        // (milestone exclusive end = milestoneDay + 1, so getNextWorkingDay finds the right day).
        if (lagDays >= 0) {
          candidateStart =
            lagDays === 0
              ? getNextWorkingDay(pred.end, calendar)
              : getWorkingDayAfter(pred.end, lagDays, calendar)
        } else {
          // Negative lag: successor may start before pred finishes.
          // |lagDays| working days before the inclusive last day of pred.
          candidateStart = subtractWorkingDays(pred.end, Math.abs(lagDays), calendar)
        }
      } else if (type === 's2s') {
        candidateStart =
          lagDays <= 0
            ? getNextWorkingDay(pred.start, calendar)
            : getWorkingDayAfter(pred.start, lagDays, calendar)
      } else if (type === 'e2e') {
        // Successor's exclusive end must be >= pred's exclusive end + lag working days
        const targetExclusiveEnd =
          lagDays <= 0
            ? new Date(pred.end)
            : getWorkingDayAfter(pred.end, lagDays, calendar)
        if (task.duration === 0 || task.type === 'milestone') {
          // Milestone start = exclusive end (zero width)
          candidateStart = normalizeDate(targetExclusiveEnd)
        } else {
          const daysNeeded =
            durationUnit === 'hour'
              ? Math.max(1, Math.ceil(task.duration / (calendar.workingHoursPerDay || 8)))
              : Math.max(1, task.duration)
          candidateStart = subtractWorkingDays(targetExclusiveEnd, daysNeeded, calendar)
        }
      } else if (type === 's2e') {
        // Successor's exclusive end must be >= pred's start + lag working days
        const targetExclusiveEnd =
          lagDays <= 0
            ? getNextWorkingDay(pred.start, calendar)
            : getWorkingDayAfter(pred.start, lagDays, calendar)
        if (task.duration === 0 || task.type === 'milestone') {
          candidateStart = normalizeDate(targetExclusiveEnd)
        } else {
          const daysNeeded =
            durationUnit === 'hour'
              ? Math.max(1, Math.ceil(task.duration / (calendar.workingHoursPerDay || 8)))
              : Math.max(1, task.duration)
          candidateStart = subtractWorkingDays(targetExclusiveEnd, daysNeeded, calendar)
        }
      } else {
        candidateStart = getNextWorkingDay(pred.end, calendar)
      }

      if (!maxConstraintStart || candidateStart.getTime() > maxConstraintStart.getTime()) {
        maxConstraintStart = candidateStart
      }
    }

    if (maxConstraintStart) {
      // maxConstraintStart is already a working day from all code paths above
      task.start = maxConstraintStart
      task.end =
        task.type === 'milestone'
          ? normalizeDate(maxConstraintStart) // milestone: end == start (zero-width)
          : calculateEndDate(maxConstraintStart, task.duration, calendar, durationUnit)
    }
  }

  // Any non-milestone task with children acts as a date/duration container.
  // Keep its explicit type unchanged; only milestones are forbidden from parenting.
  const updatedTasks = Array.from(taskMap.values())
  const parentIds = updatedTasks
    .filter(
      (task) =>
        task.type !== 'milestone' &&
        updatedTasks.some((candidate) => String(candidate.parent) === String(task.id))
    )
    .map((task) => task.id)

  for (let pass = 0; pass < 5; pass++) {
    for (const parentId of parentIds) {
      const summaryTask = taskMap.get(parentId)
      if (!summaryTask) continue

      const children = updatedTasks.filter((t) => String(t.parent) === String(parentId))
      if (children.length === 0) continue

      let minStart = children[0].start
      let maxEnd =
        children[0].type === 'milestone'
          ? new Date(
              children[0].start.getFullYear(),
              children[0].start.getMonth(),
              children[0].start.getDate() + 1
            )
          : children[0].end

      for (const child of children) {
        if (child.start.getTime() < minStart.getTime()) {
          minStart = child.start
        }
        const childEnd =
          child.type === 'milestone'
            ? new Date(
                child.start.getFullYear(),
                child.start.getMonth(),
                child.start.getDate() + 1
              )
            : child.end
        if (childEnd.getTime() > maxEnd.getTime()) {
          maxEnd = childEnd
        }
      }

      summaryTask.start = new Date(minStart)
      summaryTask.end = new Date(maxEnd)
      summaryTask.duration = calculateTaskDuration(
        minStart,
        maxEnd,
        calendar,
        durationUnit
      )
    }
  }
  return tasks.map((t) => {
    if (t.id === undefined) return t
    const updated = taskMap.get(t.id)
    if (!updated) return t
    const merged = { ...t, ...updated } as ITask
    if (t.parent !== undefined && updated.parent === undefined) delete merged.parent
    return merged
  })
}
