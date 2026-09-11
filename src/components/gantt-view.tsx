import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Gantt,
  Willow,
  type IApi,
  type IColumnConfig,
  type ILink,
  type IResource,
  type IScaleConfig,
  type ITask,
} from '@svar-ui/react-gantt'
import '@svar-ui/react-gantt/all.css'
import { DropdownMenu } from 'radix-ui'
import {
  sampleLinks,
  sampleResources,
  sampleTasks,
} from '@/data/sample-gantt-data'
import type { GanttResource, GanttTask } from '@/types/gantt'
import {
  Calendar,
  CalendarDays,
  CalendarCheck,
  CheckCircle2,
  Clock,
  Download,
  FilePlus,
  FolderKanban,
  Indent,
  Layers,
  Outdent,
  PlusCircle,
  Diamond,
  Trash2,
  Upload,
  Users,
  UserPlus,
  X,
  Zap,
  ZapOff,
  ChevronDown,
} from 'lucide-react'
import { CalendarSettingsDialog } from '@/components/calendar-settings-dialog'
import {
  autoScheduleTasks,
  calculateEndDate,
  calculateTaskDuration,
  createSvarCalendarAdapter,
  defaultCalendarConfig,
  exclusiveEndToInclusiveFinish,
  formatToDateString,
  getNextWorkingDay,
  inclusiveFinishToExclusiveEnd,
  type ProjectCalendarConfig,
} from '@/lib/scheduler'

function formatDate(date: Date | string | undefined | null): string {
  if (!date) return ''
  const d = new Date(date)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  })
}

function PredecessorCell({ row, links }: { row: GanttTask; links: ILink[] }) {
  const incoming = links.filter((l) => String(l.target) === String(row.id))
  if (incoming.length === 0) {
    return <span style={{ color: '#9ca3af' }}>-</span>
  }
  const text = incoming.map((l) => `${l.source}`).join(', ')
  return (
    <span style={{ fontWeight: 500, fontFamily: 'monospace', fontSize: '0.82rem' }}>
      {text}
    </span>
  )
}

function ResourceNamesCell({ row, resources }: { row: GanttTask; resources: GanttResource[] }) {
  if (!row.resources || !Array.isArray(row.resources) || row.resources.length === 0) {
    return <span style={{ color: '#9ca3af' }}>-</span>
  }
  const names = row.resources
    .map((id: number) => resources.find((r) => r.id === id)?.label)
    .filter(Boolean)
    .join(', ')
  return (
    <span style={{ fontSize: '0.82rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
      {names || '-'}
    </span>
  )
}

type TaskWithResources = ITask & { resources?: number[] }
type TaskWithPredecessors = ITask & { predecessors?: unknown }

type DependencyType = ILink['type']

const dependencyTypeOptions: Array<{ value: DependencyType; label: string }> = [
  { value: 'e2s', label: 'FS — Finish to Start' },
  { value: 's2s', label: 'SS — Start to Start' },
  { value: 'e2e', label: 'FF — Finish to Finish' },
  { value: 's2e', label: 'SF — Start to Finish' },
]

type TaskPlacementMode = 'before' | 'after' | 'child' | 'up' | 'down'

function sameTaskId(left: string | number | undefined, right: string | number | undefined): boolean {
  return left !== undefined && right !== undefined && String(left) === String(right)
}

function collectTaskSubtreeIds(tasks: ITask[], rootId: string | number): Set<string> {
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

function toPositiveNumericTaskId(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null
}

function getNextNumericTaskId(tasks: ITask[]): number {
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

function remapPredecessorValue(value: unknown, idMap: Map<string, number>): unknown {
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

type ResequencedProject = {
  tasks: ITask[]
  links: ILink[]
  selectedTaskId: string | number | null
}

function resequenceProject(
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

  const resequencedTasks = tasks.map((task, index) => {
    const resequencedTask = { ...task, id: index + 1 } as TaskWithPredecessors
    if (task.parent !== undefined) {
      const parentId = idMap.get(String(task.parent))
      if (parentId === undefined) {
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
    selectedTaskId:
      selectedTaskId === null ? null : idMap.get(String(selectedTaskId)) ?? null,
  }
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

function addTaskAtPlacement(
  tasks: ITask[],
  task: ITask,
  target: string | number | undefined,
  mode: TaskPlacementMode | undefined
): ITask[] {
  if (target === undefined || mode === undefined) return [...tasks, task]
  const targetIndex = tasks.findIndex((candidate) => sameTaskId(candidate.id, target))
  if (targetIndex < 0) return [...tasks, task]

  const targetTask = tasks[targetIndex]
  const placedTask = { ...task }
  if (mode === 'child') {
    placedTask.parent = targetTask.id
  } else if (targetTask.parent !== undefined) {
    placedTask.parent = targetTask.parent
  } else {
    delete placedTask.parent
  }

  const insertionIndex =
    mode === 'child' || mode === 'after' ? subtreeEndIndex(tasks, targetIndex) : targetIndex
  const nextTasks =
    mode === 'child'
      ? tasks.map((candidate) =>
          sameTaskId(candidate.id, targetTask.id)
            ? { ...candidate, type: 'summary', open: true }
            : candidate
        )
      : tasks
  return [...nextTasks.slice(0, insertionIndex), placedTask, ...nextTasks.slice(insertionIndex)]
}

function moveTaskAtPlacement(
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
  let nextTasks = [
    ...remaining.slice(0, insertionIndex),
    ...movedBlock,
    ...remaining.slice(insertionIndex),
  ]

  if (placement === 'child') {
    nextTasks = nextTasks.map((task) =>
      sameTaskId(task.id, targetTask.id) && task.type !== 'summary'
        ? { ...task, type: 'summary', open: true }
        : task
    )
  }

  const oldParent = movedTask.parent
  if (
    oldParent !== undefined &&
    !nextTasks.some((task) => sameTaskId(task.parent, oldParent))
  ) {
    nextTasks = nextTasks.map((task) =>
      sameTaskId(task.id, oldParent) ? { ...task, type: 'task' } : task
    )
  }
  return nextTasks
}

function TaskInfoPanel({
  task,
  tasks,
  links,
  resources,
  onClose,
  onTaskChange,
  onAddPredecessor,
  onUpdatePredecessor,
  onDeletePredecessor,
  onToggleResource,
  onResourceChange,
}: {
  task: ITask
  tasks: ITask[]
  links: ILink[]
  resources: GanttResource[]
  onClose: () => void
  onTaskChange: (id: string | number, patch: Partial<ITask>) => void
  onAddPredecessor: (link: { source: string | number; target: string | number; type: DependencyType }) => void
  onUpdatePredecessor: (id: string | number, patch: Partial<ILink>) => void
  onDeletePredecessor: (id: string | number) => void
  onToggleResource: (taskId: string | number, resourceId: number, assigned: boolean) => void
  onResourceChange: (id: number, patch: Partial<GanttResource>) => void
}) {
  const [activePanelTab, setActivePanelTab] = useState<'general' | 'resources'>('general')
  const [newPredecessorId, setNewPredecessorId] = useState('')
  const [newPredecessorType, setNewPredecessorType] = useState<DependencyType>('e2s')
  const taskId = task.id
  const taskResources = new Set((task as TaskWithResources).resources ?? [])


  if (taskId === undefined) return null

  const incomingLinks = links.filter((link) => String(link.target) === String(taskId))
  const predecessorCandidates = tasks.filter(
    (candidate) => candidate.id !== undefined && String(candidate.id) !== String(taskId)
  )

  const handleAddPredecessor = () => {
    const source = predecessorCandidates.find(
      (candidate) => String(candidate.id) === newPredecessorId
    )?.id
    if (source === undefined) return

    onAddPredecessor({
      source,
      target: taskId,
      type: newPredecessorType,
    })
    setNewPredecessorId('')
  }

  return (
    <aside
      aria-label="Task information"
      data-panel="task-info"
      className="flex h-full w-[320px] shrink-0 flex-col border-l border-border bg-card"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Task Info</p>
          <h2 className="max-w-[230px] truncate text-sm font-semibold text-foreground">
            #{taskId} {task.text}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close task information"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div role="tablist" aria-label="Task information sections" className="flex border-b border-border px-3">
          <button
            type="button"
            role="tab"
            id="task-info-general-tab"
            aria-selected={activePanelTab === 'general'}
            aria-controls="task-info-general"
            onClick={() => setActivePanelTab('general')}
            className={`border-b-2 px-3 py-2.5 text-xs font-medium transition-colors ${
              activePanelTab === 'general'
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            General
          </button>
          <button
            type="button"
            role="tab"
            id="task-info-resources-tab"
            aria-selected={activePanelTab === 'resources'}
            aria-controls="task-info-resources"
            onClick={() => setActivePanelTab('resources')}
            className={`border-b-2 px-3 py-2.5 text-xs font-medium transition-colors ${
              activePanelTab === 'resources'
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Resources
          </button>
        </div>
        {activePanelTab === 'general' ? (
          <div id="task-info-general" role="tabpanel" aria-labelledby="task-info-general-tab" className="space-y-5 p-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Task name</span>
              <input
                value={task.text}
                onChange={(event) => onTaskChange(taskId, { text: event.target.value })}
                aria-label="Task name"
                className="w-full rounded-md border border-input bg-background px-2.5 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <dl className="rounded-lg border border-border bg-background p-3 text-xs">
              <div>
                <dt className="text-muted-foreground">Type</dt>
                <dd className="mt-1 font-medium capitalize text-foreground">{task.type}</dd>
              </div>
            </dl>
            <section aria-labelledby="task-info-predecessors-heading" className="space-y-3">
              <div>
                <h3 id="task-info-predecessors-heading" className="text-sm font-semibold text-foreground">
                  Predecessors
                </h3>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Tasks that must reach their dependency point before this task can proceed.
                </p>
              </div>
              {incomingLinks.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                  No predecessor links.
                </p>
              ) : (
                <div className="space-y-2">
                  {incomingLinks.map((link, index) => {
                    const predecessor = tasks.find(
                      (candidate) => String(candidate.id) === String(link.source)
                    )
                    const sourceValue = String(link.source)
                    const linkId = link.id
                    return (
                      <div
                        key={linkId ?? `${sourceValue}-${index}`}
                        className="space-y-2 rounded-lg border border-border bg-background p-3"
                      >
                        <div className="flex items-end gap-2">
                          <label className="min-w-0 flex-1 space-y-1">
                            <span className="text-[11px] font-medium text-muted-foreground">Predecessor</span>
                            <select
                              value={sourceValue}
                              onChange={(event) => {
                                if (linkId === undefined) return
                                const sourceTask = predecessorCandidates.find(
                                  (candidate) => String(candidate.id) === event.target.value
                                )
                                if (sourceTask?.id !== undefined) {
                                  onUpdatePredecessor(linkId, { source: sourceTask.id })
                                }
                              }}
                              aria-label={`Predecessor for ${task.text}`}
                              className="w-full min-w-0 rounded-md border border-input bg-card px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                            >
                              {!predecessor && (
                                <option value={sourceValue}>#{link.source} (missing task)</option>
                              )}
                              {predecessorCandidates.map((candidate) => (
                                <option
                                  key={candidate.id}
                                  value={String(candidate.id)}
                                  disabled={incomingLinks.some(
                                    (otherLink) =>
                                      otherLink.id !== linkId &&
                                      String(otherLink.source) === String(candidate.id)
                                  )}
                                >
                                  #{candidate.id} {candidate.text}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            type="button"
                            onClick={() => linkId !== undefined && onDeletePredecessor(linkId)}
                            aria-label={`Remove predecessor ${predecessor?.text ?? link.source}`}
                            disabled={linkId === undefined}
                            className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <label className="block space-y-1">
                          <span className="text-[11px] font-medium text-muted-foreground">Dependency type</span>
                          <select
                            value={link.type}
                            onChange={(event) => {
                              if (linkId !== undefined) {
                                onUpdatePredecessor(linkId, {
                                  type: event.target.value as DependencyType,
                                })
                              }
                            }}
                            aria-label={`Dependency type for ${predecessor?.text ?? link.source}`}
                            disabled={linkId === undefined}
                            className="w-full rounded-md border border-input bg-card px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {dependencyTypeOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    )
                  })}
                </div>
              )}
              <div className="space-y-2 rounded-lg border border-dashed border-border bg-background p-3">
                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-muted-foreground">Add predecessor</span>
                  <select
                    value={newPredecessorId}
                    onChange={(event) => setNewPredecessorId(event.target.value)}
                    aria-label={`Add predecessor for ${task.text}`}
                    disabled={predecessorCandidates.length === 0}
                    className="w-full rounded-md border border-input bg-card px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="">Select a task</option>
                    {predecessorCandidates.map((candidate) => (
                      <option
                        key={candidate.id}
                        value={String(candidate.id)}
                        disabled={incomingLinks.some(
                          (link) => String(link.source) === String(candidate.id)
                        )}
                      >
                        #{candidate.id} {candidate.text}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex items-end gap-2">
                  <label className="min-w-0 flex-1 space-y-1">
                    <span className="text-[11px] font-medium text-muted-foreground">Dependency type</span>
                    <select
                      value={newPredecessorType}
                      onChange={(event) => setNewPredecessorType(event.target.value as DependencyType)}
                      aria-label={`New dependency type for ${task.text}`}
                      disabled={predecessorCandidates.length === 0}
                      className="w-full rounded-md border border-input bg-card px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {dependencyTypeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={handleAddPredecessor}
                    disabled={!newPredecessorId || predecessorCandidates.length === 0}
                    className="rounded-md bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
              </div>
            </section>
          </div>
        ) : (
          <div id="task-info-resources" role="tabpanel" aria-labelledby="task-info-resources-tab" className="space-y-4 p-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Assigned resources</h3>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Assign people to this task and edit their details.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-background">
              {resources.length === 0 && (
                <p className="px-3 py-4 text-xs text-muted-foreground">
                  No resources yet. Add one from the Resources tab.
                </p>
              )}
              <div className="divide-y divide-border">
                {resources.map((resource) => {
                  const checked = taskResources.has(resource.id)
                  return (
                    <div key={resource.id} className="flex items-start gap-2.5 px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => onToggleResource(taskId, resource.id, event.target.checked)}
                        aria-label={`Assign ${resource.label} to ${task.text}`}
                        className="mt-1 h-3.5 w-3.5 accent-[#107c41]"
                      />
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <input
                          value={resource.label}
                          onChange={(event) => onResourceChange(resource.id, { label: event.target.value })}
                          aria-label={`Edit resource ${resource.label}`}
                          className="w-full border-0 bg-transparent p-0 text-xs font-medium text-foreground outline-none focus:ring-0"
                        />
                        <input
                          value={resource.role ?? ''}
                          onChange={(event) => onResourceChange(resource.id, { role: event.target.value })}
                          placeholder="Role (optional)"
                          aria-label={`Edit role for ${resource.label}`}
                          className="w-full border-0 bg-transparent p-0 text-[11px] text-muted-foreground outline-none focus:ring-0"
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}

function ResourcesPanel({
  resources,
  tasks,
  onAdd,
  onDelete,
  onChange,
}: {
  resources: GanttResource[]
  tasks: ITask[]
  onAdd: () => void
  onDelete: (id: number) => void
  onChange: (id: number, patch: Partial<GanttResource>) => void
}) {
  const assignmentCount = (resourceId: number) =>
    tasks.filter((task) => (task as TaskWithResources).resources?.includes(resourceId)).length

  return (
    <section aria-labelledby="resources-heading" className="h-full overflow-auto bg-background p-5">
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 id="resources-heading" className="text-lg font-semibold text-foreground">
              Resources
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage the people available to your project and their task assignments.
            </p>
          </div>
          <button
            type="button"
            onClick={onAdd}
            className="flex shrink-0 items-center gap-1.5 rounded-md bg-[#107c41] px-3 py-2 text-xs font-semibold text-white shadow-xs hover:bg-[#0f6d39]"
          >
            <UserPlus className="h-3.5 w-3.5" />
            Add resource
          </button>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-xs">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_100px_42px] items-center gap-3 border-b border-border bg-muted/40 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Name</span>
            <span>Role</span>
            <span>Assigned tasks</span>
            <span className="sr-only">Actions</span>
          </div>
          {resources.length === 0 && (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">No resources have been added yet.</p>
          )}
          {resources.map((resource) => (
            <div
              key={resource.id}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_100px_42px] items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
            >
              <label className="flex min-w-0 items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                  {(resource.label.trim()[0] || '?').toUpperCase()}
                </span>
                <input
                  value={resource.label}
                  onChange={(event) => onChange(resource.id, { label: event.target.value })}
                  aria-label={`Resource name ${resource.label}`}
                  className="min-w-0 w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-sm font-medium outline-none hover:border-border focus:border-primary focus:bg-background"
                />
              </label>
              <input
                value={resource.role ?? ''}
                onChange={(event) => onChange(resource.id, { role: event.target.value })}
                aria-label={`Resource role ${resource.label}`}
                placeholder="Add role"
                className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-sm text-muted-foreground outline-none hover:border-border focus:border-primary focus:bg-background"
              />
              <span className="text-xs tabular-nums text-muted-foreground">{assignmentCount(resource.id)}</span>
              <button
                type="button"
                onClick={() => onDelete(resource.id)}
                aria-label={`Delete resource ${resource.label}`}
                className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function toDateInputValue(date: Date | string | undefined | null): string {
  if (!date) return ''
  const d = new Date(date)
  if (isNaN(d.getTime())) return ''
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseDateInput(val: string): Date | null {
  if (!val) return null
  const [y, m, d] = val.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

function injectSvarCalendar(
  api: IApi,
  config: ProjectCalendarConfig,
  durationUnit: 'day' | 'hour'
) {
  api.getStores?.()?.data?.setState({
    _calendar: createSvarCalendarAdapter(config, durationUnit),
  })
}
function DurationCell({
  row,
  onDurationChange,
  onSelect,
}: {
  row: GanttTask
  onDurationChange: (id: string | number, duration: number) => void
  onSelect?: (id: string | number) => void
}) {
  const isSummary = row.type === 'summary'
  const isMilestone = row.type === 'milestone'

  if (isSummary || isMilestone) {
    return (
      <span className="text-xs font-semibold text-foreground/80 tabular-nums px-1">
        {row.duration ?? 0}
      </span>
    )
  }

  return (
    <EditableDurationInput
      rowId={row.id}
      taskText={row.text}
      duration={row.duration ?? 0}
      onDurationChange={onDurationChange}
      onSelect={onSelect}
    />
  )
}

function EditableDurationInput({
  rowId,
  taskText,
  duration,
  onDurationChange,
  onSelect,
}: {
  rowId: string | number
  taskText: string
  duration: number
  onDurationChange: (id: string | number, duration: number) => void
  onSelect?: (id: string | number) => void
}) {
  const [val, setVal] = useState<string>(String(duration))
  const [prevDuration, setPrevDuration] = useState<number>(duration)

  if (duration !== prevDuration) {
    setPrevDuration(duration)
    setVal(String(duration))
  }

  const handleCommit = () => {
    const parsed = parseFloat(val)
    if (!isNaN(parsed) && parsed >= 0) {
      if (parsed !== duration) {
        onDurationChange(rowId, parsed)
      }
    } else {
      setVal(String(duration))
    }
  }

  return (
    <div
      className="group relative flex items-center justify-center w-full h-full px-0.5"
      onClick={() => onSelect?.(rowId)}
    >
      <input
        type="number"
        min={0}
        step="any"
        value={val}
        onClick={(e) => {
          e.stopPropagation()
          onSelect?.(rowId)
        }}
        onChange={(e) => setVal(e.target.value)}
        onBlur={handleCommit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur()
          } else if (e.key === 'Escape') {
            setVal(String(duration))
            e.currentTarget.blur()
          }
        }}
        aria-label={`Duration for task ${taskText}`}
        className="w-full text-center text-xs font-medium text-foreground bg-transparent border border-transparent hover:border-border hover:bg-muted/40 focus:border-primary focus:bg-background rounded px-1 py-0.5 cursor-pointer outline-none transition-colors tabular-nums"
      />
    </div>
  )
}
function StartDateCell({
  row,
  onDateChange,
  onSelect,
}: {
  row: GanttTask
  onDateChange: (id: string | number, date: Date) => void
  onSelect?: (id: string | number) => void
}) {
  const isSummary = row.type === 'summary'
  const dateStr = formatDate(row.start)
  const inputVal = toDateInputValue(row.start)

  if (isSummary) {
    return (
      <span className="text-xs font-semibold text-foreground/80 tabular-nums px-1">
        {dateStr}
      </span>
    )
  }

  return (
    <div
      className="group relative flex items-center justify-center w-full h-full px-0.5"
      onClick={() => onSelect?.(row.id)}
    >
      <input
        type="date"
        value={inputVal}
        onClick={(e) => {
          e.stopPropagation()
          onSelect?.(row.id)
          try {
            e.currentTarget.showPicker?.()
          } catch {
            // fallback
          }
        }}
        onChange={(e) => {
          const parsed = parseDateInput(e.target.value)
          if (parsed) {
            onDateChange(row.id, parsed)
          }
        }}
        aria-label={`Start date for task ${row.text}`}
        className="w-full text-center text-xs font-medium text-foreground bg-transparent border border-transparent hover:border-border hover:bg-muted/40 focus:border-primary focus:bg-background rounded px-1 py-0.5 cursor-pointer outline-none transition-colors tabular-nums"
      />
    </div>
  )
}

function FinishDateCell({
  row,
  onDateChange,
  onSelect,
}: {
  row: GanttTask
  onDateChange: (id: string | number, date: Date) => void
  onSelect?: (id: string | number) => void
}) {
  const isSummary = row.type === 'summary'
  const isMilestone = row.type === 'milestone'
  // task.end is exclusive — subtract 1 day to get the inclusive finish for display/edit (for milestone, finish == start)
  const inclusiveFinish = isMilestone
    ? (row.start ? new Date(row.start) : null)
    : row.end
      ? exclusiveEndToInclusiveFinish(new Date(row.end))
      : null
  const dateStr = formatDate(inclusiveFinish)
  const inputVal = toDateInputValue(inclusiveFinish)
  if (isSummary) {
    return (
      <span className="text-xs font-semibold text-foreground/80 tabular-nums px-1">
        {dateStr}
      </span>
    )
  }

  return (
    <div
      className="group relative flex items-center justify-center w-full h-full px-0.5"
      onClick={() => onSelect?.(row.id)}
    >
      <input
        type="date"
        value={inputVal}
        onClick={(e) => {
          e.stopPropagation()
          onSelect?.(row.id)
          try {
            e.currentTarget.showPicker?.()
          } catch {
            // fallback
          }
        }}
        onChange={(e) => {
          const parsed = parseDateInput(e.target.value)
          if (parsed) {
            // parsed is the inclusive finish the user chose; pass it as-is.
            // handleFinishDateChange converts it to exclusive via inclusiveFinishToExclusiveEnd.
            onDateChange(row.id, parsed)
          }
        }}
        aria-label={`Finish date for task ${row.text}`}
        className="w-full text-center text-xs font-medium text-foreground bg-transparent border border-transparent hover:border-border hover:bg-muted/40 focus:border-primary focus:bg-background rounded px-1 py-0.5 cursor-pointer outline-none transition-colors tabular-nums"
      />
    </div>
  )
}

const scalePresets: Record<string, IScaleConfig[]> = {
  hour: [
    { unit: 'day', step: 1, format: '%j %F %Y' },
    { unit: 'hour', step: 2, format: '%H:00' },
  ],
  day: [
    { unit: 'month', step: 1, format: '%F %Y' },
    { unit: 'day', step: 1, format: '%j' },
  ],
  week: [
    { unit: 'month', step: 1, format: '%F %Y' },
    { unit: 'week', step: 1, format: 'Week %W' },
  ],
  month: [
    { unit: 'year', step: 1, format: '%Y' },
    { unit: 'month', step: 1, format: '%M' },
  ],
}


type ZoomMode = keyof typeof scalePresets
type RibbonTab = 'task' | 'project' | 'view' | 'resources'

export function GanttView() {
  const [calendarConfig, setCalendarConfig] = useState<ProjectCalendarConfig>(defaultCalendarConfig)
  const [isAutoSchedule, setIsAutoSchedule] = useState<boolean>(true)
  const [isCalendarDialogOpen, setIsCalendarDialogOpen] = useState<boolean>(false)
  const [activeTab, setActiveTab] = useState<RibbonTab>('task')
  const [selectedTaskId, setSelectedTaskId] = useState<string | number | null>(null)

  const [durationUnit, setDurationUnit] = useState<'day' | 'hour'>('day')
  const [zoom, setZoom] = useState<ZoomMode>('day')

  // Initial tasks are pre-computed with autoScheduleTasks
  const [tasks, setTasks] = useState<ITask[]>(() =>
    autoScheduleTasks(
      sampleTasks as unknown as ITask[],
      sampleLinks as unknown as ILink[],
      defaultCalendarConfig,
      'day'
    )
  )
  const [links, setLinks] = useState<ILink[]>(sampleLinks as unknown as ILink[])
  const [resourceList, setResourceList] = useState<GanttResource[]>(sampleResources)

  const [api, setApi] = useState<IApi | null>(null)
  const apiRef = useRef<IApi | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const calendarConfigRef = useRef(calendarConfig)
  const durationUnitRef = useRef(durationUnit)

  useLayoutEffect(() => {
    calendarConfigRef.current = calendarConfig
    durationUnitRef.current = durationUnit
  }, [calendarConfig, durationUnit])

  useLayoutEffect(() => {
    if (!api) return
    injectSvarCalendar(api, calendarConfig, durationUnit)
  }, [api, calendarConfig, durationUnit])

  const handleTaskSelection = useCallback((ev: { id?: string | number } | undefined) => {
    if (ev?.id !== undefined) {
      setSelectedTaskId(ev.id)
    }
  }, [])

  const handleInit = useCallback((apiInstance: IApi) => {
    apiRef.current = apiInstance
    // Inject before publishing the API so the first controlled task refresh
    // observes the project calendar instead of SVAR's calendar-less default.
    injectSvarCalendar(apiInstance, calendarConfigRef.current, durationUnitRef.current)
    setApi(apiInstance)

    // Route double-click/editor activation to the custom Task Info panel.
    apiInstance.on('select-task', handleTaskSelection)
    apiInstance.intercept('show-editor', (ev: { id?: string | number } | undefined) => {
      handleTaskSelection(ev)
      return false
    })

  }, [handleTaskSelection])

  // Auto-schedule aware task update
  const handleUpdateTask = useCallback(
    ({
      id,
      task,
      inProgress,
    }: {
      id: string | number
      task: Partial<ITask> & { predecessors?: string | number }
      inProgress?: boolean
    }) => {
      if (inProgress) return
      setSelectedTaskId(id)

      let currentLinks = links
      if (task.predecessors !== undefined) {
        const raw = String(task.predecessors || '').trim()
        const sourceIds = raw
          ? raw
              .split(/[,\s]+/)
              .map((s) => s.trim())
              .filter(Boolean)
              .map(Number)
              .filter((n) => !isNaN(n) && n > 0 && String(n) !== String(id))
          : []

        const remainingLinks = links.filter((l) => String(l.target) !== String(id))
        let nextId = links.length > 0 ? Math.max(...links.map((l) => Number(l.id) || 0)) + 1 : 1

        const newLinks: ILink[] = sourceIds.map((srcId) => {
          const existing = links.find(
            (l) => String(l.target) === String(id) && String(l.source) === String(srcId)
          )
          if (existing) return existing
          return {
            id: nextId++,
            source: srcId,
            target: id,
            type: 'e2s',
          }
        })

        currentLinks = [...remainingLinks, ...newLinks]
        setLinks(currentLinks)
      }

      setTasks((prev) => {
        const existing = prev.find((t) => String(t.id) === String(id))
        if (!existing) {
          return prev.map((t) => (String(t.id) === String(id) ? ({ ...t, ...task } as ITask) : t))
        }

        const existingStart = existing.start ? new Date(existing.start) : new Date()
        const existingEnd = existing.end ? new Date(existing.end) : existingStart

        const isStartChanged =
          task.start !== undefined &&
          new Date(task.start).getTime() !== existingStart.getTime()
        const isEndChanged =
          task.end !== undefined &&
          new Date(task.end).getTime() !== existingEnd.getTime()

        let updatedTask = { ...existing, ...task } as ITask

        const isDurationChanged =
          task.duration !== undefined &&
          Number(task.duration) !== existing.duration

        if (isDurationChanged && !isStartChanged) {
          // Duration changed directly (e.g. via Duration column or Editor)
          const dur =
            existing.type === 'milestone' ? 0 : Math.max(0, Number(task.duration) || 0)
          const s = getNextWorkingDay(existingStart, calendarConfig)
          const newEnd =
            dur === 0
              ? s
              : calculateEndDate(s, dur, calendarConfig, durationUnit)
          updatedTask = { ...updatedTask, start: s, duration: dur, end: newEnd }
        } else if (isEndChanged && !isStartChanged) {
          // task.end arrives as an exclusive boundary (set by handleFinishDateChange or SVAR drag).
          // Snap: find the inclusive last working day, then recompute exclusive end from start.
          const s = getNextWorkingDay(existingStart, calendarConfig)
          const exclusiveEnd = new Date(task.end!)
          if (existing.type === 'milestone') {
            // For a milestone, snap the exclusive end's preceding day to a working day,
            // then set both start and end to that working day (zero-width).
            const inclusivePick = new Date(
              exclusiveEnd.getFullYear(),
              exclusiveEnd.getMonth(),
              exclusiveEnd.getDate() - 1
            )
            const valid = getNextWorkingDay(inclusivePick, calendarConfig)
            updatedTask = { ...updatedTask, start: valid, end: valid, duration: 0 }
          } else {
            // Snap the inclusive finish forward to a working day, then make it exclusive again
            const inclusiveFinish = new Date(
              exclusiveEnd.getFullYear(),
              exclusiveEnd.getMonth(),
              exclusiveEnd.getDate() - 1
            )
            const snappedFinish = getNextWorkingDay(inclusiveFinish, calendarConfig)
            const snappedExclusiveEnd = new Date(
              snappedFinish.getFullYear(),
              snappedFinish.getMonth(),
              snappedFinish.getDate() + 1
            )
            const newDuration = Math.max(
              1,
              calculateTaskDuration(s, snappedExclusiveEnd, calendarConfig, durationUnit)
            )
            const finalEnd = calculateEndDate(s, newDuration, calendarConfig, durationUnit)
            updatedTask = { ...updatedTask, start: s, end: finalEnd, duration: newDuration }
          }
        } else if (isStartChanged && !isEndChanged) {
          // Start changed: recompute exclusive end to maintain existing duration
          const newStart = getNextWorkingDay(new Date(task.start!), calendarConfig)
          const dur = existing.type === 'milestone' ? 0 : (existing.duration ?? 1)
          const newEnd =
            existing.type === 'milestone'
              ? newStart
              : calculateEndDate(newStart, dur, calendarConfig, durationUnit)
          updatedTask = { ...updatedTask, start: newStart, end: newEnd, duration: dur }
        } else if (isStartChanged && isEndChanged) {
          // Both changed: SVAR sends this when a task bar is dragged or resized.
          const s = new Date(task.start!)
          const e = new Date(task.end!)
          if (existing.type === 'milestone') {
            const valid = getNextWorkingDay(s, calendarConfig)
            updatedTask = { ...updatedTask, start: valid, end: valid, duration: 0 }
          } else {
            const validStart = getNextWorkingDay(s, calendarConfig)
            const dur =
              task.duration !== undefined
                ? Number(task.duration)
                : Math.max(1, calculateTaskDuration(validStart, e, calendarConfig, durationUnit))
            const validEnd = calculateEndDate(validStart, dur, calendarConfig, durationUnit)
            updatedTask = { ...updatedTask, start: validStart, end: validEnd, duration: dur }
          }
        }
        const updated = prev.map((t) => (String(t.id) === String(id) ? updatedTask : t))
        if (isAutoSchedule) {
          return autoScheduleTasks(updated, currentLinks, calendarConfig, durationUnit)
        }
        return updated
      })
    },
    [calendarConfig, durationUnit, isAutoSchedule, links]
  )
  const ganttResources = useMemo<IResource[]>(
    () =>
      resourceList.map((resource) => ({
        id: resource.id,
        name: resource.label,
        avatar: resource.avatar,
      })),
    [resourceList]
  )

  const handleResourceChange = useCallback((id: number, patch: Partial<GanttResource>) => {
    setResourceList((current) =>
      current.map((resource) => (resource.id === id ? { ...resource, ...patch } : resource))
    )
  }, [])

  const handleAddResource = useCallback(() => {
    setResourceList((current) => {
      const nextId = current.length > 0 ? Math.max(...current.map((resource) => resource.id)) + 1 : 1
      return [...current, { id: nextId, label: `New Resource ${nextId}` }]
    })
  }, [])

  const handleDeleteResource = useCallback((id: number) => {
    const resource = resourceList.find((item) => item.id === id)
    if (!resource || !window.confirm(`Remove ${resource.label}? Existing task assignments will be cleared.`)) return
    setResourceList((current) => current.filter((item) => item.id !== id))
    setTasks((current) =>
      current.map((task) => {
        const assigned = (task as TaskWithResources).resources
        if (!assigned) return task
        return { ...task, resources: assigned.filter((resourceId) => resourceId !== id) } as ITask
      })
    )
  }, [resourceList])

  const handleToggleTaskResource = useCallback(
    (taskId: string | number, resourceId: number, assigned: boolean) => {
      setTasks((current) =>
        current.map((task) => {
          if (String(task.id) !== String(taskId)) return task
          const currentResources = (task as TaskWithResources).resources ?? []
          const nextResources = assigned
            ? Array.from(new Set([...currentResources, resourceId]))
            : currentResources.filter((id) => id !== resourceId)
          return { ...task, resources: nextResources } as ITask
        })
      )
    },
    []
  )

  const handleTaskInfoChange = useCallback(
    (id: string | number, patch: Partial<ITask>) => {
      handleUpdateTask({ id, task: patch })
    },
    [handleUpdateTask]
  )


  const handleAddTask = useCallback(
    ({
      task,
      target,
      mode,
    }: {
      task: ITask
      target?: string | number
      mode?: TaskPlacementMode
    }) => {
      const nextId = getNextNumericTaskId(tasks)
      const incomingId = toPositiveNumericTaskId(task.id)
      const taskId =
        incomingId !== null && !tasks.some((item) => toPositiveNumericTaskId(item.id) === incomingId)
          ? incomingId
          : nextId
      const type = task.type || 'task'
      const start = task.start ? new Date(task.start) : getNextWorkingDay(new Date(), calendarConfig)
      const duration =
        type === 'milestone'
          ? 0
          : task.duration ?? (durationUnit === 'hour' ? calendarConfig.workingHoursPerDay || 8 : 1)
      const end =
        type === 'milestone'
          ? start
          : task.end
            ? new Date(task.end)
            : calculateEndDate(start, duration, calendarConfig, durationUnit)
      const newTask: ITask = {
        ...task,
        id: taskId,
        text: task.text || `New Task ${taskId}`,
        start,
        end,
        duration,
        progress: task.progress ?? 0,
        type,
      }

      const newTasksList = addTaskAtPlacement(tasks, newTask, target, mode)
      const scheduled = isAutoSchedule
        ? autoScheduleTasks(newTasksList, links, calendarConfig, durationUnit)
        : newTasksList
      setTasks(scheduled)
      setSelectedTaskId(taskId)
    },
    [calendarConfig, durationUnit, isAutoSchedule, links, tasks]
  )

  const handleMoveTask = useCallback(
    ({
      id,
      target,
      mode,
      inProgress,
    }: {
      id: string | number
      target?: string | number
      mode: TaskPlacementMode
      inProgress?: boolean
    }) => {
      if (inProgress) return
      const movedTasks = moveTaskAtPlacement(tasks, id, target, mode)
      if (movedTasks === tasks) return
      const scheduled = isAutoSchedule
        ? autoScheduleTasks(movedTasks, links, calendarConfig, durationUnit)
        : movedTasks
      setTasks(scheduled)
      setSelectedTaskId(id)
    },
    [calendarConfig, durationUnit, isAutoSchedule, links, tasks]
  )

  const handleDeleteTask = useCallback(
    ({ id }: { id: string | number }) => {
      const idsToDelete = collectTaskSubtreeIds(tasks, id)
      const remainingTasks = tasks.filter(
        (task) => task.id === undefined || !idsToDelete.has(String(task.id))
      )
      const remainingLinks = links.filter(
        (link) =>
          !idsToDelete.has(String(link.source)) &&
          !idsToDelete.has(String(link.target))
      )
      const resequenced = resequenceProject(remainingTasks, remainingLinks, selectedTaskId)
      const scheduled = isAutoSchedule
        ? autoScheduleTasks(resequenced.tasks, resequenced.links, calendarConfig, durationUnit)
        : resequenced.tasks
      setTasks(scheduled)
      setLinks(resequenced.links)
      setSelectedTaskId(resequenced.selectedTaskId)
    },
    [calendarConfig, durationUnit, isAutoSchedule, links, selectedTaskId, tasks]
  )

  const handleAddLink = useCallback(
    ({ link, id }: { link: Partial<ILink>; id?: string | number }) => {
      setLinks((prev) => {
        const linkId = link.id ?? id ?? Date.now()
        const fullLink: ILink = {
          id: linkId,
          source: link.source as string | number,
          target: link.target as string | number,
          type: link.type || 'e2s',
          ...(link.lag !== undefined ? { lag: link.lag } : {}),
        }
        if (
          prev.some(
            (l) =>
              l.id === fullLink.id ||
              (String(l.source) === String(fullLink.source) &&
                String(l.target) === String(fullLink.target))
          )
        ) {
          return prev
        }
        const newLinks = [...prev, fullLink]
        if (isAutoSchedule) {
          setTasks((prevTasks) =>
            autoScheduleTasks(prevTasks, newLinks, calendarConfig, durationUnit)
          )
        }
        return newLinks
      })
    },
    [calendarConfig, durationUnit, isAutoSchedule]
  )

  const handleUpdateLink = useCallback(
    ({ id, link }: { id: string | number; link: Partial<ILink> }) => {
      setLinks((prev) => {
        const updatedLinks = prev.map((l) => (l.id === id ? ({ ...l, ...link } as ILink) : l))
        if (isAutoSchedule) {
          setTasks((prevTasks) =>
            autoScheduleTasks(prevTasks, updatedLinks, calendarConfig, durationUnit)
          )
        }
        return updatedLinks
      })
    },
    [calendarConfig, durationUnit, isAutoSchedule]
  )

  const handleDeleteLink = useCallback(
    ({ id }: { id: string | number }) => {
      setLinks((prev) => {
        const newLinks = prev.filter((l) => l.id !== id)
        if (isAutoSchedule) {
          setTasks((prevTasks) =>
            autoScheduleTasks(prevTasks, newLinks, calendarConfig, durationUnit)
          )
        }
        return newLinks
      })
    },
    [calendarConfig, durationUnit, isAutoSchedule]
  )

  const handleAddTaskInfoPredecessor = useCallback(
    (link: { source: string | number; target: string | number; type: DependencyType }) => {
      const duplicate = links.some(
        (existingLink) =>
          String(existingLink.source) === String(link.source) &&
          String(existingLink.target) === String(link.target)
      )
      if (duplicate || String(link.source) === String(link.target)) return
      handleAddLink({ link })
    },
    [handleAddLink, links]
  )

  const handleUpdateTaskInfoPredecessor = useCallback(
    (id: string | number, link: Partial<ILink>) => {
      const currentLink = links.find((existingLink) => existingLink.id === id)
      if (
        currentLink &&
        link.source !== undefined &&
        (String(link.source) === String(currentLink.target) ||
          links.some(
            (existingLink) =>
              existingLink.id !== id &&
              String(existingLink.source) === String(link.source) &&
              String(existingLink.target) === String(currentLink.target)
          ))
      ) {
        return
      }
      handleUpdateLink({ id, link })
    },
    [handleUpdateLink, links]
  )

  const handleDeleteTaskInfoPredecessor = useCallback(
    (id: string | number) => {
      handleDeleteLink({ id })
    },
    [handleDeleteLink]
  )

  // Calendar configuration saved from modal
  const handleSaveCalendar = useCallback(
    (newConfig: ProjectCalendarConfig) => {
      setCalendarConfig(newConfig)
      if (isAutoSchedule) {
        setTasks((prev) => autoScheduleTasks(prev, links, newConfig, durationUnit))
      }
    },
    [durationUnit, isAutoSchedule, links]
  )

  // Toggle Auto-Schedule ON/OFF
  const handleToggleAutoSchedule = useCallback(() => {
    setIsAutoSchedule((prev) => {
      const next = !prev
      if (next) {
        setTasks((currentTasks) =>
          autoScheduleTasks(currentTasks, links, calendarConfig, durationUnit)
        )
      }
      return next
    })
  }, [calendarConfig, durationUnit, links])

  // Change duration unit and recalculate
  const handleDurationUnitChange = useCallback(
    (newUnit: 'day' | 'hour') => {
      if (newUnit === durationUnit) return
      setDurationUnit(newUnit)

      setTasks((prev) => {
        const updated = prev.map((t) => {
          if (t.type === 'milestone') {
            return { ...t, duration: 0 }
          }
          if (!t.start || !t.end) return t
          const newDuration = calculateTaskDuration(
            new Date(t.start),
            new Date(t.end),
            calendarConfig,
            newUnit
          )
          return {
            ...t,
            duration: newDuration,
          }
        })
        if (isAutoSchedule) {
          return autoScheduleTasks(updated, links, calendarConfig, newUnit)
        }
        return updated
      })
    },
    [calendarConfig, durationUnit, isAutoSchedule, links]
  )

  // Timeline Highlight function for non-working days and holidays
  const handleHighlightTime = useCallback(
    (date: Date, _unit: 'day' | 'hour'): string => {
      if (!date || !(date instanceof Date) || isNaN(date.getTime())) return ''
      const dateStr = formatToDateString(date)
      const isHoliday = calendarConfig.holidays.some((h) => h.date === dateStr)
      if (isHoliday) {
        return 'gantt-holiday-cell'
      }

      const dayOfWeek = date.getDay()
      if (!calendarConfig.workingDays.includes(dayOfWeek)) {
        return 'gantt-weekend-cell'
      }

      return ''
    },
    [calendarConfig]
  )

  // Toolbar Actions: Add Task
  const handleAddTaskAction = useCallback(() => {
    const nextId = getNextNumericTaskId(tasks)
    const today = getNextWorkingDay(new Date(), calendarConfig)
    const duration = durationUnit === 'hour' ? (calendarConfig.workingHoursPerDay || 8) : 1
    const endDate = calculateEndDate(today, duration, calendarConfig, durationUnit)

    const selectedTask = selectedTaskId != null
      ? tasks.find((task) => sameTaskId(task.id, selectedTaskId))
      : null
    const parentId = selectedTask?.type === 'summary' ? selectedTask.id : selectedTask?.parent

    const newTask: ITask = {
      id: nextId,
      text: `New Task ${nextId}`,
      start: today,
      end: endDate,
      duration,
      progress: 0,
      type: 'task',
      ...(parentId !== undefined ? { parent: parentId } : {}),
    }

    const newTasksList = [...tasks, newTask]
    const scheduled = isAutoSchedule
      ? autoScheduleTasks(newTasksList, links, calendarConfig, durationUnit)
      : newTasksList

    setTasks(scheduled)
    setSelectedTaskId(nextId)
  }, [calendarConfig, durationUnit, isAutoSchedule, links, selectedTaskId, tasks])

  // Toolbar Actions: Add Milestone
  const handleAddMilestoneAction = useCallback(() => {
    const nextId = getNextNumericTaskId(tasks)
    const today = getNextWorkingDay(new Date(), calendarConfig)

    const selectedTask = selectedTaskId != null
      ? tasks.find((task) => sameTaskId(task.id, selectedTaskId))
      : null
    const parentId = selectedTask?.type === 'summary' ? selectedTask.id : selectedTask?.parent

    const newMilestone: ITask = {
      id: nextId,
      text: `Milestone ${nextId}`,
      start: today,
      end: today,
      duration: 0,
      progress: 0,
      type: 'milestone',
      ...(parentId !== undefined ? { parent: parentId } : {}),
    }

    const newTasksList = [...tasks, newMilestone]
    const scheduled = isAutoSchedule
      ? autoScheduleTasks(newTasksList, links, calendarConfig, durationUnit)
      : newTasksList

    setTasks(scheduled)
    setSelectedTaskId(nextId)
  }, [calendarConfig, durationUnit, isAutoSchedule, links, selectedTaskId, tasks])

  // Toolbar Actions: Indent Task
  const handleIndent = useCallback(() => {
    if (selectedTaskId == null) return
    const idx = tasks.findIndex((task) => sameTaskId(task.id, selectedTaskId))
    if (idx <= 0) return // First task cannot be indented

    const prevTask = tasks[idx - 1]
    const updatedTasks = tasks.map((t, i) => {
      if (sameTaskId(t.id, selectedTaskId)) {
        return { ...t, parent: prevTask.id }
      }
      if (i === idx - 1) {
        return { ...t, type: 'summary', open: true }
      }
      return t
    })

    if (apiRef.current) {
      try {
        apiRef.current.exec('indent-task', { id: selectedTaskId, mode: true })
      } catch {
        // Handled by state
      }
    }

    const scheduled = isAutoSchedule
      ? autoScheduleTasks(updatedTasks, links, calendarConfig, durationUnit)
      : updatedTasks
    setTasks(scheduled)
  }, [calendarConfig, durationUnit, isAutoSchedule, links, selectedTaskId, tasks])

  // Toolbar Actions: Outdent Task
  const handleOutdent = useCallback(() => {
    if (selectedTaskId == null) return
    const currTask = tasks.find((task) => sameTaskId(task.id, selectedTaskId))
    if (!currTask || currTask.parent == null) return // Already root level

    const parentTask = tasks.find((task) => sameTaskId(task.id, currTask.parent))
    const newParent = parentTask ? parentTask.parent : undefined

    const updatedTasks = tasks.map((t) => {
      if (sameTaskId(t.id, selectedTaskId)) {
        const copy = { ...t }
        if (newParent !== undefined) {
          copy.parent = newParent
        } else {
          delete copy.parent
        }
        return copy
      }
      return t
    })

    const remainingChildren = updatedTasks.filter((task) => sameTaskId(task.parent, currTask.parent))
    const finalTasks = updatedTasks.map((task) => {
      if (sameTaskId(task.id, currTask.parent) && remainingChildren.length === 0) {
        return { ...task, type: 'task' }
      }
      return task
    })

    if (apiRef.current) {
      try {
        apiRef.current.exec('indent-task', { id: selectedTaskId, mode: false })
      } catch {
        // Handled by state
      }
    }

    const scheduled = isAutoSchedule
      ? autoScheduleTasks(finalTasks, links, calendarConfig, durationUnit)
      : finalTasks
    setTasks(scheduled)
  }, [calendarConfig, durationUnit, isAutoSchedule, links, selectedTaskId, tasks])

  // Toolbar Actions: Delete Task
  const handleDeleteSelectedTask = useCallback(() => {
    if (selectedTaskId == null) return
    const idToDelete = selectedTaskId
    const idsToDelete = collectTaskSubtreeIds(tasks, idToDelete)
    const remainingTasks = tasks.filter(
      (task) => task.id === undefined || !idsToDelete.has(String(task.id))
    )
    const remainingLinks = links.filter(
      (link) =>
        !idsToDelete.has(String(link.source)) &&
        !idsToDelete.has(String(link.target))
    )
    const resequenced = resequenceProject(remainingTasks, remainingLinks, null)
    const scheduled = isAutoSchedule
      ? autoScheduleTasks(resequenced.tasks, resequenced.links, calendarConfig, durationUnit)
      : resequenced.tasks

    setTasks(scheduled)
    setLinks(resequenced.links)
    setSelectedTaskId(null)
  }, [calendarConfig, durationUnit, isAutoSchedule, links, selectedTaskId, tasks])

  // File Menu: Export JSON
  const handleExportJson = useCallback(() => {
    const exportData = {
      version: '1.0',
      projectName: 'Website Redesign & Launch Plan',
      exportedAt: new Date().toISOString(),
      calendarConfig,
      durationUnit,
      tasks: tasks.map((t) => ({
        ...t,
        start: t.start ? formatToDateString(new Date(t.start)) : undefined,
        end: t.end ? formatToDateString(new Date(t.end)) : undefined,
      })),
      links,
      resources: resourceList,
    }

    const jsonString = JSON.stringify(exportData, null, 2)
    const blob = new Blob([jsonString], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ms-project-schedule-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [calendarConfig, durationUnit, links, resourceList, tasks])

  // File Menu: Import JSON
  const handleImportFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      const reader = new FileReader()
      reader.onload = (event) => {
        try {
          const rawContent = event.target?.result
          if (typeof rawContent !== 'string') return

          const parsed = JSON.parse(rawContent) as {
            tasks?: Array<Partial<ITask> & { start?: string | Date; end?: string | Date; resources?: number[] }>
            links?: ILink[]
            resources?: GanttResource[]
            calendarConfig?: ProjectCalendarConfig
            durationUnit?: 'day' | 'hour'
          }

          if (!parsed.tasks || !Array.isArray(parsed.tasks)) {
            alert('Invalid JSON: Missing "tasks" array in file.')
            return
          }

          const newCalendarConfig = parsed.calendarConfig || calendarConfig
          const newUnit = parsed.durationUnit || durationUnit

          const importedTasks: ITask[] = parsed.tasks.map((t, idx) => ({
            ...t,
            id: t.id ?? idx + 1,
            text: t.text || `Task ${idx + 1}`,
            start: t.start ? new Date(t.start) : new Date(),
            end: t.end ? new Date(t.end) : new Date(),
            duration: t.type === 'milestone' ? 0 : (t.duration ?? 1),
            progress: t.progress ?? 0,
            type: t.type || 'task',
            resources: Array.isArray(t.resources)
              ? t.resources.map(Number).filter((resourceId) => Number.isFinite(resourceId))
              : undefined,
          }))

          const importedLinks: ILink[] = Array.isArray(parsed.links) ? parsed.links : []

          if (parsed.calendarConfig) {
            setCalendarConfig(newCalendarConfig)
          }
          if (parsed.durationUnit) {
            setDurationUnit(newUnit)
          }

          const scheduled = isAutoSchedule
            ? autoScheduleTasks(importedTasks, importedLinks, newCalendarConfig, newUnit)
            : importedTasks

          setTasks(scheduled)
          setLinks(importedLinks)
          if (Array.isArray(parsed.resources)) {
            setResourceList(
              parsed.resources
                .filter((resource) => Number.isFinite(resource.id) && typeof resource.label === 'string')
                .map((resource) => ({ ...resource, id: Number(resource.id) }))
            )
          }
          setSelectedTaskId(null)
        } catch {
          alert('Failed to parse JSON file. Please ensure it is a valid MS Project export.')
        } finally {
          e.target.value = ''
        }
      }
      reader.readAsText(file)
    },
    [calendarConfig, durationUnit, isAutoSchedule]
  )

  // File Menu: New Project
  const handleNewProject = useCallback(() => {
    if (!window.confirm('Create a new project? This will reset the task schedule to a clean template.')) {
      return
    }

    const today = getNextWorkingDay(new Date(), calendarConfig)
    const initialTasks: ITask[] = [
      {
        id: 1,
        text: 'Phase 1: Project Initiation',
        start: today,
        end: calculateEndDate(today, 5, calendarConfig, durationUnit),
        duration: 5,
        type: 'summary',
        open: true,
        progress: 0,
      },
      {
        id: 2,
        text: 'Scope & Requirements',
        start: today,
        end: calculateEndDate(today, 2, calendarConfig, durationUnit),
        duration: 2,
        type: 'task',
        progress: 0,
        parent: 1,
      },
      {
        id: 3,
        text: 'Architecture Planning',
        start: calculateEndDate(today, 2, calendarConfig, durationUnit),
        end: calculateEndDate(today, 5, calendarConfig, durationUnit),
        duration: 3,
        type: 'task',
        progress: 0,
        parent: 1,
      },
      {
        id: 4,
        text: 'Kickoff Milestone',
        start: calculateEndDate(today, 5, calendarConfig, durationUnit),
        end: calculateEndDate(today, 5, calendarConfig, durationUnit),
        duration: 0,
        type: 'milestone',
        progress: 0,
        parent: 1,
      },
    ]
    const initialLinks: ILink[] = [
      { id: 1, source: 2, target: 3, type: 'e2s' },
      { id: 2, source: 3, target: 4, type: 'e2s' },
    ]

    const scheduled = isAutoSchedule
      ? autoScheduleTasks(initialTasks, initialLinks, calendarConfig, durationUnit)
      : initialTasks

    setTasks(scheduled)
    setLinks(initialLinks)
    setSelectedTaskId(null)
    setResourceList(sampleResources)
  }, [calendarConfig, durationUnit, isAutoSchedule])

  const handleDurationChange = useCallback(
    (id: string | number, duration: number) => {
      handleUpdateTask({
        id,
        task: { duration },
      })
    },
    [handleUpdateTask]
  )

  const handleStartDateChange = useCallback(
    (id: string | number, date: Date) => {
      handleUpdateTask({
        id,
        task: { start: date },
      })
    },
    [handleUpdateTask]
  )

  const handleFinishDateChange = useCallback(
    (id: string | number, date: Date) => {
      // date is the inclusive finish chosen by the user in FinishDateCell.
      // Convert to the exclusive end boundary expected by scheduler and SVAR.
      handleUpdateTask({
        id,
        task: { end: inclusiveFinishToExclusiveEnd(date) },
      })
    },
    [handleUpdateTask]
  )
  const columns: IColumnConfig[] = useMemo(
    () => [
      {
        id: 'id',
        header: 'ID',
        width: 50,
        align: 'center',
        sort: true,
        cell: (({ row }: { row: GanttTask }) => (
          <span
            onClick={() => setSelectedTaskId(row.id)}
            style={{
              fontWeight: 600,
              fontSize: '0.82rem',
              color: selectedTaskId != null && sameTaskId(selectedTaskId, row.id) ? '#107c41' : '#6b7280',
              display: 'inline-block',
              width: '100%',
              textAlign: 'center',
              fontVariantNumeric: 'tabular-nums',
              cursor: 'pointer',
            }}
          >
            {row.id}
          </span>
        )) as unknown as IColumnConfig['cell'],
      },
      {
        id: 'text',
        header: 'Task Name',
        width: 220,
        flexgrow: 2,
        sort: true,
        editor: 'text',
      },
      {
        id: 'duration',
        header: `Duration (${durationUnit === 'day' ? 'days' : 'hrs'})`,
        width: 100,
        align: 'center',
        sort: true,
        cell: (({ row }: { row: GanttTask }) => (
          <DurationCell
            row={row}
            onDurationChange={handleDurationChange}
            onSelect={setSelectedTaskId}
          />
        )) as unknown as IColumnConfig['cell'],
      },
      {
        id: 'start',
        header: 'Start',
        width: 125,
        align: 'center',
        sort: true,
        cell: (({ row }: { row: GanttTask }) => (
          <StartDateCell
            row={row}
            onDateChange={handleStartDateChange}
            onSelect={setSelectedTaskId}
          />
        )) as unknown as IColumnConfig['cell'],
      },
      {
        id: 'end',
        header: 'Finish',
        width: 125,
        align: 'center',
        sort: true,
        cell: (({ row }: { row: GanttTask }) => (
          <FinishDateCell
            row={row}
            onDateChange={handleFinishDateChange}
            onSelect={setSelectedTaskId}
          />
        )) as unknown as IColumnConfig['cell'],
      },
      {
        id: 'predecessors',
        header: 'Predecessors',
        width: 100,
        align: 'center',
        editor: 'text',
        cell: (({ row }: { row: GanttTask }) => (
          <PredecessorCell row={row} links={links} />
        )) as unknown as IColumnConfig['cell'],
      },
      {
        id: 'resourceNames',
        header: 'Resource Names',
        width: 150,
        cell: (({ row }: { row: GanttTask }) => (
          <ResourceNamesCell row={row} resources={resourceList} />
        )) as unknown as IColumnConfig['cell'],
      },
      {
        id: 'add-task',
        header: '',
        width: 38,
        align: 'center',
      },
    ],
    [durationUnit, handleDurationChange, handleFinishDateChange, handleStartDateChange, links, resourceList, selectedTaskId]
  )

  const totalTasks = tasks.filter((t) => t.type !== 'summary').length
  const summaryTasks = tasks.filter((t) => t.type === 'summary').length
  const completedTasks = tasks.filter((t) => t.progress === 100).length

  const selectedTaskIndex =
    selectedTaskId != null ? tasks.findIndex((task) => sameTaskId(task.id, selectedTaskId)) : -1
  const selectedTask = selectedTaskIndex >= 0 ? tasks[selectedTaskIndex] : null
  const canIndent = selectedTaskIndex > 0
  const canOutdent = selectedTask != null && selectedTask.parent != null

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      {/* Hidden file input for JSON import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleImportFile}
        className="hidden"
      />

      {/* MS Project Top Header & Ribbon Navigation */}
      <header className="flex flex-col shrink-0 border-b border-border bg-card shadow-xs select-none">
        {/* Row 1: App Title, Ribbon Tabs, and Quick Status Metrics */}
        <div className="flex h-9 items-center justify-between border-b border-border/80 px-2.5">
          <div className="flex items-center gap-2">
            {/* MS Project Brand Badge */}
            <div className="flex items-center gap-1.5 pr-2 border-r border-border">
              <div className="flex h-6 w-6 items-center justify-center rounded bg-[#107c41] text-white shadow-xs">
                <FolderKanban className="h-3.5 w-3.5" />
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-xs font-bold tracking-tight text-foreground">MS Project</span>
                <span className="hidden text-[11px] text-muted-foreground sm:inline">Web</span>
              </div>
            </div>

            {/* Ribbon Tabs with File Dropdown */}
            <nav className="flex items-center gap-1">
              {/* File Dropdown Menu */}
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded bg-[#107c41] px-2.5 py-1 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-[#0f6d39] cursor-pointer"
                  >
                    <span>File</span>
                    <ChevronDown className="h-3 w-3 opacity-80" />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content className="z-50 min-w-[230px] rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-xl animate-in fade-in-80 zoom-in-95">
                    <DropdownMenu.Item
                      onSelect={handleNewProject}
                      className="flex cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-xs outline-none hover:bg-muted focus:bg-muted transition-colors"
                    >
                      <FilePlus className="h-4 w-4 text-primary" />
                      <div>
                        <div className="font-medium">New Project</div>
                        <div className="text-[10px] text-muted-foreground">Reset to fresh schedule template</div>
                      </div>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      onSelect={handleExportJson}
                      className="flex cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-xs outline-none hover:bg-muted focus:bg-muted transition-colors"
                    >
                      <Download className="h-4 w-4 text-blue-500" />
                      <div>
                        <div className="font-medium">Export Schedule (JSON)</div>
                        <div className="text-[10px] text-muted-foreground">Save project tasks and calendar to file</div>
                      </div>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      onSelect={() => fileInputRef.current?.click()}
                      className="flex cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-xs outline-none hover:bg-muted focus:bg-muted transition-colors"
                    >
                      <Upload className="h-4 w-4 text-emerald-500" />
                      <div>
                        <div className="font-medium">Import Schedule (JSON)</div>
                        <div className="text-[10px] text-muted-foreground">Load previously saved schedule</div>
                      </div>
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator className="my-1 h-px bg-border" />
                    <DropdownMenu.Item
                      onSelect={() => setIsCalendarDialogOpen(true)}
                      className="flex cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-xs outline-none hover:bg-muted focus:bg-muted transition-colors"
                    >
                      <Calendar className="h-4 w-4 text-amber-500" />
                      <div>
                        <div className="font-medium">Project Working Time & Calendar</div>
                        <div className="text-[10px] text-muted-foreground">Configure working hours, days & holidays</div>
                      </div>
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>

              {/* Task Tab */}
              <button
                type="button"
                onClick={() => setActiveTab('task')}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                  activeTab === 'task'
                    ? 'bg-muted text-foreground font-semibold border-b-2 border-primary'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                }`}
              >
                Task
              </button>

              {/* Project Tab */}
              <button
                type="button"
                onClick={() => setActiveTab('project')}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                  activeTab === 'project'
                    ? 'bg-muted text-foreground font-semibold border-b-2 border-primary'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                }`}
              >
                Project
              </button>

              {/* View Tab */}
              <button
                type="button"
                onClick={() => setActiveTab('view')}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                  activeTab === 'view'
                    ? 'bg-muted text-foreground font-semibold border-b-2 border-primary'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                }`}
              >
                View
              </button>
              {/* Resources Tab */}
              <button
                type="button"
                onClick={() => setActiveTab('resources')}
                className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                  activeTab === 'resources'
                    ? 'bg-muted text-foreground font-semibold border-b-2 border-primary'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                }`}
              >
                <Users className="h-3.5 w-3.5" />
                Resources
              </button>
            </nav>
          </div>

          {/* Quick Metrics Bar */}
          <div className="flex items-center gap-3 text-xs">
            <div className="hidden items-center gap-3.5 text-muted-foreground lg:flex">
              <div className="flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-primary" />
                <span>
                  <strong className="text-foreground">{summaryTasks}</strong> Phases
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5 text-blue-500" />
                <span>
                  <strong className="text-foreground">{totalTasks}</strong> Tasks
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                <span>
                  <strong className="text-foreground">{completedTasks}</strong> Done
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-amber-500" />
                <span>
                  <strong className="text-foreground">{resourceList.length}</strong> Resources
                </span>
              </div>
            </div>

            {/* Auto-Schedule Indicator */}
            <div
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border ${
                isAutoSchedule
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'border-muted-foreground/30 bg-muted text-muted-foreground'
              }`}
            >
              {isAutoSchedule ? <Zap className="h-3 w-3 text-emerald-500" /> : <ZapOff className="h-3 w-3" />}
              <span>Auto-Schedule: {isAutoSchedule ? 'ON' : 'OFF'}</span>
            </div>
          </div>
        </div>

        {/* Row 2: Active Ribbon Command Toolbar */}
        <div className="flex h-11 items-center justify-between px-3 bg-card/60">
          {/* TAB 1: TASK RIBBON */}
          {activeTab === 'task' && (
            <div className="flex items-center gap-2 overflow-x-auto py-1">
              {/* Add Tasks Group */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleAddTaskAction}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted hover:border-border transition-colors cursor-pointer shadow-2xs"
                  title="Add a new task to the schedule"
                >
                  <PlusCircle className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>Add Task</span>
                </button>
                <button
                  type="button"
                  onClick={handleAddMilestoneAction}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted hover:border-border transition-colors cursor-pointer shadow-2xs"
                  title="Add a milestone (0 duration)"
                >
                  <Diamond className="h-3.5 w-3.5 text-amber-500" />
                  <span>Add Milestone</span>
                </button>
                <button
                  type="button"
                  onClick={handleDeleteSelectedTask}
                  disabled={selectedTaskId == null}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 hover:border-destructive/30 transition-colors cursor-pointer shadow-2xs disabled:opacity-40 disabled:pointer-events-none"
                  title={selectedTaskId != null ? 'Delete selected task' : 'Select a task first to delete'}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Delete Task</span>
                </button>
              </div>

              <div className="h-5 w-px bg-border" />

              {/* Hierarchy Group: Indent & Outdent */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleIndent}
                  disabled={!canIndent}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted hover:border-border transition-colors cursor-pointer shadow-2xs disabled:opacity-40 disabled:pointer-events-none"
                  title={canIndent ? 'Indent task under the task above' : 'Cannot indent task'}
                >
                  <Indent className="h-3.5 w-3.5 text-blue-500" />
                  <span>Indent</span>
                </button>
                <button
                  type="button"
                  onClick={handleOutdent}
                  disabled={!canOutdent}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted hover:border-border transition-colors cursor-pointer shadow-2xs disabled:opacity-40 disabled:pointer-events-none"
                  title={canOutdent ? 'Outdent task to parent level' : 'Task is already at root level'}
                >
                  <Outdent className="h-3.5 w-3.5 text-blue-500" />
                  <span>Outdent</span>
                </button>
              </div>

              <div className="h-5 w-px bg-border" />

              {/* Scheduling Group: Auto-Schedule Toggle */}
              <button
                type="button"
                onClick={handleToggleAutoSchedule}
                className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer shadow-2xs ${
                  isAutoSchedule
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20'
                    : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
                title="Toggle automatic predecessor dependency rescheduling"
              >
                {isAutoSchedule ? (
                  <Zap className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <ZapOff className="h-3.5 w-3.5" />
                )}
                <span>Auto-Schedule: {isAutoSchedule ? 'ON' : 'OFF'}</span>
              </button>

              {/* Selected Task Context Pill */}
              {selectedTask && (
                <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground ml-2">
                  <span className="text-[10px] uppercase font-semibold text-muted-foreground/80">Selected:</span>
                  <span className="font-semibold text-foreground max-w-[180px] truncate">
                    #{selectedTask.id} {selectedTask.text}
                  </span>
                  <span className="rounded bg-muted px-1.5 py-0.2 text-[10px] font-mono">
                    {selectedTask.type}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: PROJECT RIBBON */}
          {activeTab === 'project' && (
            <div className="flex items-center gap-3 overflow-x-auto py-1">
              <button
                type="button"
                onClick={() => setIsCalendarDialogOpen(true)}
                className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors cursor-pointer shadow-2xs"
              >
                <Calendar className="h-4 w-4" />
                <span>Project Working Time & Calendar Settings</span>
              </button>

              <div className="h-5 w-px bg-border" />

              {/* Project Calendar Summary Chips */}
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5 bg-background border border-border rounded px-2.5 py-1">
                  <Clock className="h-3.5 w-3.5 text-blue-500" />
                  <span>
                    Working Hours: <strong className="text-foreground">{calendarConfig.workingHoursPerDay}h</strong> / day
                  </span>
                </div>
                <div className="flex items-center gap-1.5 bg-background border border-border rounded px-2.5 py-1">
                  <CalendarDays className="h-3.5 w-3.5 text-emerald-500" />
                  <span>
                    Working Days: <strong className="text-foreground">{calendarConfig.workingDays.length}</strong> days / week
                  </span>
                </div>
                <div className="flex items-center gap-1.5 bg-background border border-border rounded px-2.5 py-1">
                  <CalendarCheck className="h-3.5 w-3.5 text-rose-500" />
                  <span>
                    Holidays: <strong className="text-foreground">{calendarConfig.holidays.length}</strong> non-working exceptions
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: VIEW RIBBON */}
          {activeTab === 'view' && (
            <div className="flex items-center gap-3 overflow-x-auto py-1">
              {/* Zoom Controls */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Zoom Scale:</span>
                <div className="flex items-center gap-0.5 rounded-md border border-border bg-muted/40 p-0.5">
                  {(['hour', 'day', 'week', 'month'] as ZoomMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setZoom(mode)}
                      className={`rounded px-2.5 py-0.5 text-xs font-medium capitalize transition-colors cursor-pointer ${
                        zoom === mode
                          ? 'bg-background text-foreground shadow-xs font-semibold'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>

              <div className="h-5 w-px bg-border" />

              {/* Duration Unit Toggle */}
              <div className="flex items-center gap-1.5">
                <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  <span>Duration Unit:</span>
                </span>
                <div className="flex items-center gap-0.5 rounded-md border border-border bg-muted/40 p-0.5">
                  <button
                    type="button"
                    onClick={() => handleDurationUnitChange('day')}
                    className={`rounded px-2.5 py-0.5 text-xs font-medium transition-colors cursor-pointer ${
                      durationUnit === 'day'
                        ? 'bg-background text-foreground shadow-xs font-semibold'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Days
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDurationUnitChange('hour')}
                    className={`rounded px-2.5 py-0.5 text-xs font-medium transition-colors cursor-pointer ${
                      durationUnit === 'hour'
                        ? 'bg-background text-foreground shadow-xs font-semibold'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Hours
                  </button>
                </div>
              </div>
            </div>
          )}
          {activeTab === 'resources' && (
            <div className="flex items-center gap-3 overflow-x-auto py-1">
              <button
                type="button"
                onClick={handleAddResource}
                className="flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Add resource
              </button>
              <span className="text-xs text-muted-foreground">
                {resourceList.length} {resourceList.length === 1 ? 'resource' : 'resources'} available
              </span>
            </div>
          )}
        </div>
      </header>

      {/* Main Gantt View Area or Resource Management */}
      <main className="relative min-h-0 flex-1 w-full overflow-hidden">
        {activeTab === 'resources' ? (
          <ResourcesPanel
            resources={resourceList}
            tasks={tasks}
            onAdd={handleAddResource}
            onDelete={handleDeleteResource}
            onChange={handleResourceChange}
          />
        ) : (
          <div className="flex h-full min-h-0 w-full">
            <div className="min-w-0 flex-1">
              <Willow>
                <Gantt
                  init={handleInit}
                  tasks={api ? tasks : []}
                  links={links}
                  resources={ganttResources}
                  scales={scalePresets[zoom]}
                  columns={columns}
                  gridWidth={540}
                  durationUnit={durationUnit}
                  cellHeight={35}
                  scaleHeight={30}
                  cellWidth={zoom === 'hour' ? 60 : 100}
                  highlightTime={handleHighlightTime}
                  onSelectTask={handleTaskSelection}
                  onUpdateTask={handleUpdateTask}
                  onAddTask={handleAddTask}
                  onMoveTask={handleMoveTask}
                  onDeleteTask={handleDeleteTask}
                  onAddLink={handleAddLink}
                  onUpdateLink={handleUpdateLink}
                  onDeleteLink={handleDeleteLink}
                />
              </Willow>
            </div>
            {selectedTask && (
              <TaskInfoPanel
                key={String(selectedTask.id)}
                task={selectedTask}
                tasks={tasks}
                links={links}
                resources={resourceList}
                onClose={() => setSelectedTaskId(null)}
                onTaskChange={handleTaskInfoChange}
                onAddPredecessor={handleAddTaskInfoPredecessor}
                onUpdatePredecessor={handleUpdateTaskInfoPredecessor}
                onDeletePredecessor={handleDeleteTaskInfoPredecessor}
                onToggleResource={handleToggleTaskResource}
                onResourceChange={handleResourceChange}
              />
            )}
          </div>
        )}
      </main>

      {/* Project Calendar & Working Hours Modal */}
      <CalendarSettingsDialog
        open={isCalendarDialogOpen}
        onOpenChange={setIsCalendarDialogOpen}
        calendarConfig={calendarConfig}
        onSave={handleSaveCalendar}
      />
    </div>
  )
}
