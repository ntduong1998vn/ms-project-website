import type { ITask } from '@svar-ui/react-gantt'
import { Trash2, UserPlus } from 'lucide-react'
import type { GanttResource, TaskWithResources } from '@/types/gantt'

export function ResourcesPanel({
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
