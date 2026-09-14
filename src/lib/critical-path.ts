import type { ILink, ITask } from '@svar-ui/react-gantt'

import { calculateTaskDuration, type ProjectCalendarConfig } from '@/lib/scheduler'

type CriticalPathResult = { taskIds: Set<string>; linkIds: Set<string> }

function keyId(id: string | number | undefined): string | undefined {
  return id !== undefined ? String(id) : undefined
}

function signedWorkingDuration(
  start: Date,
  end: Date,
  calendar: ProjectCalendarConfig,
  durationUnit: 'day' | 'hour'
): number {
  if (end <= start) {
    return -calculateTaskDuration(end, start, calendar, durationUnit)
  }
  return calculateTaskDuration(start, end, calendar, durationUnit)
}

function gapForLink(
  link: ILink,
  pred: ITask,
  succ: ITask,
  calendar: ProjectCalendarConfig,
  durationUnit: 'day' | 'hour'
): number {
  const start = pred.start ?? new Date(0)
  const end = pred.end ?? start
  const sStart = succ.start ?? new Date(0)
  const sEnd = succ.end ?? sStart

  switch (link.type) {
    case 's2s':
      return signedWorkingDuration(start, sStart, calendar, durationUnit)
    case 'e2e':
      return signedWorkingDuration(end, sEnd, calendar, durationUnit)
    case 's2e':
      return signedWorkingDuration(start, sEnd, calendar, durationUnit)
    case 'e2s':
    default:
      return signedWorkingDuration(end, sStart, calendar, durationUnit)
  }
}

function calculateSlack(
  taskId: string,
  taskMap: Map<string, ITask>,
  outgoing: Map<string, ILink[]>,
  slackCache: Map<string, number>,
  inStack: Set<string>,
  projectFinish: Date,
  calendar: ProjectCalendarConfig,
  durationUnit: 'day' | 'hour'
): number {
  if (slackCache.has(taskId)) {
    return slackCache.get(taskId)!
  }

  if (inStack.has(taskId)) {
    // Back edge in a cycle — drop this path from the minimum
    return Number.POSITIVE_INFINITY
  }

  const task = taskMap.get(taskId)
  if (!task || !task.start || !task.end) {
    slackCache.set(taskId, Number.POSITIVE_INFINITY)
    return Number.POSITIVE_INFINITY
  }

  inStack.add(taskId)

  const terminalSlack = signedWorkingDuration(task.end, projectFinish, calendar, durationUnit)
  let minSlack = terminalSlack

  for (const link of outgoing.get(taskId) ?? []) {
    const targetId = keyId(link.target)
    if (!targetId || !taskMap.has(targetId)) continue

    const succ = taskMap.get(targetId)!
    if (!succ.start || !succ.end) continue

    const lag = typeof link.lag === 'number' ? link.lag : 0
    const gap = gapForLink(link, task, succ, calendar, durationUnit)
    const succSlack = calculateSlack(
      targetId,
      taskMap,
      outgoing,
      slackCache,
      inStack,
      projectFinish,
      calendar,
      durationUnit
    )

    if (succSlack !== Number.POSITIVE_INFINITY) {
      minSlack = Math.min(minSlack, succSlack + gap - lag)
    }
  }

  inStack.delete(taskId)
  slackCache.set(taskId, minSlack)
  return minSlack
}

export function computeCriticalPath(
  tasks: ITask[],
  links: ILink[],
  calendar: ProjectCalendarConfig,
  durationUnit: 'day' | 'hour'
): CriticalPathResult {
  const schedulable = new Map<string, ITask>()
  const parentMap = new Map<string, string>()
  let projectFinish = new Date(0)

  for (const task of tasks) {
    if (task.id === undefined) continue
    const id = String(task.id)

    if (task.parent !== undefined) {
      parentMap.set(id, String(task.parent))
    }

    if (task.type === 'summary') {
      continue
    }

    if (task.start && task.end) {
      if (task.end > projectFinish) {
        projectFinish = task.end
      }
      schedulable.set(id, task)
    }
  }

  if (schedulable.size === 0) {
    return { taskIds: new Set<string>(), linkIds: new Set<string>() }
  }

  const outgoing = new Map<string, ILink[]>()
  for (const link of links) {
    const sourceId = keyId(link.source)
    const targetId = keyId(link.target)
    if (!sourceId || !targetId || !schedulable.has(sourceId)) continue
    if (!outgoing.has(sourceId)) {
      outgoing.set(sourceId, [])
    }
    outgoing.get(sourceId)!.push(link)
  }

  const slackCache = new Map<string, number>()
  const taskIds = new Set<string>()

  for (const [id, task] of schedulable) {
    if (task.progress === 100) {
      continue
    }
    const slack = calculateSlack(id, schedulable, outgoing, slackCache, new Set<string>(), projectFinish, calendar, durationUnit)
    if (slack <= 0) {
      taskIds.add(id)
    }
  }

  // Mark all ancestor summaries (and any ancestor) of critical tasks
  for (const id of taskIds) {
    let current = id
    while (current) {
      const parentId = parentMap.get(current)
      if (!parentId) break
      taskIds.add(parentId)
      current = parentId
    }
  }

  const linkIds = new Set<string>()
  for (const link of links) {
    const sid = keyId(link.source)
    const tid = keyId(link.target)
    if (sid && tid && taskIds.has(sid) && taskIds.has(tid)) {
      linkIds.add(link.id !== undefined ? String(link.id) : `${sid}->${tid}`)
    }
  }

  return { taskIds, linkIds }
}
