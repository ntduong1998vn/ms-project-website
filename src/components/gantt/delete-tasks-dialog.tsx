import { Dialog } from 'radix-ui'
import { Trash2, X } from 'lucide-react'
import type { ITask } from '@svar-ui/react-gantt'
import { Button } from '@/components/ui/button'

interface DeleteTasksDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tasks: ITask[]
  selectedCount: number
  onConfirm: () => void
}

export function DeleteTasksDialog({
  open,
  onOpenChange,
  tasks,
  selectedCount,
  onConfirm,
}: DeleteTasksDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-6 shadow-2xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-destructive/10 text-destructive">
                <Trash2 className="h-4 w-4" />
              </div>
              <div>
                <Dialog.Title className="text-base font-semibold text-foreground">
                  Delete {tasks.length} {tasks.length === 1 ? 'Task' : 'Tasks'}?
                </Dialog.Title>
                <Dialog.Description className="text-xs text-muted-foreground">
                  This action cannot be undone.
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="mt-4 max-h-60 overflow-y-auto space-y-1 rounded-md border border-border bg-background p-1.5">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="flex items-center gap-2.5 rounded px-2.5 py-1.5 text-xs"
              >
                <span className="font-mono text-muted-foreground">#{task.id}</span>
                <span className="truncate">{task.text}</span>
              </div>
            ))}
          </div>
          {tasks.length > selectedCount && (
            <p className="mt-2 text-xs text-muted-foreground">
              Includes {tasks.length - selectedCount} subtask(s) of the selected items.
            </p>
          )}

          <div className="mt-6 flex items-center justify-end gap-2 border-t border-border pt-4">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={onConfirm}
              className="cursor-pointer"
            >
              Delete {tasks.length === 1 ? 'Task' : `${tasks.length} Tasks`}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
