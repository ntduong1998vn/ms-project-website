import { defaultFieldMapping } from './fields'
import type { IntegrationSettings } from './types'

export const STORAGE_KEY = 'ms-project-web:integration:redmine'

export function defaultIntegrationSettings(): IntegrationSettings {
  return {
    provider: 'redmine',
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
    knownMembers: [],
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
