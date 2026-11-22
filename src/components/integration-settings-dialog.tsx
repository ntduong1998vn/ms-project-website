import { useEffect, useState } from 'react'
import { Dialog } from 'radix-ui'
import { Loader2, Plug, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { syncTaskFields } from '@/lib/integrations/fields'
import { applyIntegrationMetadata, effectiveFields, invalidateIntegrationMetadata } from '@/lib/integrations/settings'
import { createProvider } from '@/lib/integrations'
import { importCustomFieldSchema } from '@/lib/integrations/redmine/schema'
import type { IntegrationSettings, RemoteFieldDescriptor, RemoteFieldValueType, RemoteProjectMetadata, SyncTaskField } from '@/lib/integrations/types'

interface IntegrationSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: IntegrationSettings
  onSave: (s: IntegrationSettings) => void
  onSaveAndGet: (s: IntegrationSettings) => void
  onTestConnection: (draft: IntegrationSettings) => Promise<string>
  onFetchMetadata: (draft: IntegrationSettings) => Promise<RemoteProjectMetadata>
}

const inputClass = 'w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring'
const types: RemoteFieldValueType[] = ['string', 'number', 'date', 'hours', 'progress', 'user', 'issue-ref', 'relations']
const steps = ['Connection', 'Project', 'Fields', 'Review']

function compatible(task: SyncTaskField, field: RemoteFieldDescriptor): boolean {
  const accepted: Record<SyncTaskField, RemoteFieldValueType[]> = {
    text: ['string'], details: ['string'], start: ['date'], end: ['date'], duration: ['hours', 'number'],
    progress: ['progress', 'number'], resources: ['user'], parent: ['issue-ref'], type: ['string'], successors: ['relations'],
  }
  return accepted[task].includes(field.valueType)
}

function Content({ settings, onSave, onSaveAndGet, onTestConnection, onFetchMetadata, onClose }: Omit<IntegrationSettingsDialogProps, 'open' | 'onOpenChange'> & { onClose: () => void }) {
  const complete = Boolean(settings.baseUrl && settings.apiKey && settings.projectIdentifier && settings.knownFields.length)
  const [draft, setDraft] = useState(() => structuredClone(settings))
  const [step, setStep] = useState(complete ? 2 : 0)
  const [tested, setTested] = useState(complete)
  const [busy, setBusy] = useState(complete)
  const [message, setMessage] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [error, setError] = useState('')
  const [projects, setProjects] = useState<Array<{ id: number; identifier: string; name: string }>>([])
  const [search, setSearch] = useState('')
  const [metadataReady, setMetadataReady] = useState(false)
  const [schema, setSchema] = useState('')
  const [newId, setNewId] = useState('')
  const [newLabel, setNewLabel] = useState('')

  const fields = effectiveFields(draft)
  const syncFields = [
    ...fields.filter((f) => f.kind === 'custom' || draft.mapping.extraFields.includes(f.key)),
    ...draft.mapping.extraFields.filter((key) => !fields.some((f) => f.key === key)).map((key): RemoteFieldDescriptor => ({
      key, label: `${key} (unavailable)`, kind: key.startsWith('cf_') ? 'custom' : 'standard', valueType: 'string',
    })),
  ]
  const [request, setRequest] = useState<{ step: number; settings: IntegrationSettings } | null>(() => complete ? { step: 2, settings } : null)

  function goTo(next: number) {
    setStep(next)
    setError('')
    if (next === 1 || next === 2) {
      setBusy(true)
      setMetadataReady(false)
      setRequest({ step: next, settings: draft })
    } else setRequest(null)
  }

  useEffect(() => {
    if (!request) return
    let cancelled = false
    if (request.step === 1) {
      createProvider(request.settings).listProjects().then((items) => {
        if (!cancelled) setProjects(items)
      }).catch((err: unknown) => {
        if (!cancelled) setError('Project list: ' + (err instanceof Error ? err.message : String(err)) + ' — use the manual identifier below.')
      }).finally(() => { if (!cancelled) setBusy(false) })
    } else {
      onFetchMetadata(request.settings).then((meta) => {
        if (cancelled) return
        setDraft((d) => applyIntegrationMetadata(d, meta))
        setWarnings(meta.warnings)
        setMetadataReady(true)
      }).catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }).finally(() => { if (!cancelled) setBusy(false) })
    }
    return () => { cancelled = true }
  }, [request, onFetchMetadata])

  function updateConnection(patch: Partial<IntegrationSettings>) {
    setDraft((d) => invalidateIntegrationMetadata(d, patch))
    setError('')
    setWarnings([])
    setMetadataReady(false)
    if ('baseUrl' in patch || 'apiKey' in patch || 'useDevProxy' in patch) {
      setTested(false)
      setMessage('')
    }
  }

  async function test() {
    setBusy(true)
    setTested(false)
    setError('')
    try {
      const name = await onTestConnection(draft)
      setMessage('Connected as ' + name)
      setTested(true)
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }

  function mapField(key: SyncTaskField, value: string) {
    setDraft((d) => ({ ...d, mapping: { ...d.mapping, fields: { ...d.mapping.fields, [key]: value || null } } }))
  }

  function override(key: string, patch: IntegrationSettings['fieldOverrides'][string]) {
    setDraft((d) => ({ ...d, fieldOverrides: { ...d.fieldOverrides, [key]: { ...d.fieldOverrides[key], ...patch } } }))
  }

  function addManual() {
    const id = Number(newId)
    if (!/^\d+$/.test(newId) || !Number.isSafeInteger(id) || id <= 0) { setError('Enter a positive custom field ID.'); return }
    const key = 'cf_' + id
    if (fields.some((f) => f.key === key)) { setError('That custom field is already listed.'); return }
    setDraft((d) => ({ ...d, manualFields: [...d.manualFields, { key, label: newLabel.trim() || 'Custom field ' + id, kind: 'custom', valueType: 'string' }] }))
    setNewId(''); setNewLabel(''); setError('')
  }

  function importSchema() {
    try {
      const imported = importCustomFieldSchema(schema)
      setDraft((d) => ({ ...d, manualFields: [...new Map([...d.manualFields, ...imported].map((f) => [f.key, f])).values()] }))
      setSchema(''); setError('')
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }

  function save(get: boolean) {
    if (!draft.mapping.fields.text) { setError('Task Name is required — map it to a remote field before saving.'); setStep(2); return }
    if (get) onSaveAndGet(draft)
    else onSave(draft)
    onClose()
  }

  return <Dialog.Content className="fixed top-1/2 left-1/2 z-50 max-h-[90vh] w-[min(95vw,48rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-2xl">
    <div className="flex items-center justify-between border-b border-border pb-3">
      <Dialog.Title className="flex items-center gap-2 text-base font-semibold"><Plug className="size-5" /> Redmine Settings</Dialog.Title>
      <Dialog.Close asChild><Button variant="ghost" size="icon" aria-label="Close"><X className="size-4" /></Button></Dialog.Close>
    </div>
    <Dialog.Description className="mt-2 text-sm text-muted-foreground">Connect your project and choose how Redmine fields map to your schedule.</Dialog.Description>
    <ol className="my-5 flex gap-2" aria-label="Setup progress">{steps.map((label, i) => <li key={label} aria-current={i === step ? 'step' : undefined} className={cn('flex-1 rounded-md px-2 py-2 text-center text-xs', i === step ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>{i + 1}. {label}</li>)}</ol>
    {step === 0 && <section className="space-y-4">
      <h2 className="font-semibold">Connection</h2>
      <label className="block text-sm">Redmine URL<input className={inputClass} value={draft.baseUrl} placeholder="https://redmine.example.com" disabled={busy} onChange={(e) => updateConnection({ baseUrl: e.target.value })} /></label>
      <label className="block text-sm">API key<input className={inputClass} type="password" value={draft.apiKey} disabled={busy} onChange={(e) => updateConnection({ apiKey: e.target.value })} /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.useDevProxy} disabled={busy} onChange={(e) => updateConnection({ useDevProxy: e.target.checked })} /> Use dev proxy</label>
      <p className="text-xs text-muted-foreground">Dev only — bypasses CORS through Vite. Production needs a CORS-enabled Redmine or a deployed proxy. Your API key is stored in this browser.</p>
      <Button disabled={busy || !draft.baseUrl.trim() || !draft.apiKey.trim()} onClick={() => void test()}>Test Connection</Button>
      {message && <p role="status" className="text-sm text-green-600">{message}</p>}
    </section>}
    {step === 1 && <section className="space-y-4">
      <h2 className="font-semibold">Choose a project</h2>
      <label className="block text-sm">Filter projects<input className={inputClass} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or identifier" /></label>
      <label className="block text-sm">Project<select className={inputClass} value={projects.some((p) => p.identifier === draft.projectIdentifier) ? draft.projectIdentifier : ''} disabled={busy} onChange={(e) => updateConnection({ projectIdentifier: e.target.value })}>
        <option value="">Select a project…</option>
        {projects.filter((p) => p.identifier === draft.projectIdentifier || (p.name + ' ' + p.identifier).toLowerCase().includes(search.toLowerCase())).map((p) => <option key={p.id} value={p.identifier}>{p.name} ({p.identifier})</option>)}
      </select></label>
      <label className="block text-sm">Manual project identifier or ID<input className={inputClass} value={draft.projectIdentifier} disabled={busy} onChange={(e) => updateConnection({ projectIdentifier: e.target.value })} placeholder="my-project" /></label>
    </section>}
    {step === 2 && <section className="space-y-4">
      <h2 className="font-semibold">Fields</h2>
      {warnings.length > 0 && <div role="status" className="rounded-md border border-amber-400/50 bg-amber-400/10 p-3 text-sm"><ul className="list-inside list-disc">{warnings.map((w) => <li key={w}>{w}</li>)}</ul></div>}
      <label className="block text-sm">Tracker for new issues<select className={inputClass} value={draft.trackerId ?? ''} onChange={(e) => setDraft((d) => ({ ...d, trackerId: e.target.value ? Number(e.target.value) : null }))}><option value="">Server default</option>{draft.knownTrackers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <h3 className="text-sm font-semibold">Field mapping</h3>
      <div className="grid gap-2 sm:grid-cols-2">{syncTaskFields.map(({ key, label, required }) => <label key={key} className="text-xs">{label}{required ? ' *' : ''}<select className={inputClass} value={draft.mapping.fields[key] ?? ''} onChange={(e) => mapField(key, e.target.value)}>
        <option value="">Not mapped</option>
        {fields.filter((f) => compatible(key, f) || f.key === draft.mapping.fields[key]).map((f) => <option key={f.key} value={f.key}>{f.label} ({f.valueType})</option>)}
        {draft.mapping.fields[key] && !fields.some((f) => f.key === draft.mapping.fields[key]) && <option value={draft.mapping.fields[key]!}>{draft.mapping.fields[key]} (unavailable)</option>}
      </select></label>)}</div>
      <h3 className="text-sm font-semibold">Additional field sync</h3>
      <p className="text-xs text-muted-foreground">Checked fields are imported on Get Tasks and written back on Sync to Redmine, even when hidden. Uncheck to disable additional-field sync; mapped fields are controlled above. Observed options are not a complete server schema.</p>
      {syncFields.map((f) => <div key={f.key} className="rounded-md border border-border p-3">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.mapping.extraFields.includes(f.key)} onChange={(e) => { const checked = e.target.checked; setDraft((d) => ({ ...d, mapping: { ...d.mapping, extraFields: checked ? [...d.mapping.extraFields, f.key] : d.mapping.extraFields.filter((k) => k !== f.key) } })) }} />Sync {f.label}<span className="ml-auto text-xs text-muted-foreground">{f.key} · {f.valueType}{f.multiple ? ' · multiple' : ''}</span></label>
        {f.kind === 'custom' && <details className="mt-2"><summary className="cursor-pointer text-xs text-primary">Override {f.label}</summary><div className="mt-2 grid gap-3 sm:grid-cols-2">
          <label className="text-xs">Label<input className={inputClass} value={f.label} onChange={(e) => override(f.key, { label: e.target.value })} /></label>
          <label className="text-xs">Value type<select className={inputClass} value={f.valueType} onChange={(e) => override(f.key, { valueType: e.target.value as RemoteFieldValueType })}>{types.map((t) => <option key={t}>{t}</option>)}</select></label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={f.multiple ?? false} onChange={(e) => override(f.key, { multiple: e.target.checked })} />Multiple values</label>
          <label className="text-xs">Options (one per line)<textarea className={inputClass} value={draft.fieldOverrides[f.key]?.options?.join('\n') ?? f.options?.map((o) => String(o.id)).join('\n') ?? ''} onChange={(e) => override(f.key, { options: e.target.value ? e.target.value.split('\n') : [] })} /></label>
          <Button variant="outline" size="sm" onClick={() => setDraft((d) => ({ ...d, fieldOverrides: Object.fromEntries(Object.entries(d.fieldOverrides).filter(([key]) => key !== f.key)) }))}>Reset override</Button>
        </div></details>}
      </div>)}
      <details><summary className="cursor-pointer text-sm font-medium">Add field by ID</summary><div className="mt-2 flex gap-2"><input aria-label="Custom field ID" className={inputClass} placeholder="ID" value={newId} onChange={(e) => setNewId(e.target.value)} /><input aria-label="Custom field label" className={inputClass} placeholder="Label (optional)" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} /><Button variant="outline" onClick={addManual}>Add</Button></div></details>
      <details><summary className="cursor-pointer text-sm font-medium">Import schema JSON</summary><p className="my-2 text-xs text-muted-foreground">Paste a /custom_fields.json response exported by an administrator. No admin access is needed here.</p><textarea aria-label="Schema JSON" className={inputClass} rows={4} value={schema} onChange={(e) => setSchema(e.target.value)} /><Button variant="outline" onClick={importSchema}>Import schema</Button></details>
    </section>}
    {step === 3 && <section className="space-y-4">
      <h2 className="font-semibold">Review your setup</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm"><dt className="text-muted-foreground">Server</dt><dd className="break-all">{draft.baseUrl}</dd><dt className="text-muted-foreground">Project</dt><dd>{draft.projectIdentifier}</dd><dt className="text-muted-foreground">Transport</dt><dd>{draft.useDevProxy ? 'Development proxy' : 'Direct (requires CORS)'}</dd><dt className="text-muted-foreground">Fields</dt><dd>{fields.length} available · {draft.mapping.extraFields.length} additional fields imported</dd></dl>
      <ul className="space-y-1 text-sm">{syncTaskFields.filter((f) => draft.mapping.fields[f.key]).map((f) => <li key={f.key}>{f.label} → {fields.find((r) => r.key === draft.mapping.fields[f.key])?.label ?? draft.mapping.fields[f.key]}</li>)}</ul>
      <p className="rounded-md bg-muted p-3 text-sm">Save &amp; Get Tasks merges Redmine issues into the current schedule, updating linked tasks. Local-only tasks are kept. Sync to Redmine remains a separate push action.</p>
      {warnings.length > 0 && <p className="text-xs text-amber-600">{warnings.join(' ')}</p>}
    </section>}
    {busy && <p role="status" className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{step === 2 ? 'Discovering fields…' : 'Connecting…'}</p>}
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    <footer className="mt-5 flex justify-between gap-2 border-t border-border pt-4">
      <Button variant="outline" disabled={busy || step === 0} onClick={() => goTo(step - 1)}>Back</Button>
      {step < 3 ? <Button disabled={busy || (step === 0 && !tested) || (step === 1 && !draft.projectIdentifier.trim()) || (step === 2 && (!metadataReady || !draft.mapping.fields.text))} onClick={() => goTo(step + 1)}>Next</Button> : <div className="flex gap-2"><Button variant="outline" onClick={() => save(false)}>Save</Button><Button onClick={() => save(true)}>Save &amp; Get Tasks</Button></div>}
    </footer>
  </Dialog.Content>
}

export function IntegrationSettingsDialog({ open, onOpenChange, ...props }: IntegrationSettingsDialogProps) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs" />
    {open && <Content {...props} onClose={() => onOpenChange(false)} />}
  </Dialog.Portal></Dialog.Root>
}
