import { describe, expect, it } from 'vitest'
import type { ILink, ITask } from '@svar-ui/react-gantt'

import { computeCriticalPath } from '@/lib/critical-path'
import { defaultCalendarConfig } from '@/lib/scheduler'

const calendar = defaultCalendarConfig

function day(d: number): Date {
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

function summary(id: string | number, options: Partial<ITask> = {}): ITask {
  return { id, text: String(id), type: 'summary', open: true, ...options } as ITask
}

function link(id: string | number, source: string | number, target: string | number, type: ILink['type'] = 'e2s', lag?: number): ILink {
  const l: ILink = { id, source, target, type }
  if (lag !== undefined) l.lag = lag
  return l
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
      summary('s'),
      { id: 'a', text: 'child', type: 'task', start: day(14), end: day(16), progress: 0, parent: 's' } as ITask,
    ]
    const { taskIds } = computeCriticalPath(tasks, [], calendar, 'day')

    expect(taskIds.has('a')).toBe(true)
    expect(taskIds.has('s')).toBe(true)
  })

  it('propagates critical status through nested summaries', () => {
    const tasks = [
      summary('grandparent'),
      { id: 'parent', text: 'parent', type: 'summary', open: true, parent: 'grandparent' } as ITask,
      { id: 'a', text: 'child', type: 'task', start: day(14), end: day(16), progress: 0, parent: 'parent' } as ITask,
    ]
    const { taskIds } = computeCriticalPath(tasks, [], calendar, 'day')

    expect(taskIds.has('a')).toBe(true)
    expect(taskIds.has('parent')).toBe(true)
    expect(taskIds.has('grandparent')).toBe(true)
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

  it('handles a finish-to-finish dependency with zero gap as critical', () => {
    const tasks = [task('a', 14, 16), task('b', 14, 16)]
    const links = [link(1, 'a', 'b', 'e2e')]
    const { taskIds, linkIds } = computeCriticalPath(tasks, links, calendar, 'day')

    expect(taskIds.has('a')).toBe(true)
    expect(taskIds.has('b')).toBe(true)
    expect(linkIds.has('1')).toBe(true)
  })

  it('handles a start-to-finish dependency with zero gap as critical', () => {
    const tasks = [task('a', 14, 16), task('b', 14, 16)]
    const links = [link(1, 'a', 'b', 's2e')]
    const { taskIds, linkIds } = computeCriticalPath(tasks, links, calendar, 'day')

    expect(taskIds.has('a')).toBe(true)
    expect(taskIds.has('b')).toBe(true)
    expect(linkIds.has('1')).toBe(true)
  })

  it('applies lag by shortening the slack on the driving path', () => {
    // a 14-16, b 16-18, a->b with 2 days lag makes a late for b (slack 0)
    const tasks = [task('a', 14, 16), task('b', 16, 18)]
    const links = [link(1, 'a', 'b', 'e2s', 2)]
    const { taskIds } = computeCriticalPath(tasks, links, calendar, 'day')

    expect(taskIds.has('a')).toBe(true)
    expect(taskIds.has('b')).toBe(true)
  })

  it('shares slack via cache when two branches merge into one successor', () => {
    // a->b->d and a->c->d, b and c run 14-16, d runs 16-18
    const tasks = [task('a', 14, 15), task('b', 15, 16), task('c', 15, 16), task('d', 16, 18)]
    const links = [link(1, 'a', 'b'), link(2, 'a', 'c'), link(3, 'b', 'd'), link(4, 'c', 'd')]
    const { taskIds, linkIds } = computeCriticalPath(tasks, links, calendar, 'day')

    expect(taskIds.has('a')).toBe(true)
    expect(taskIds.has('d')).toBe(true)
    expect(taskIds.has('b')).toBe(true)
    expect(taskIds.has('c')).toBe(true)
    expect(linkIds.size).toBe(4)
  })

  it('returns empty sets for an empty task list', () => {
    const { taskIds, linkIds } = computeCriticalPath([], [], calendar, 'day')
    expect(taskIds.size).toBe(0)
    expect(linkIds.size).toBe(0)
  })

  it('returns empty sets when all tasks are summaries', () => {
    const tasks = [summary('s1'), summary('s2', { parent: 's1' })]
    const { taskIds, linkIds } = computeCriticalPath(tasks, [], calendar, 'day')
    expect(taskIds.size).toBe(0)
    expect(linkIds.size).toBe(0)
  })

  it('falls back to a generated id when a link has no id', () => {
    const tasks = [task('a', 14, 16), task('b', 16, 18)]
    const links = [{ source: 'a', target: 'b', type: 'e2s' } as ILink]
    const { linkIds } = computeCriticalPath(tasks, links, calendar, 'day')

    expect(linkIds.has('a->b')).toBe(true)
  })

  it('ignores links whose target is missing from schedulable tasks', () => {
    const tasks = [task('a', 14, 16)]
    const links = [link(1, 'a', 'missing', 'e2s')]
    const { taskIds, linkIds } = computeCriticalPath(tasks, links, calendar, 'day')

    expect(taskIds.has('a')).toBe(true)
    expect(linkIds.size).toBe(0)
  })
})
