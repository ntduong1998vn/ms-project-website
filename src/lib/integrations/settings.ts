import { defaultFieldMapping } from './fields'
import { redmineStandardFields } from './redmine/fields'
import type { IntegrationSettings, RemoteFieldDescriptor, RemoteProjectMetadata } from './types'

export const STORAGE_KEY = 'ms-project-web:integration:redmine'

export function defaultIntegrationSettings(): IntegrationSettings {
  return {
    provider: 'redmine',
    fieldOverrides: {},
    manualFields: [],
    baseUrl: '',
    apiKey: '',
    projectIdentifier: '',
    useDevProxy: false,
    trackerId: null,
    mapping: defaultFieldMapping(),
    knownFields: [],
    knownTrackers: [],
    knownStatuses: [],
    knownPriorities: [],
    knownVersions: [],
    knownMembers: [],
  }
}

export function effectiveFields(settings: IntegrationSettings): RemoteFieldDescriptor[] {
  const fields = new Map((settings.knownFields.length ? settings.knownFields : redmineStandardFields).map((f) => [f.key, f]))
  for (const field of settings.manualFields ?? []) fields.set(field.key, field)
  return [...fields.values()].map((field) => {
    const override = settings.fieldOverrides?.[field.key]
    return override ? {
      ...field, ...override,
      options: override.options === undefined ? field.options : override.options.map((value) => ({ id: value, label: value })),
    } : { ...field }
  })
}

export function invalidateIntegrationMetadata(settings: IntegrationSettings, patch: Partial<IntegrationSettings>): IntegrationSettings {
  const changed = (['baseUrl', 'projectIdentifier'] as const).some((key) => patch[key] !== undefined && patch[key] !== settings[key])
  if (!changed) return { ...settings, ...patch }
  return {
    ...settings, ...patch, knownFields: [], knownTrackers: [], knownStatuses: [], knownPriorities: [], knownVersions: [], knownMembers: [],
    manualFields: [], fieldOverrides: {}, trackerId: null,
  }
}

export function applyIntegrationMetadata(settings: IntegrationSettings, meta: RemoteProjectMetadata): IntegrationSettings {
  const keys = new Set([...meta.fields, ...settings.manualFields].map((f) => f.key))
  const keep = (key: string) => !key.startsWith('cf_') || keys.has(key)
  return {
    ...settings, knownFields: meta.fields, knownTrackers: meta.trackers, knownStatuses: meta.statuses,
    knownPriorities: meta.priorities, knownVersions: meta.versions, knownMembers: meta.members,
    mapping: {
      fields: Object.fromEntries(Object.entries(settings.mapping.fields).map(([key, value]) => [key, value && keep(value) ? value : null])) as IntegrationSettings['mapping']['fields'],
      extraFields: settings.mapping.extraFields.filter(keep),
    },
  }
}

export function loadIntegrationSettings(): IntegrationSettings {
  const defaults = defaultIntegrationSettings()
  if (typeof localStorage === 'undefined') return defaults
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaults
    const parsed = JSON.parse(raw) as Partial<IntegrationSettings>
    return {
      ...defaults,
      ...parsed,
      mapping: {
        ...defaults.mapping,
        ...parsed.mapping,
        // per-key merge so SyncTaskFields added in later versions still
        // appear (mapped to defaults) on settings saved by older versions
        fields: { ...defaults.mapping.fields, ...parsed.mapping?.fields },
        // 'description' is unified on task.details — never an extraField;
        // prune it from settings persisted before that contract existed.
        extraFields: (parsed.mapping?.extraFields ?? defaults.mapping.extraFields).filter(
          (key) => key !== 'description'
        ),
      },
    }
  } catch {
    return defaults
  }
}

export function saveIntegrationSettings(s: IntegrationSettings): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    // quota/serialization failure — settings simply won't persist
  }
}
