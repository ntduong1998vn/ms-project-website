import { describe, expect, it } from 'vitest'
import type { ILink, ITask } from '@svar-ui/react-gantt'

import {
  addTaskAtPlacement,
  collectTaskSubtreeIds,
  getNextNumericTaskId,
  hasParentCycle,
  isTaskParentAllowed,
  moveTaskAtPlacement,
  remapPredecessorValue,
  resequenceProject,
  sameTaskId,
  toPositiveNumericTaskId,
} from '@/lib/task-helpers'

type TaskWithPredecessors = ITask & { predecessors?: unknown }
type TaskOptions = Partial<ITask> & { predecessors?: unknown }

function task(id: string | number, text = String(id), options: TaskOptions = {}): ITask {
  return { id, text, type: 'task', ...options } as ITask
}

function ids(tasks: ITask[]): Array<string | number | undefined> {
  return tasks.map((item) => item.id)
}

describe('task ID helpers', () => {
  it('compares IDs by their string representation while rejecting undefined values', () => {
    expect(sameTaskId(7, '7')).toBe(true)
    expect(sameTaskId('alpha', 'alpha')).toBe(true)
    expect(sameTaskId(7, 8)).toBe(false)
    expect(sameTaskId(undefined, undefined)).toBe(false)
    expect(sameTaskId(undefined, 'undefined')).toBe(false)
    expect(sameTaskId(0, undefined)).toBe(false)
  })

  it('normalizes only positive safe integer IDs', () => {
    expect(toPositiveNumericTaskId(1)).toBe(1)
    expect(toPositiveNumericTaskId(' 0042 ')).toBe(42)
    expect(toPositiveNumericTaskId('')).toBe(null)
    expect(toPositiveNumericTaskId('0')).toBe(null)
    expect(toPositiveNumericTaskId(-1)).toBe(null)
    expect(toPositiveNumericTaskId('2.5')).toBe(null)
    expect(toPositiveNumericTaskId(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER)
    expect(toPositiveNumericTaskId(Number.MAX_SAFE_INTEGER + 1)).toBe(null)
    expect(toPositiveNumericTaskId(null)).toBe(null)
    expect(toPositiveNumericTaskId(true)).toBe(null)
  })

  it('chooses the first ID after the largest valid numeric ID', () => {
    expect(getNextNumericTaskId([])).toBe(1)
    expect(getNextNumericTaskId([task('1'), task(3), task('invalid'), task(0)])).toBe(4)
    expect(getNextNumericTaskId([task('2'), task(2), task('4')])).toBe(5)
    expect(getNextNumericTaskId([task('999'), task('not-a-number')])).toBe(1000)
  })
})

describe('task hierarchy and dependency helpers', () => {
  it('collects descendants transitively and supports mixed ID representations', () => {
    const tasks = [
      task(10, 'root'),
      task('20', 'child', { parent: '10' }),
      task(30, 'grandchild', { parent: 20 }),
      task(40, 'unrelated', { parent: 999 }),
    ]

    expect(collectTaskSubtreeIds(tasks, '10')).toEqual(new Set(['10', '20', '30']))
  })

  it('remaps predecessor values while preserving their input shape', () => {
    const map = new Map([
      ['old-a', 1],
      ['old-b', 2],
      ['99', 3],
    ])

    expect(remapPredecessorValue(['old-b', 'missing', 'old-a'], map)).toEqual([2, 1])
    expect(remapPredecessorValue('old-a, old-b missing', map)).toBe('1, 2')
    expect(remapPredecessorValue('old-b', map)).toBe('2')
    expect(remapPredecessorValue(99, map)).toBe(3)
    expect(remapPredecessorValue(42, map)).toBe('')
    expect(remapPredecessorValue({ source: 'old-a' }, map)).toEqual({ source: 'old-a' })
  })

  it('resequences task IDs and remaps parents, predecessors, links, and selection', () => {
    const tasks = [
      task('alpha', 'A', { predecessors: ['gamma', 'missing'] }),
      task('beta', 'B', { parent: 'alpha', predecessors: 'alpha gamma' }),
      task('gamma', 'C', { parent: 'missing', predecessors: 42 }),
    ]
    const links: ILink[] = [
      { id: 'l1', source: 'alpha', target: 'beta', type: 'e2s' } as ILink,
      { id: 'l2', source: 'missing', target: 'beta', type: 'e2e' } as ILink,
    ]

    const result = resequenceProject(tasks, links, 'beta')
    const resultTasks = result.tasks as TaskWithPredecessors[]
    expect(ids(resultTasks)).toEqual([1, 2, 3])
    expect(resultTasks[0].predecessors).toEqual([3])
    expect(resultTasks[1].parent).toBe(1)
    expect(resultTasks[1].predecessors).toBe('1, 3')
    expect(resultTasks[2]).not.toHaveProperty('parent')
    expect(resultTasks[2].predecessors).toBe('')
    expect(result.links).toEqual([{ id: 'l1', source: 1, target: 2, type: 'e2s' }])
    expect(result.selectedTaskId).toBe(2)
    expect(resequenceProject(tasks, links, null).selectedTaskId).toBe(null)
  })

  it('falls back for missing IDs, unknown predecessors, links, and selection', () => {
    const tasks = [
      task('known', 'Known'),
      { text: 'missing ID', type: 'task', predecessors: ['known'] } as TaskWithPredecessors,
      task('last', 'Last', { predecessors: 'unknown' }),
    ]
    const links: ILink[] = [
      { id: 'valid', source: 'known', target: 'known', type: 'e2s' } as ILink,
      { id: 'missing-source', source: 'unknown', target: 'known', type: 'e2e' } as ILink,
      { id: 'missing-target', source: 'known', target: 'unknown', type: 's2s' } as ILink,
    ]

    const result = resequenceProject(tasks, links, 'not-selected')
    const resultTasks = result.tasks as TaskWithPredecessors[]

    expect(ids(resultTasks)).toEqual([1, 2, 3])
    expect(resultTasks[0]).not.toHaveProperty('predecessors')
    expect(resultTasks[1]).toMatchObject({ id: 2, predecessors: [1] })
    expect(resultTasks[1]).not.toHaveProperty('parent')
    expect(resultTasks[2].predecessors).toBe('')
    expect(result.links).toEqual([{ id: 'valid', source: 1, target: 1, type: 'e2s' }])
    expect(result.selectedTaskId).toBe(null)
  })

  it('detects direct, indirect, and already-cyclic parent chains', () => {
    const parents = new Map<string, string | number>([
      ['2', 1],
      ['3', 2],
      ['8', 9],
      ['9', 8],
    ])

    expect(hasParentCycle(1, 1, parents)).toBe(true)
    expect(hasParentCycle(1, 3, parents)).toBe(true)
    expect(hasParentCycle(7, 8, parents)).toBe(true)
    expect(hasParentCycle(7, 4, parents)).toBe(false)
  })
})

describe('task placement helpers', () => {
  it('adds tasks before and after a target using the target sibling parent', () => {
    const tasks = [
      task(1, 'parent', { type: 'summary', open: true }),
      task(2, 'first', { parent: 1 }),
      task(3, 'second', { parent: 1 }),
      task(4, 'root'),
    ]

    const before = addTaskAtPlacement(tasks, task(5, 'insert'), 3, 'before')
    expect(ids(before)).toEqual([1, 2, 5, 3, 4])
    expect(before[2].parent).toBe(1)

    const after = addTaskAtPlacement(tasks, task(6, 'insert'), 2, 'after')
    expect(ids(after)).toEqual([1, 2, 6, 3, 4])
    expect(after[2].parent).toBe(1)
  })

  it('adds a child without promoting a regular task to summary', () => {
    const tasks = [
      task(1, 'parent'),
      task(2, 'child', { parent: 1 }),
      task(3, 'grandchild', { parent: 2 }),
      task(4, 'root'),
    ]

    const result = addTaskAtPlacement(tasks, task(5, 'new child'), 1, 'child')

    expect(ids(result)).toEqual([1, 2, 3, 5, 4])
    expect(result[0]).toMatchObject({ type: 'task', open: true })
    expect(result[3].parent).toBe(1)
  })

  it('keeps an explicit summary type when adding a child', () => {
    const tasks = [task(1, 'summary', { type: 'summary' }), task(2, 'root')]

    const result = addTaskAtPlacement(tasks, task(3, 'new child'), 1, 'child')

    expect(result[0]).toMatchObject({ type: 'summary', open: true })
    expect(result[1]).toMatchObject({ id: 3, parent: 1 })
  })
  it('rejects milestone parents while allowing regular task parents', () => {
    const tasks = [
      task(1, 'regular parent'),
      task(2, 'milestone parent', { type: 'milestone' }),
    ]

    expect(isTaskParentAllowed(tasks, 1)).toBe(true)
    expect(isTaskParentAllowed(tasks, 2)).toBe(false)
    expect(addTaskAtPlacement(tasks, task(3, 'child'), 2, 'child')).toBe(tasks)

    const moved = moveTaskAtPlacement([...tasks, task(3, 'child')], 3, 2, 'child')
    expect(moved).toEqual([...tasks, task(3, 'child')])
  })


  it('appends when placement has no usable target', () => {
    const tasks = [task(1), task(2)]
    const incoming = task(3, 'incoming', { parent: 99 })

    expect(addTaskAtPlacement(tasks, incoming, undefined, undefined)).toEqual([...tasks, incoming])
    expect(addTaskAtPlacement(tasks, incoming, 99, 'before')).toEqual([...tasks, incoming])
  })

  it('handles an undefined mode, root target, and undefined incoming ID', () => {
    const tasks = [task(1, 'root'), task(2, 'other')]
    const incoming = { id: undefined, text: 'incoming', type: 'task', parent: 99 } as ITask

    const before = addTaskAtPlacement(tasks, incoming, 1, 'before')
    expect(ids(before)).toEqual([undefined, 1, 2])
    expect(addTaskAtPlacement(tasks, incoming, undefined, 'before')).toEqual([...tasks, incoming])
    expect(addTaskAtPlacement(tasks, incoming, 1, undefined)).toEqual([...tasks, incoming])
  })

  it('moves a child without promoting its new parent or changing the old summary', () => {
    const tasks = [
      task(1, 'old parent', { type: 'summary', open: true }),
      task(2, 'moving child', { parent: 1 }),
      task(3, 'remaining child', { parent: 1 }),
      task(4, 'new parent'),
    ]

    const result = moveTaskAtPlacement(tasks, 2, 4, 'child')

    expect(ids(result)).toEqual([1, 3, 4, 2])
    expect(result[0]).toMatchObject({ id: 1, type: 'summary', open: true })
    expect(result[2]).toMatchObject({ id: 4, type: 'task', open: true })
    expect(result[3]).toMatchObject({ id: 2, parent: 4 })
  })

  it('keeps an explicit summary type when moving its last child away', () => {
    const tasks = [
      task(1, 'parent', { type: 'summary', open: true }),
      task(2, 'child', { parent: 1 }),
      task(3, 'other'),
    ]

    const result = moveTaskAtPlacement(tasks, 2, 3, 'after')

    expect(ids(result)).toEqual([1, 3, 2])
    expect(result[0]).toMatchObject({ id: 1, type: 'summary', open: true })
  })

  it('moves nested siblings up and down while retaining their parent', () => {
    const tasks = [
      task(1, 'parent', { type: 'summary', open: true }),
      task(2, 'first', { parent: 1 }),
      task(3, 'second', { parent: 1 }),
      task(4, 'third', { parent: 1 }),
    ]

    expect(ids(moveTaskAtPlacement(tasks, 2, undefined, 'up'))).toEqual([1, 2, 3, 4])

    const up = moveTaskAtPlacement(tasks, 3, undefined, 'up')
    expect(ids(up)).toEqual([1, 3, 2, 4])
    expect(up[1].parent).toBe(1)

    expect(ids(moveTaskAtPlacement(tasks, 4, undefined, 'down'))).toEqual([1, 2, 3, 4])

    const down = moveTaskAtPlacement(tasks, 3, undefined, 'down')
    expect(ids(down)).toEqual([1, 2, 4, 3])
    expect(down[3].parent).toBe(1)
  })

  it('outdents a nested subtree after the old parent subtree', () => {
    const tasks = [
      task(1, 'root', { type: 'summary', open: true }),
      task(2, 'old parent', { type: 'summary', open: true, parent: 1 }),
      task(3, 'moving task', { parent: 2, progress: 25 }),
      task(4, 'remaining sibling', { parent: 2 }),
      task(5, 'next root'),
    ]

    const result = moveTaskAtPlacement(tasks, 3, 2, 'after')

    expect(ids(result)).toEqual([1, 2, 4, 3, 5])
    expect(result[3]).toMatchObject({ id: 3, text: 'moving task', parent: 1, progress: 25 })
    expect(result[1]).toMatchObject({ id: 2, type: 'summary' })
    expect(result[2].parent).toBe(2)
  })

  it('preserves unrelated tasks with undefined IDs while moving a task', () => {
    const unnamed = { id: undefined, text: 'unnamed', type: 'task' } as ITask
    const tasks = [task(1, 'root'), unnamed, task(2, 'moving')]

    const result = moveTaskAtPlacement(tasks, 2, 1, 'before')
    expect(result[2]).toBe(unnamed)
  })

  it('moves a complete subtree before or after another sibling', () => {
    const tasks = [
      task(1, 'one', { type: 'summary', open: true }),
      task(2, 'one-child', { parent: 1 }),
      task(3, 'two'),
      task(4, 'three'),
    ]

    const before = moveTaskAtPlacement(tasks, 3, 1, 'before')
    expect(ids(before)).toEqual([3, 1, 2, 4])
    expect(before[0]).not.toHaveProperty('parent')

    const after = moveTaskAtPlacement(tasks, 1, 4, 'after')
    expect(ids(after)).toEqual([3, 4, 1, 2])
    expect(after[2].type).toBe('summary')
    expect(after[3].parent).toBe(1)
  })

  it('moves siblings up and down, preserving subtree contiguity', () => {
    const tasks = [
      task(1, 'one'),
      task(2, 'two', { type: 'summary', open: true }),
      task(3, 'two-child', { parent: 2 }),
      task(4, 'three'),
    ]

    expect(ids(moveTaskAtPlacement(tasks, 4, undefined, 'up'))).toEqual([1, 4, 2, 3])
    expect(ids(moveTaskAtPlacement(tasks, 1, undefined, 'down'))).toEqual([2, 3, 1, 4])
  })

  it('rejects moves into the moved subtree and unknown placements without changing the input array', () => {
    const tasks = [task(1, 'root', { type: 'summary' }), task(2, 'child', { parent: 1 }), task(3)]

    expect(moveTaskAtPlacement(tasks, 1, 2, 'child')).toBe(tasks)
    expect(moveTaskAtPlacement(tasks, 1, 99, 'after')).toBe(tasks)
    expect(moveTaskAtPlacement(tasks, 99, 1, 'before')).toBe(tasks)
  })

})
