import { useEffect, useState } from 'react'
import type { ILink, ITask } from '@svar-ui/react-gantt'
import { Trash2, X } from 'lucide-react'
import type { GanttResource, TaskWithResources } from '@/types/gantt'

type DependencyType = ILink['type']

const dependencyTypeOptions: Array<{ value: DependencyType; label: string }> = [
  { value: 'e2s', label: 'FS — Finish to Start' },
  { value: 's2s', label: 'SS — Start to Start' },
  { value: 'e2e', label: 'FF — Finish to Finish' },
  { value: 's2e', label: 'SF — Start to Finish' },
]

export function TaskInfoPanel({
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
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const target = event.target as HTMLElement | null
      if (
        target?.closest?.(
          'input, textarea, select, [contenteditable], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]'
        )
      ) {
        return
      }
      onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

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
      className="absolute inset-y-0 right-0 z-30 flex w-[320px] flex-col border-l border-border bg-card shadow-2xl animate-in slide-in-from-right duration-200"
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
