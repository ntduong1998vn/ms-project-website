import { useState } from 'react'
import { Dialog } from 'radix-ui'
import {
  ArrowLeftRight,
  FolderSync,
  Link2,
  ListChecks,
  Loader2,
  Plug,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { syncTaskFields } from '@/lib/integrations/fields'
import { redmineStandardFields } from '@/lib/integrations/redmine/fields'
import type {
  IntegrationSettings,
  RemoteProjectMetadata,
  SyncTaskField,
} from '@/lib/integrations/types'

interface IntegrationSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: IntegrationSettings
  onSave: (s: IntegrationSettings) => void
  onTestConnection: (draft: IntegrationSettings) => Promise<string>
  onFetchMetadata: (draft: IntegrationSettings) => Promise<RemoteProjectMetadata>
}

type TestState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'ok'; name: string }
  | { kind: 'error'; message: string }

const inputClass =
  'w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring'

function cloneSettings(s: IntegrationSettings): IntegrationSettings {
  return {
    ...s,
    mapping: {
      fields: { ...s.mapping.fields },
      extraFields: [...s.mapping.extraFields],
    },
    knownFields: [...s.knownFields],
    knownTrackers: [...s.knownTrackers],
    knownStatuses: [...s.knownStatuses],
    knownPriorities: [...s.knownPriorities],
    knownMembers: [...s.knownMembers],
  }
}

function ChipList({ items }: { items: Array<{ id: number; name: string }> }) {
  if (items.length === 0) {
    return <span className="text-xs text-muted-foreground">None fetched</span>
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item.id}
          className="rounded-full border border-border bg-background px-2 py-0.5 text-xs text-foreground"
        >
          {item.name} ({item.id})
        </span>
      ))}
    </div>
  )
}

function IntegrationSettingsContent({
  settings,
  onSave,
  onTestConnection,
  onFetchMetadata,
  onClose,
}: {
  settings: IntegrationSettings
  onSave: (s: IntegrationSettings) => void
  onTestConnection: (draft: IntegrationSettings) => Promise<string>
  onFetchMetadata: (draft: IntegrationSettings) => Promise<RemoteProjectMetadata>
  onClose: () => void
}) {
  const [draft, setDraft] = useState<IntegrationSettings>(() => cloneSettings(settings))
  const [testState, setTestState] = useState<TestState>({ kind: 'idle' })
  const [metaBusy, setMetaBusy] = useState(false)
  const [metaError, setMetaError] = useState('')

  const fieldOptions = draft.knownFields.length ? draft.knownFields : redmineStandardFields
  const customFields = fieldOptions.filter((f) => f.kind === 'custom')
  const hasMetadata =
    draft.knownFields.length > 0 ||
    draft.knownTrackers.length > 0 ||
    draft.knownStatuses.length > 0 ||
    draft.knownPriorities.length > 0 ||
    draft.knownMembers.length > 0

  const setFieldMapping = (taskField: SyncTaskField, remoteKey: string | null) => {
    setDraft((d) => ({
      ...d,
      mapping: {
        ...d.mapping,
        fields: { ...d.mapping.fields, [taskField]: remoteKey },
      },
    }))
  }

  const toggleExtraField = (key: string) => {
    setDraft((d) => {
      const has = d.mapping.extraFields.includes(key)
      return {
        ...d,
        mapping: {
          ...d.mapping,
          extraFields: has
            ? d.mapping.extraFields.filter((k) => k !== key)
            : [...d.mapping.extraFields, key],
        },
      }
    })
  }

  const handleTestConnection = async () => {
    setTestState({ kind: 'busy' })
    try {
      const name = await onTestConnection(draft)
      setTestState({ kind: 'ok', name })
    } catch (err) {
      setTestState({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const handleFetchMetadata = async () => {
    setMetaBusy(true)
    setMetaError('')
    try {
      const meta = await onFetchMetadata(draft)
      setDraft((d) => ({
        ...d,
        knownFields: meta.fields,
        knownTrackers: meta.trackers,
        knownStatuses: meta.statuses,
        knownPriorities: meta.priorities,
        knownMembers: meta.members,
      }))
    } catch (err) {
      setMetaError(err instanceof Error ? err.message : String(err))
    } finally {
      setMetaBusy(false)
    }
  }

  const handleSave = () => {
    onSave(draft)
    onClose()
  }

  return (
    <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-full max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-6 shadow-2xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] max-h-[90vh] overflow-y-auto">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Plug className="h-4 w-4" />
          </div>
          <div>
            <Dialog.Title className="text-base font-semibold text-foreground">
              Redmine Integration Settings
            </Dialog.Title>
            <Dialog.Description className="text-xs text-muted-foreground">
              Configure the connection, review project metadata, and map fields
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

      <div className="mt-4 space-y-5">
        {/* Section 1: Connection */}
        <div className="rounded-lg border border-border bg-muted/20 p-3.5">
          <label className="flex items-center gap-2 text-sm font-medium text-foreground mb-3">
            <Link2 className="h-4 w-4 text-blue-500" />
            <span>Connection</span>
          </label>
          <div className="space-y-3">
            <div>
              <label
                htmlFor="redmineBaseUrl"
                className="mb-1 block text-xs font-medium text-muted-foreground"
              >
                Base URL
              </label>
              <input
                id="redmineBaseUrl"
                type="text"
                placeholder="https://redmine.example.com"
                value={draft.baseUrl}
                onChange={(e) => setDraft((d) => ({ ...d, baseUrl: e.target.value }))}
                className={inputClass}
              />
            </div>
            <div>
              <label
                htmlFor="redmineApiKey"
                className="mb-1 block text-xs font-medium text-muted-foreground"
              >
                API Key
              </label>
              <input
                id="redmineApiKey"
                type="password"
                value={draft.apiKey}
                onChange={(e) => setDraft((d) => ({ ...d, apiKey: e.target.value }))}
                className={inputClass}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Stored in localStorage as plaintext
              </p>
            </div>
            <div>
              <label
                htmlFor="redmineProjectId"
                className="mb-1 block text-xs font-medium text-muted-foreground"
              >
                Project Identifier
              </label>
              <input
                id="redmineProjectId"
                type="text"
                placeholder="my-project (empty = all visible issues)"
                value={draft.projectIdentifier}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, projectIdentifier: e.target.value }))
                }
                className={inputClass}
              />
            </div>
            <div>
              <label className="flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.useDevProxy}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, useDevProxy: e.target.checked }))
                  }
                  className="h-4 w-4 accent-primary"
                />
                <span>Use dev proxy</span>
              </label>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Dev only — routes via Vite middleware to bypass CORS; target
                validated server-side
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={handleTestConnection}
                disabled={testState.kind === 'busy'}
                className="gap-1.5 cursor-pointer"
              >
                {testState.kind === 'busy' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Link2 className="h-3.5 w-3.5" />
                )}
                <span>Test Connection</span>
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={handleFetchMetadata}
                disabled={metaBusy}
                className="gap-1.5 cursor-pointer"
              >
                {metaBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FolderSync className="h-3.5 w-3.5" />
                )}
                <span>Fetch project info</span>
              </Button>
            </div>
            {testState.kind === 'ok' && (
              <p className="text-xs font-medium text-emerald-600">
                Connected as {testState.name}
              </p>
            )}
            {testState.kind === 'error' && (
              <p className="text-xs font-medium text-destructive">
                {testState.message}
              </p>
            )}
            {metaError && (
              <p className="text-xs font-medium text-destructive">{metaError}</p>
            )}
          </div>
        </div>

        {/* Section 2: Project metadata review */}
        <div className="rounded-lg border border-border bg-muted/20 p-3.5">
          <label className="flex items-center gap-2 text-sm font-medium text-foreground mb-2">
            <ListChecks className="h-4 w-4 text-emerald-500" />
            <span>Project Metadata</span>
          </label>
          {!hasMetadata ? (
            <p className="text-xs text-muted-foreground">
              No metadata loaded — use Fetch project info
            </p>
          ) : (
            <div className="space-y-3">
              <div>
                <label
                  htmlFor="redmineTracker"
                  className="mb-1 block text-xs font-medium text-muted-foreground"
                >
                  Tracker (used when creating issues)
                </label>
                <select
                  id="redmineTracker"
                  value={draft.trackerId === null ? '' : String(draft.trackerId)}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      trackerId: e.target.value === '' ? null : Number(e.target.value),
                    }))
                  }
                  className={inputClass}
                >
                  <option value="">Server default</option>
                  {draft.knownTrackers.map((t) => (
                    <option key={t.id} value={String(t.id)}>
                      {t.name} ({t.id})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <span className="mb-1 block text-xs font-medium text-muted-foreground">
                  Statuses
                </span>
                <ChipList items={draft.knownStatuses} />
              </div>
              <div>
                <span className="mb-1 block text-xs font-medium text-muted-foreground">
                  Priorities
                </span>
                <ChipList items={draft.knownPriorities} />
              </div>
              <div>
                <span className="mb-1 block text-xs font-medium text-muted-foreground">
                  Members
                </span>
                <ChipList items={draft.knownMembers} />
              </div>
            </div>
          )}
        </div>

        {/* Section 3: Field mapping */}
        <div className="rounded-lg border border-border bg-muted/20 p-3.5">
          <label className="flex items-center gap-2 text-sm font-medium text-foreground mb-2">
            <ArrowLeftRight className="h-4 w-4 text-violet-500" />
            <span>Field Mapping</span>
          </label>
          <p className="text-xs text-muted-foreground mb-3">
            Choose which remote field each task field syncs with:
          </p>
          <div className="space-y-2">
            {syncTaskFields.map((f) => {
              const current = draft.mapping.fields[f.key]
              const missing =
                current !== null && !fieldOptions.some((o) => o.key === current)
              return (
                <div key={f.key} className="flex items-center gap-3">
                  <span className="w-40 shrink-0 text-xs font-medium text-foreground">
                    {f.label}
                    {f.required && <span className="text-destructive"> *</span>}
                  </span>
                  <select
                    value={current ?? ''}
                    onChange={(e) =>
                      setFieldMapping(f.key, e.target.value === '' ? null : e.target.value)
                    }
                    className={inputClass}
                  >
                    <option value="">Do not sync</option>
                    {missing && (
                      <option value={current}>{current} (not on server)</option>
                    )}
                    {fieldOptions.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              )
            })}
          </div>
          <div className="mt-4">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">
              Additional fields to import
            </span>
            {customFields.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No custom fields known — fetch project info to discover them
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
                {customFields.map((f) => (
                  <label
                    key={f.key}
                    className="flex items-center gap-2 text-xs text-foreground cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={draft.mapping.extraFields.includes(f.key)}
                      onChange={() => toggleExtraField(f.key)}
                      className="h-3.5 w-3.5 accent-primary"
                    />
                    <span>{f.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Dialog Footer Actions */}
      <div className="mt-6 flex items-center justify-end gap-2 border-t border-border pt-4">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="cursor-pointer"
        >
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={handleSave} className="cursor-pointer">
          Save Settings
        </Button>
      </div>
    </Dialog.Content>
  )
}

export function IntegrationSettingsDialog({
  open,
  onOpenChange,
  settings,
  onSave,
  onTestConnection,
  onFetchMetadata,
}: IntegrationSettingsDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        {open && (
          <IntegrationSettingsContent
            settings={settings}
            onSave={onSave}
            onTestConnection={onTestConnection}
            onFetchMetadata={onFetchMetadata}
            onClose={() => onOpenChange(false)}
          />
        )}
      </Dialog.Portal>
    </Dialog.Root>
  )
}
