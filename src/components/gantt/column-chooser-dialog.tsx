import { Dialog } from 'radix-ui'
import { X } from 'lucide-react'

export function ColumnChooserDialog({
  open,
  workVisible,
  onOpenChange,
  onAddWork,
}: {
  open: boolean
  workVisible: boolean
  onOpenChange: (open: boolean) => void
  onAddWork: () => void
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        {open && (
          <Dialog.Content
            className="fixed top-1/2 left-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 shadow-2xl"
            aria-describedby="column-chooser-description"
          >
            <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
              <div>
                <Dialog.Title className="text-base font-semibold text-foreground">
                  Add Gantt column
                </Dialog.Title>
                <Dialog.Description id="column-chooser-description" className="mt-1 text-xs text-muted-foreground">
                  Choose a column to display in the task grid.
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="Close add column dialog"
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </Dialog.Close>
            </div>
            <button
              type="button"
              onClick={onAddWork}
              disabled={workVisible}
              aria-pressed={workVisible}
              className="mt-4 flex w-full items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default disabled:opacity-60"
            >
              <span>
                <span className="block font-medium text-foreground">Work</span>
                <span className="block text-xs text-muted-foreground">Calculated effort in hours</span>
              </span>
              <span className="text-xs text-muted-foreground">{workVisible ? 'Already shown' : 'Add'}</span>
            </button>
          </Dialog.Content>
        )}
      </Dialog.Portal>
    </Dialog.Root>
  )
}
