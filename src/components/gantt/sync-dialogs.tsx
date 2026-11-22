import { useState } from 'react'
import { Dialog } from 'radix-ui'
import { Button } from '@/components/ui/button'
import type { SyncChoice, SyncConflict, SyncReport } from '@/lib/integrations/two-way'

function display(value: unknown): string {
  if (value === undefined || value === null || value === '') return '(empty)'
  if (value instanceof Date) return value.toLocaleDateString()
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

const overlay = 'fixed inset-0 z-50 bg-black/60 backdrop-blur-xs'
const content = 'fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[95vw] max-w-4xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-2xl'

export function SyncConflictDialog({ conflicts, onApply, onCancel }: {
  conflicts: SyncConflict[]; onApply: (choices: Record<string, SyncChoice>) => Promise<void>; onCancel: () => void
}) {
  const [choices, setChoices] = useState<Record<string, SyncChoice>>({})
  const [applying, setApplying] = useState(false)
  const all = (choice: SyncChoice) => setChoices(Object.fromEntries(conflicts.map((c) => [c.id, choice])))
  return <Dialog.Root open onOpenChange={(open) => { if (!open && !applying) onCancel() }}><Dialog.Portal>
    <Dialog.Overlay className={overlay} /><Dialog.Content className={content} onEscapeKeyDown={(e) => { if (applying) e.preventDefault() }}>
      <Dialog.Title className="text-lg font-semibold">Resolve sync conflicts</Dialog.Title>
      <Dialog.Description className="mt-1 text-sm text-muted-foreground">Choose which value to keep. Nothing is applied or pushed until Apply.</Dialog.Description>
      <div className="my-4 flex gap-2"><Button variant="outline" disabled={applying} onClick={() => all('local')}>Keep all local</Button><Button variant="outline" disabled={applying} onClick={() => all('remote')}>Take all Redmine</Button></div>
      <table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-2">Task / issue</th><th className="p-2">Field</th><th className="p-2">Local</th><th className="p-2">Redmine</th><th className="p-2">Keep</th></tr></thead>
        <tbody>{conflicts.map((c) => <tr key={c.id} className="border-b border-border"><td className="p-2">{c.task}<div className="text-xs text-muted-foreground">#{c.issueKey}</div></td><td className="p-2">{c.fieldLabel}</td><td className="max-w-52 break-words p-2">{display(c.local)}</td><td className="max-w-52 break-words p-2">{display(c.remote)}</td><td className="p-2"><select aria-label={`Keep value for issue ${c.issueKey} field ${c.fieldLabel}`} className="rounded border border-border bg-background p-2" disabled={applying} value={choices[c.id] ?? ''} onChange={(e) => setChoices((prev) => ({ ...prev, [c.id]: e.target.value as SyncChoice }))}><option value="" disabled>Choose…</option><option value="local">Local</option><option value="remote">Redmine</option></select></td></tr>)}</tbody>
      </table>
      <div className="mt-5 flex justify-end gap-2"><Button variant="outline" disabled={applying} onClick={onCancel}>Cancel</Button><Button disabled={applying || conflicts.some((c) => !choices[c.id])} onClick={async () => { setApplying(true); try { await onApply(choices) } finally { setApplying(false) } }}>{applying ? 'Syncing…' : 'Apply'}</Button></div>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>
}

export function SyncResultsDialog({ report, onClose, onRetry }: { report: SyncReport; onClose: () => void; onRetry: () => void }) {
  return <Dialog.Root open onOpenChange={(open) => { if (!open) onClose() }}><Dialog.Portal>
    <Dialog.Overlay className={overlay} /><Dialog.Content className={content}>
      <Dialog.Title className="text-lg font-semibold">Sync results</Dialog.Title>
      <Dialog.Description className="mt-2 text-sm">{report.pulled} pulled · {report.pushed} pushed · {report.inserted} inserted · {report.conflictsResolved} conflicts resolved · {report.failed.length} failed</Dialog.Description>
      {report.failed.length > 0 && <table className="my-4 w-full text-left text-sm"><thead><tr><th className="p-2">Issue / task</th><th className="p-2">Error</th></tr></thead><tbody>{report.failed.map((failure) => <tr key={failure.key} className="border-t border-border"><td className="p-2">#{failure.key} {failure.task}</td><td className="p-2 text-destructive">{failure.error}</td></tr>)}</tbody></table>}
      <div className="mt-5 flex justify-end gap-2">{report.failed.length > 0 && <Button variant="outline" onClick={onRetry}>Retry failed</Button>}<Button onClick={onClose}>Close</Button></div>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>
}
