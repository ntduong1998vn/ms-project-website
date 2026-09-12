import { useState } from 'react'
import { Dialog } from 'radix-ui'
import { FileSpreadsheet, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { CsvImportData, CsvTaskField, CsvTaskMapping } from '@/types/gantt-csv'

const csvTaskFields = [
  { key: 'id', label: 'Task ID', required: false },
  { key: 'text', label: 'Task name / text', required: true },
  { key: 'start', label: 'Start date', required: false },
  { key: 'end', label: 'Finish / end date', required: false },
  { key: 'duration', label: 'Duration', required: false },
  { key: 'type', label: 'Task type', required: false },
  { key: 'progress', label: 'Progress', required: false },
  { key: 'parent', label: 'Parent task ID', required: false },
  { key: 'resources', label: 'Resource Names', required: false },
  { key: 'predecessors', label: 'Predecessor task IDs', required: false },
  { key: 'predecessorTypes', label: 'Dependency types', required: false },
] as const

const normalizeHeader = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, '')

const aliases: Record<CsvTaskField, string[]> = {
  id: ['id', 'taskid', 'tasknumber', 'number'],
  text: ['text', 'name', 'taskname', 'task', 'title', 'description'],
  start: ['start', 'startdate', 'begin', 'begindate'],
  end: ['end', 'enddate', 'finish', 'finishdate', 'duedate'],
  duration: ['duration', 'days', 'hours'],
  type: ['type', 'tasktype'],
  progress: ['progress', 'percentcomplete', 'percentdone', 'complete'],
  parent: ['parent', 'parentid', 'parenttask', 'parenttaskid'],
  resources: ['resources', 'resource', 'resourcenames', 'resourcename', 'resourceids', 'resourceid'],
  predecessors: ['predecessors', 'predecessor', 'predecessorids', 'predecessorid', 'depends', 'dependencies'],
  predecessorTypes: ['predecessortypes', 'predecessortype', 'dependencytypes', 'dependencytype', 'linktypes', 'linktype'],
}

function initialMapping(headers: string[]): CsvTaskMapping {
  const normalized = headers.map(normalizeHeader)
  const mapping = {} as CsvTaskMapping
  for (const field of csvTaskFields) {
    const candidates = aliases[field.key]
    const index = normalized.findIndex((header) => candidates.includes(header))
    mapping[field.key] = index >= 0 ? index : null
  }
  return mapping
}

export function CsvImportDialog({
  data,
  open,
  onOpenChange,
  onConfirm,
}: {
  data: CsvImportData | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (mapping: CsvTaskMapping) => void
}) {
  const [mapping, setMapping] = useState<CsvTaskMapping>(() => initialMapping(data?.headers ?? []))
  if (!data) return null
  const previewRows = data.rows.slice(0, 3)

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        {open && (
          <Dialog.Content
            className="fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-full max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border bg-card p-6 shadow-2xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
            aria-describedby="csv-import-description"
          >
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <FileSpreadsheet className="h-4 w-4" />
                </div>
                <div>
                  <Dialog.Title className="text-base font-semibold text-foreground">Import CSV Schedule</Dialog.Title>
                  <Dialog.Description id="csv-import-description" className="text-xs text-muted-foreground">
                    Verify the detected columns before importing {data.fileName} ({data.rows.length} data rows).
                  </Dialog.Description>
                </div>
              </div>
              <Dialog.Close asChild>
                <button type="button" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close CSV import dialog">
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </div>

            <div className="mt-4 grid gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
              {csvTaskFields.map((field) => (
                <label key={field.key} className="grid gap-1 text-xs font-medium text-foreground">
                  <span>
                    {field.label} {!field.required && <span className="font-normal text-muted-foreground">(optional)</span>}
                  </span>
                  <select
                    value={mapping[field.key] == null ? '' : String(mapping[field.key])}
                    onChange={(event) =>
                      setMapping((current) => ({
                        ...current,
                        [field.key]: event.target.value === '' ? null : Number(event.target.value),
                      }))
                    }
                    className="h-9 rounded-md border border-border bg-background px-2 text-xs font-normal text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    aria-label={`CSV column for ${field.label}`}
                  >
                    <option value="">Do not import</option>
                    {data.headers.map((header, index) => (
                      <option key={`${index}-${header}`} value={index}>
                        {header || `Column ${index + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>

            <div className="mt-4 rounded-md border border-border bg-muted/30 p-3">
              <div className="mb-2 text-xs font-semibold text-foreground">Detected headers</div>
              <div className="flex flex-wrap gap-1.5" aria-label="Detected CSV headers">
                {data.headers.map((header, index) => (
                  <span key={`${index}-${header}`} className="rounded bg-background px-2 py-1 font-mono text-[11px] text-muted-foreground">
                    {header || `Column ${index + 1}`}
                  </span>
                ))}
              </div>
              {previewRows.length > 0 && (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[520px] border-collapse text-[11px]">
                    <caption className="mb-1 text-left text-muted-foreground">Preview of first {previewRows.length} rows</caption>
                    <tbody>
                      {previewRows.map((row, rowIndex) => (
                        <tr key={rowIndex} className="border-t border-border/70">
                          {data.headers.map((_, columnIndex) => (
                            <td key={columnIndex} className="max-w-[180px] truncate px-1.5 py-1 text-muted-foreground">
                              {row[columnIndex] ?? ''}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2 border-t border-border pt-4">
              <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="cursor-pointer">Cancel</Button>
              <Button type="button" size="sm" onClick={() => onConfirm(mapping)} className="cursor-pointer">Import CSV</Button>
            </div>
          </Dialog.Content>
        )}
      </Dialog.Portal>
    </Dialog.Root>
  )
}
