import { describe, expect, it } from 'vitest'
import type { ILink, ITask } from '@svar-ui/react-gantt'

import { computeCriticalPath } from '@/lib/critical-path'
import { defaultCalendarConfig } from '@/lib/scheduler'

const calendar = defaultCalendarConfig

function day(d: number): Date {
  // 2026-09 is month index 8
  return new Date(2026, 8, d)
}

function task(
  id: string | number,
  startDay: number,
  endDay: number,
  options: Partial<ITask> = {}
): ITask {
  return {
    id,
    text: String(id),
    type: 'task',
    start: day(startDay),
    end: day(endDay),
    progress: 0,
    ...options,
  } as ITask
}

function link(id: string | number, source: string | number, target: string | number, type: ILink['type'] = 'e2s'): ILink {
  return { id, source, target, type }
}

describe('computeCriticalPath', () => {
  it('marks all tasks in a linear finish-to-start chain as critical', () => {
    const tasks = [task('a', 14, 16), task('b', 16, 18), task('c', 18, 20)]
    const links = [link(1, 'a', 'b'), link(2, 'b', 'c')]
    const { taskIds, linkIds } = computeCriticalPath(tasks, links, calendar, 'day')

    expect([...taskIds]).toEqual(expect.arrayContaining(['a', 'b', 'c']))
    expect(taskIds.size).toBe(3)
    expect([...linkIds]).toEqual(expect.arrayContaining(['1', '2']))
    expect(linkIds.size).toBe(2)
  })

  it('gives the shorter fork branch positive slack so only the driving branch is critical', () => {
    // A and B both start Monday 14 Sep; A ends 16 Sep, B ends 15 Sep.
    // C starts 16 Sep and drives the project finish at 18 Sep.
    const tasks = [task('a', 14, 16), task('b', 14, 15), task('c', 16, 18)]
    const links = [link(1, 'a', 'c'), link(2, 'b', 'c')]
    const { taskIds, linkIds } = computeCriticalPath(tasks, links, calendar, 'day')

    expect(taskIds.has('a')).toBe(true)
    expect(taskIds.has('c')).toBe(true)
    expect(taskIds.has('b')).toBe(false)
    expect(linkIds.has('1')).toBe(true)
    expect(linkIds.has('2')).toBe(false)
  })

  it('marks a milestone at the end of the chain as critical', () => {
    const tasks = [task('a', 14, 16), { id: 'm', text: 'milestone', type: 'milestone', start: day(16), end: day(16), duration: 0 } as ITask]
    const links = [link(1, 'a', 'm')]
    const { taskIds } = computeCriticalPath(tasks, links, calendar, 'day')

    expect(taskIds.has('a')).toBe(true)
    expect(taskIds.has('m')).toBe(true)
  })

  it('flags a summary task as critical when one of its children is critical', () => {
    const tasks = [
      { id: 's', text: 'summary', type: 'summary', open: true } as ITask,
      { id: 'a', text: 'child', type: 'task', start: day(14), end: day(16), progress: 0, parent: 's' } as ITask,
    ]
    const { taskIds } = computeCriticalPath(tasks, [], calendar, 'day')

    expect(taskIds.has('a')).toBe(true)
    expect(taskIds.has('s')).toBe(true)
  })

  it('does not mark a completed task or its outgoing links as critical', () => {
    const tasks = [task('a', 14, 16, { progress: 100 }), task('b', 16, 18)]
    const links = [link(1, 'a', 'b')]
    const { taskIds, linkIds } = computeCriticalPath(tasks, links, calendar, 'day')

    expect(taskIds.has('a')).toBe(false)
    expect(taskIds.has('b')).toBe(true)
    expect(linkIds.size).toBe(0)
  })

  it('does not hang on a dependency cycle and still identifies critical tasks', () => {
    const tasks = [task('a', 14, 15), task('b', 15, 16)]
    const links = [link(1, 'a', 'b'), link(2, 'b', 'a')]
    const { taskIds } = computeCriticalPath(tasks, links, calendar, 'day')

    expect(taskIds.has('a')).toBe(true)
    expect(taskIds.has('b')).toBe(true)
  })

  it('handles a start-to-start dependency with zero gap as critical', () => {
    const tasks = [task('a', 14, 16), task('b', 14, 16)]
    const links = [link(1, 'a', 'b', 's2s')]
    const { taskIds, linkIds } = computeCriticalPath(tasks, links, calendar, 'day')

    expect(taskIds.has('a')).toBe(true)
    expect(taskIds.has('b')).toBe(true)
    expect(linkIds.has('1')).toBe(true)
  })
})
