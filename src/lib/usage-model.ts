import type { ITask } from '@svar-ui/react-gantt'
import type { GanttResource, TaskWithResources } from '@/types/gantt'
import { formatToDateString, isWorkingDay, normalizeDate, type ProjectCalendarConfig } from '@/lib/scheduler'

export type UsageMode = 'resource' | 'task'
export type UsageTimescale = 'day' | 'week' | 'month'
export type ResourceGroupBy = 'resource' | 'role'
export type TaskGroupBy = 'task' | 'phase'
export type UsageGroupBy = ResourceGroupBy | TaskGroupBy

export type UsagePeriod = {
  key: string
  start: Date
  end: Date
  label: string
  capacityHours: number
}

export type PeakDayDetail = {
  date: string
  dailyWork: number
  dailyCapacity: number
  resourceLabel?: string
}

export type UsageGridRow = {
  id: string
  label: string
  secondaryLabel?: string
  kind: 'parent' | 'assignment'
  totalWork: number
  periodWork: Record<string, number>
  peakDayByPeriod: Record<string, PeakDayDetail | undefined>
  overallocatedPeriods: string[]
  children: UsageGridRow[]
}

export type UsageModel = {
  mode: UsageMode
  timescale: UsageTimescale
  periods: UsagePeriod[]
  rows: UsageGridRow[]
  totalWork: number
  dailyWork: Record<string, Record<string, number>>
}

function resourceIds(task: ITask): number[] {
  const values = (task as TaskWithResources).resources
  if (!Array.isArray(values)) return []
  return Array.from(new Set(values.map(Number).filter(Number.isFinite)))
}

function validDate(value: Date | string | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? normalizeDate(date) : null
}

function taskWork(task: ITask, durationUnit: 'day' | 'hour', hoursPerDay: number): number {
  const duration = Number(task.duration)
  if (!Number.isFinite(duration) || duration <= 0) return 0
  return durationUnit === 'hour' ? duration : duration * hoursPerDay
}

function startOfPeriod(date: Date, timescale: UsageTimescale): Date {
  if (timescale === 'month') return new Date(date.getFullYear(), date.getMonth(), 1)
  if (timescale === 'week') {
    const daysFromMonday = date.getDay() === 0 ? 6 : date.getDay() - 1
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() - daysFromMonday)
  }
  return normalizeDate(date)
}

function advancePeriod(date: Date, timescale: UsageTimescale): Date {
  if (timescale === 'month') return new Date(date.getFullYear(), date.getMonth() + 1, 1)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + (timescale === 'week' ? 7 : 1))
}

function periodLabel(date: Date, timescale: UsageTimescale): string {
  if (timescale === 'month') return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
  if (timescale === 'week') return `Week of ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function workingDayCount(start: Date, end: Date, calendar: ProjectCalendarConfig): number {
  let count = 0
  for (let date = new Date(start); date.getTime() < end.getTime(); date = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)) {
    if (isWorkingDay(date, calendar)) count++
  }
  return count
}

function buildPeriods(start: Date, end: Date, timescale: UsageTimescale, calendar: ProjectCalendarConfig): UsagePeriod[] {
  const periods: UsagePeriod[] = []
  let cursor = startOfPeriod(start, timescale)
  let guard = 0
  const hoursPerDay = Math.max(1, Number(calendar.workingHoursPerDay) || 8)
  while (cursor.getTime() < end.getTime() && guard < 240) {
    const periodEnd = advancePeriod(cursor, timescale)
    periods.push({
      key: formatToDateString(cursor),
      start: cursor,
      end: periodEnd,
      label: periodLabel(cursor, timescale),
      capacityHours: workingDayCount(cursor, periodEnd, calendar) * hoursPerDay,
    })
    cursor = periodEnd
    guard++
  }
  return periods
}

function emptyPeriodWork(periods: UsagePeriod[]): Record<string, number> {
  return Object.fromEntries(periods.map((period) => [period.key, 0]))
}

function addPeriodWork(target: Record<string, number>, source: Record<string, number>): void {
  for (const [key, value] of Object.entries(source)) target[key] = (target[key] ?? 0) + value
}

function assignmentPeriodWork(
  task: ITask,
  assignmentWork: number,
  periods: UsagePeriod[],
  calendar: ProjectCalendarConfig,
  timescale: UsageTimescale,
  dailyTarget?: Record<string, number>
): Record<string, number> {
  const result = emptyPeriodWork(periods)
  const start = validDate(task.start)
  const end = validDate(task.end)
  if (!start || !end || end.getTime() <= start.getTime() || assignmentWork <= 0) return result
  const dates: Date[] = []
  for (let date = new Date(start); date.getTime() < end.getTime(); date = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)) {
    if (isWorkingDay(date, calendar)) dates.push(new Date(date))
  }
  if (dates.length === 0) return result
  const dailyWork = assignmentWork / dates.length
  for (const date of dates) {
    const key = formatToDateString(startOfPeriod(date, timescale))
    result[key] = (result[key] ?? 0) + dailyWork
    if (dailyTarget) {
      const dayKey = formatToDateString(date)
      dailyTarget[dayKey] = (dailyTarget[dayKey] ?? 0) + dailyWork
    }
  }
  return result
}

function includesText(value: string | undefined, filter: string): boolean {
  return !filter || (value ?? '').toLocaleLowerCase().includes(filter.toLocaleLowerCase())
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: 'base' })
}

function taskName(task: ITask): string {
  return String(task.text || `Task ${task.id}`)
}

function resourceName(resource: GanttResource): string {
  return resource.label || `Resource ${resource.id}`
}

function rowWithChildren(
  id: string,
  label: string,
  secondaryLabel: string | undefined,
  kind: UsageGridRow['kind'],
  totalWork: number,
  periodWork: Record<string, number>,
  children: UsageGridRow[]
): UsageGridRow {
  return { id, label, secondaryLabel, kind, totalWork, periodWork, peakDayByPeriod: {}, overallocatedPeriods: [], children }
}

function rollupRow(id: string, label: string, secondaryLabel: string | undefined, children: UsageGridRow[], periods: UsagePeriod[]): UsageGridRow {
  const periodWork = emptyPeriodWork(periods)
  children.forEach((child) => addPeriodWork(periodWork, child.periodWork))
  return rowWithChildren(id, label, secondaryLabel, 'parent', children.reduce((sum, child) => sum + child.totalWork, 0), periodWork, children)
}

function phaseLabel(task: ITask, phaseNames: Map<string, string>): string {
  return phaseNames.get(String(task.parent ?? '')) ?? 'Unassigned phase'
}

export function buildUsageModel({
  mode,
  tasks,
  resources,
  calendar,
  durationUnit,
  timescale,
  filter = '',
  groupBy,
}: {
  mode: UsageMode
  tasks: ITask[]
  resources: GanttResource[]
  calendar: ProjectCalendarConfig
  durationUnit: 'day' | 'hour'
  timescale: UsageTimescale
  filter?: string
  groupBy: UsageGroupBy
}): UsageModel {
  const hoursPerDay = Math.max(1, Number(calendar.workingHoursPerDay) || 8)
  const resourceById = new Map(resources.map((resource) => [resource.id, resource]))
  const leafTasks = tasks.filter((task) => task.type !== 'summary' && task.id !== undefined && task.id !== null)
  const ranges = leafTasks
    .map((task) => ({ start: validDate(task.start), end: validDate(task.end) }))
    .filter((range): range is { start: Date; end: Date } => range.start !== null && range.end !== null && range.end.getTime() > range.start.getTime())
  const today = normalizeDate(new Date())
  const first = ranges.length > 0 ? ranges.reduce((value, range) => range.start < value ? range.start : value, ranges[0].start) : today
  const last = ranges.length > 0 ? ranges.reduce((value, range) => range.end > value ? range.end : value, ranges[0].end) : advancePeriod(today, timescale)
  const periods = buildPeriods(first, last, timescale, calendar)
  const normalizedFilter = filter.trim()
  const dailyWorkByResource = new Map<number, Record<string, number>>()
  resources.forEach((resource) => dailyWorkByResource.set(resource.id, {}))

  if (mode === 'resource') {
    const sortedResources = [...resources].sort((left, right) => {
      if (groupBy === 'role') {
        const roleCompare = compareText(left.role || 'Unassigned role', right.role || 'Unassigned role')
        if (roleCompare !== 0) return roleCompare
      }
      return compareText(resourceName(left), resourceName(right))
    })
    const resourceRows = sortedResources.flatMap((resource) => {
      const assigned = leafTasks.filter((task) => resourceIds(task).includes(resource.id))
      const parentMatches = includesText(resourceName(resource), normalizedFilter) || includesText(resource.role, normalizedFilter)
      const visibleTasks = parentMatches ? assigned : assigned.filter((task) => includesText(taskName(task), normalizedFilter))
      if (!parentMatches && visibleTasks.length === 0) return []
      const children = visibleTasks.map((task) => {
        const knownIds = resourceIds(task).filter((id) => resourceById.has(id))
        const work = knownIds.length > 0 ? taskWork(task, durationUnit, hoursPerDay) / knownIds.length : 0
        return rowWithChildren(`resource:${resource.id}:task:${String(task.id)}`, taskName(task), task.type || 'Task', 'assignment', work, assignmentPeriodWork(task, work, periods, calendar, timescale, dailyWorkByResource.get(resource.id)), [])
      })
      return [rollupRow(`resource:${resource.id}`, resourceName(resource), resource.role, children, periods)]
    })

    let rows = resourceRows
    if (groupBy === 'role') {
      const groups = new Map<string, UsageGridRow[]>()
      for (const row of resourceRows) {
        const role = row.secondaryLabel || 'Unassigned role'
        groups.set(role, [...(groups.get(role) ?? []), row])
      }
      rows = Array.from(groups.entries()).sort(([left], [right]) => compareText(left, right)).map(([role, children]) => rollupRow(`role:${role}`, role, 'Role', children, periods))
    }
    return { mode, timescale, periods, rows, totalWork: rows.reduce((sum, row) => sum + row.totalWork, 0), dailyWork: Object.fromEntries(resources.map((resource) => [`resource:${resource.id}`, dailyWorkByResource.get(resource.id) ?? {}])) }
  }

  const phaseNames = new Map(tasks.filter((task) => task.type === 'summary' && task.id !== undefined && task.id !== null).map((task) => [String(task.id), taskName(task)]))
  const taskRows = (taskList: ITask[], taskFilter: string): UsageGridRow[] => taskList.flatMap((task) => {
    const assigned = resourceIds(task).map((id) => resourceById.get(id)).filter((resource): resource is GanttResource => resource !== undefined)
    const parentMatches = includesText(taskName(task), taskFilter) || includesText(task.type, taskFilter)
    const unassignedMatches = includesText('Unassigned', taskFilter)
    const visibleResources = parentMatches ? assigned : assigned.filter((resource) => includesText(resourceName(resource), taskFilter) || includesText(resource.role, taskFilter))
    if (!parentMatches && visibleResources.length === 0 && !(assigned.length === 0 && unassignedMatches)) return []
    const totalWork = taskWork(task, durationUnit, hoursPerDay)
    const workPerResource = assigned.length > 0 ? totalWork / assigned.length : 0
    const children = visibleResources.map((resource) => rowWithChildren(`task:${String(task.id)}:resource:${resource.id}`, resourceName(resource), resource.role || 'Resource', 'assignment', workPerResource, assignmentPeriodWork(task, workPerResource, periods, calendar, timescale), []))
    if (assigned.length === 0 && (parentMatches || unassignedMatches)) children.push(rowWithChildren(`task:${String(task.id)}:unassigned`, 'Unassigned', 'No resource assigned', 'assignment', totalWork, assignmentPeriodWork(task, totalWork, periods, calendar, timescale), []))
    const visibleWork = assigned.length === 0 ? totalWork : workPerResource * visibleResources.length
    const secondaryLabel = groupBy === 'phase' ? phaseLabel(task, phaseNames) : task.type || 'Task'
    return [rollupRow(`task:${String(task.id)}`, taskName(task), secondaryLabel, children, periods)].map((row) => ({ ...row, totalWork: visibleWork }))
  })

  const sortedTasks = [...leafTasks].sort((left, right) => {
    if (groupBy === 'phase') {
      const phaseCompare = compareText(phaseLabel(left, phaseNames), phaseLabel(right, phaseNames))
      if (phaseCompare !== 0) return phaseCompare
    }
    return leafTasks.indexOf(left) - leafTasks.indexOf(right)
  })
  let rows = taskRows(sortedTasks, normalizedFilter)
  if (groupBy === 'phase') {
    const groups = new Map<string, UsageGridRow[]>()
    for (const task of sortedTasks) {
      const label = phaseLabel(task, phaseNames)
      const phaseMatches = includesText(label, normalizedFilter)
      const candidate = taskRows([task], phaseMatches ? '' : normalizedFilter)
      if (candidate.length > 0) groups.set(label, [...(groups.get(label) ?? []), ...candidate])
    }
    rows = Array.from(groups.entries()).sort(([left], [right]) => compareText(left, right)).map(([label, children]) => rollupRow(`phase:${label}`, label, 'Phase', children, periods))
  }
  return { mode, timescale, periods, rows, totalWork: rows.reduce((sum, row) => sum + row.totalWork, 0), dailyWork: {} }
}

function peakDetails(row: UsageGridRow, periods: UsagePeriod[], daily: Record<string, number>, calendar: ProjectCalendarConfig, resourceLabel: string): UsageGridRow {
  const hoursPerDay = Math.max(1, Number(calendar.workingHoursPerDay) || 8)
  const peakDayByPeriod: Record<string, PeakDayDetail | undefined> = {}
  const overallocatedPeriods: string[] = []
  for (const period of periods) {
    let peak: PeakDayDetail | undefined
    for (let date = new Date(period.start); date.getTime() < period.end.getTime(); date = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)) {
      if (!isWorkingDay(date, calendar)) continue
      const detail = { date: formatToDateString(date), dailyWork: daily[formatToDateString(date)] ?? 0, dailyCapacity: hoursPerDay, resourceLabel }
      if (!peak || detail.dailyWork > peak.dailyWork) peak = detail
    }
    peakDayByPeriod[period.key] = peak
    if (peak && peak.dailyWork > peak.dailyCapacity + 0.000001) overallocatedPeriods.push(period.key)
  }
  return { ...row, peakDayByPeriod, overallocatedPeriods }
}

export function markResourceOverallocation(model: UsageModel, calendar: ProjectCalendarConfig): UsageModel {
  if (model.mode !== 'resource') return model
  const mark = (row: UsageGridRow): UsageGridRow => {
    const children = row.children.map(mark)
    if (model.dailyWork[row.id]) return peakDetails({ ...row, children }, model.periods, model.dailyWork[row.id], calendar, row.label)
    const peakDayByPeriod: Record<string, PeakDayDetail | undefined> = {}
    const overallocatedPeriods: string[] = []
    for (const period of model.periods) {
      const peaks = children.map((child) => child.peakDayByPeriod[period.key]).filter((peak): peak is PeakDayDetail => peak !== undefined)
      const peak = peaks.sort((left, right) => right.dailyWork - left.dailyWork)[0]
      peakDayByPeriod[period.key] = peak
      if (children.some((child) => child.overallocatedPeriods.includes(period.key))) overallocatedPeriods.push(period.key)
    }
    return { ...row, children, peakDayByPeriod, overallocatedPeriods }
  }
  return { ...model, rows: model.rows.map(mark) }
}
