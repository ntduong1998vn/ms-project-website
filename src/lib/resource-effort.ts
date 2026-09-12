import type { ITask } from '@svar-ui/react-gantt'
import type { GanttResource, TaskWithResources } from '@/types/gantt'
import {
  formatToDateString,
  isWorkingDay,
  type ProjectCalendarConfig,
} from '@/lib/scheduler'

export type ResourceEffortWarning = {
  resourceLabel: string
  date: string
  totalHours: number
  capacityHours: number
  tasks: Array<{ id: string | number; text: string; hours: number }>
}

export function getResourceEffortWarnings(
  tasks: ITask[],
  resources: GanttResource[],
  calendar: ProjectCalendarConfig,
  durationUnit: 'day' | 'hour'
): Map<string, ResourceEffortWarning[]> {
  const capacityHours = Number(calendar.workingHoursPerDay)
  if (!Number.isFinite(capacityHours) || capacityHours <= 0) return new Map()

  const resourceById = new Map(resources.map((resource) => [resource.id, resource]))
  const dailyBuckets = new Map<
    string,
    {
      resourceLabel: string
      date: string
      totalHours: number
      tasks: Map<string, { id: string | number; text: string; hours: number }>
    }
  >()

  for (const task of tasks) {
    // Summary rows describe their children and do not represent additional resource effort.
    if (task.type === 'summary') continue

    const duration = Number(task.duration)
    if (!Number.isFinite(duration) || duration <= 0 || task.id === undefined || task.id === null) continue

    const start = task.start ? new Date(task.start) : null
    const end = task.end ? new Date(task.end) : null
    if (!start || !end || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) continue

    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate())
    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate())
    if (endDay.getTime() <= startDay.getTime()) continue

    const workingDates: Date[] = []
    for (const day = new Date(startDay); day.getTime() < endDay.getTime(); day.setDate(day.getDate() + 1)) {
      if (isWorkingDay(day, calendar)) workingDates.push(new Date(day))
    }
    if (workingDates.length === 0) continue

    const totalHours = durationUnit === 'day' ? duration * capacityHours : duration
    if (!Number.isFinite(totalHours) || totalHours <= 0) continue
    const dailyHours = totalHours / workingDates.length
    if (!Number.isFinite(dailyHours) || dailyHours <= 0) continue

    const resourcesForTask = (task as TaskWithResources).resources
    const assignedResourceIds = Array.from(
      new Set(
        (Array.isArray(resourcesForTask) ? resourcesForTask : [])
          .map((resourceId) => Number(resourceId))
          .filter((resourceId) => Number.isFinite(resourceId))
      )
    )
    if (assignedResourceIds.length === 0) continue

    const taskEntry = {
      id: task.id,
      text: String(task.text || `Task ${task.id}`),
      hours: dailyHours,
    }
    for (const resourceId of assignedResourceIds) {
      const resource = resourceById.get(resourceId)
      if (!resource) continue
      for (const workingDate of workingDates) {
        const date = formatToDateString(workingDate)
        const bucketKey = `${resourceId}:${date}`
        const bucket =
          dailyBuckets.get(bucketKey) ??
          {
            resourceLabel: resource.label || `Resource ${resourceId}`,
            date,
            totalHours: 0,
            tasks: new Map(),
          }
        bucket.totalHours += dailyHours
        bucket.tasks.set(String(task.id), taskEntry)
        dailyBuckets.set(bucketKey, bucket)
      }
    }
  }

  const warningsByTask = new Map<string, ResourceEffortWarning[]>()
  for (const bucket of dailyBuckets.values()) {
    if (bucket.totalHours <= capacityHours + 0.000001) continue
    const warning: ResourceEffortWarning = {
      resourceLabel: bucket.resourceLabel,
      date: bucket.date,
      totalHours: bucket.totalHours,
      capacityHours,
      tasks: Array.from(bucket.tasks.values()),
    }
    for (const task of warning.tasks) {
      const warnings = warningsByTask.get(String(task.id)) ?? []
      warnings.push(warning)
      warningsByTask.set(String(task.id), warnings)
    }
  }
  return warningsByTask
}
