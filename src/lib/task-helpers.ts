import type { ILink, ITask } from '@svar-ui/react-gantt'

type TaskWithPredecessors = ITask & { predecessors?: unknown }
type TaskPlacementMode = 'before' | 'after' | 'child' | 'up' | 'down'

type ResequencedProject = {
  tasks: ITask[]
  links: ILink[]
  selectedTaskId: string | number | null
}

export function sameTaskId(left: string | number | undefined, right: string | number | undefined): boolean {
  return left !== undefined && right !== undefined && String(left) === String(right)
}

export function collectTaskSubtreeIds(tasks: ITask[], rootId: string | number): Set<string> {
  const ids = new Set<string>([String(rootId)])
  let changed = true
  while (changed) {
    changed = false
    for (const task of tasks) {
      if (
        task.id !== undefined &&
        task.parent !== undefined &&
        ids.has(String(task.parent)) &&
        !ids.has(String(task.id))
      ) {
        ids.add(String(task.id))
        changed = true
      }
    }
  }
  return ids
}

export function toPositiveNumericTaskId(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null
}

export function getNextNumericTaskId(tasks: ITask[]): number {
  let nextId = 1
  for (const task of tasks) {
    const numericId = toPositiveNumericTaskId(task.id)
    if (numericId !== null && numericId >= nextId) {
      nextId = numericId + 1
    }
  }
  while (tasks.some((task) => toPositiveNumericTaskId(task.id) === nextId)) {
    nextId += 1
  }
  return nextId
}

export function remapPredecessorValue(value: unknown, idMap: Map<string, number>): unknown {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string' || typeof value === 'number'
      ? String(value).split(/[,\s]+/).filter(Boolean)
      : null
  if (!values) return value

  const mapped = values
    .map((predecessorId) => idMap.get(String(predecessorId)))
    .filter((predecessorId): predecessorId is number => predecessorId !== undefined)
  if (Array.isArray(value)) return mapped
  if (typeof value === 'number') return mapped[0] ?? ''
  return mapped.join(', ')
}

export function resequenceProject(
  tasks: ITask[],
  links: ILink[],
  selectedTaskId: string | number | null
): ResequencedProject {
  const idMap = new Map<string, number>()
  tasks.forEach((task, index) => {
    if (task.id !== undefined) {
      idMap.set(String(task.id), index + 1)
    }
  })

  const taskTypes = new Map(tasks.map((task) => [String(task.id), task.type]))
  const resequencedTasks = tasks.map((task, index) => {
    const resequencedTask = { ...task, id: index + 1 } as TaskWithPredecessors
    if (task.parent !== undefined) {
      const parentId = idMap.get(String(task.parent))
      if (parentId === undefined || taskTypes.get(String(task.parent)) === 'milestone') {
        delete resequencedTask.parent
      } else {
        resequencedTask.parent = parentId
      }
    }
    const predecessorValue = (task as TaskWithPredecessors).predecessors
    if (predecessorValue !== undefined) {
      resequencedTask.predecessors = remapPredecessorValue(predecessorValue, idMap)
    }
    return resequencedTask
  })
  const parentIds = new Set(
    resequencedTasks
      .filter((task) => task.parent !== undefined)
      .map((task) => String(task.parent))
  )
  resequencedTasks.forEach((task) => {
    if (!parentIds.has(String(task.id))) delete task.open
  })

  const resequencedLinks: ILink[] = []
  for (const link of links) {
    const source = idMap.get(String(link.source))
    const target = idMap.get(String(link.target))
    if (source === undefined || target === undefined) continue
    resequencedLinks.push({ ...link, source, target })
  }

  return {
    tasks: resequencedTasks,
    links: resequencedLinks,
    selectedTaskId: selectedTaskId === null ? null : idMap.get(String(selectedTaskId)) ?? null,
  }
}

export function hasParentCycle(
  taskId: string | number,
  parentId: string | number,
  parents: Map<string, string | number>
): boolean {
  const visited = new Set<string>()
  let current: string | number | undefined = parentId
  while (current !== undefined) {
    const key = String(current)
    if (key === String(taskId)) return true
    if (visited.has(key)) return true
    visited.add(key)
    current = parents.get(key)
  }
  return false
}
export function isTaskParentAllowed(tasks: ITask[], parentId: string | number | undefined): boolean {
  if (parentId === undefined) return true
  const parent = tasks.find((task) => sameTaskId(task.id, parentId))
  return parent?.type !== 'milestone'
}

function withoutMilestoneParent(tasks: ITask[], task: ITask): ITask {
  if (task.parent === undefined || isTaskParentAllowed(tasks, task.parent)) return task
  const rootTask = { ...task }
  delete rootTask.parent
  return rootTask
}


export function addTaskAtPlacement(
  tasks: ITask[],
  task: ITask,
  target: string | number | undefined,
  mode: TaskPlacementMode | undefined
): ITask[] {
  if (target === undefined || mode === undefined) return [...tasks, withoutMilestoneParent(tasks, task)]
  const targetIndex = tasks.findIndex((candidate) => sameTaskId(candidate.id, target))
  if (targetIndex < 0) return [...tasks, withoutMilestoneParent(tasks, task)]
  const targetTask = tasks[targetIndex]
  if (mode === 'child' && targetTask.type === 'milestone') return tasks

  const placedTask = { ...withoutMilestoneParent(tasks, task) }
  if (mode === 'child') {
    placedTask.parent = targetTask.id
  } else if (targetTask.parent !== undefined && isTaskParentAllowed(tasks, targetTask.parent)) {
    placedTask.parent = targetTask.parent
  } else {
    delete placedTask.parent
  }

  const insertionIndex =
    mode === 'child' || mode === 'after' ? subtreeEndIndex(tasks, targetIndex) : targetIndex
  const nextTasks =
    mode === 'child'
      ? tasks.map((candidate) =>
          sameTaskId(candidate.id, targetTask.id) ? { ...candidate, open: true } : candidate
        )
      : tasks
  return [...nextTasks.slice(0, insertionIndex), placedTask, ...nextTasks.slice(insertionIndex)]
}

export function moveTaskAtPlacement(
  tasks: ITask[],
  id: string | number,
  target: string | number | undefined,
  mode: TaskPlacementMode
): ITask[] {
  const movedIndex = tasks.findIndex((task) => sameTaskId(task.id, id))
  if (movedIndex < 0) return tasks

  const movedIds = collectTaskSubtreeIds(tasks, id)
  let targetId = target
  let placement: 'before' | 'after' | 'child' =
    mode === 'child' ? 'child' : mode === 'after' ? 'after' : 'before'
  const movedTask = tasks[movedIndex]

  if ((mode === 'up' || mode === 'down') && targetId === undefined) {
    const siblings = tasks.filter((task) =>
      task.parent === undefined && movedTask.parent === undefined
        ? true
        : sameTaskId(task.parent, movedTask.parent)
    )
    const siblingIndex = siblings.findIndex((task) => sameTaskId(task.id, id))
    const sibling = siblings[siblingIndex + (mode === 'up' ? -1 : 1)]
    targetId = sibling?.id
    placement = mode === 'up' ? 'before' : 'after'
  }
  if (targetId === undefined || movedIds.has(String(targetId))) return tasks

  const targetIndex = tasks.findIndex((task) => sameTaskId(task.id, targetId))
  if (targetIndex < 0) return tasks
  const targetTask = tasks[targetIndex]
  if (placement === 'child' && targetTask.type === 'milestone') return tasks
  if (placement !== 'child' && !isTaskParentAllowed(tasks, targetTask.parent)) return tasks
  const remaining = tasks.filter((task) => task.id === undefined || !movedIds.has(String(task.id)))
  const remainingTargetIndex = remaining.findIndex((task) => sameTaskId(task.id, targetId))
  if (remainingTargetIndex < 0) return tasks

  const movedBlock = tasks.filter((task) => task.id !== undefined && movedIds.has(String(task.id)))
  const movedRoot = { ...movedBlock[0] }
  if (placement === 'child') {
    movedRoot.parent = targetTask.id
  } else if (targetTask.parent !== undefined) {
    movedRoot.parent = targetTask.parent
  } else {
    delete movedRoot.parent
  }
  movedBlock[0] = movedRoot

  const insertionIndex =
    placement === 'after' || placement === 'child'
      ? subtreeEndIndex(remaining, remainingTargetIndex)
      : remainingTargetIndex
  const nextTasks =
    placement === 'child'
      ? [
          ...remaining.slice(0, insertionIndex),
          ...movedBlock,
          ...remaining.slice(insertionIndex),
        ].map((task) =>
          sameTaskId(task.id, targetTask.id) ? { ...task, open: true } : task
        )
      : [
          ...remaining.slice(0, insertionIndex),
          ...movedBlock,
          ...remaining.slice(insertionIndex),
        ]
  return nextTasks
}

function subtreeEndIndex(tasks: ITask[], rootIndex: number): number {
  const root = tasks[rootIndex]
  if (!root || root.id === undefined) return rootIndex
  const subtreeIds = collectTaskSubtreeIds(tasks, root.id)
  let end = rootIndex + 1
  while (end < tasks.length) {
    const task = tasks[end]
    if (task.parent === undefined || !subtreeIds.has(String(task.parent))) break
    end += 1
  }
  return end
}

