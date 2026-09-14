import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultFieldMapping } from '@/lib/integrations/fields'
import {
  STORAGE_KEY,
  defaultIntegrationSettings,
  loadIntegrationSettings,
  saveIntegrationSettings,
} from '@/lib/integrations/settings'

function stubLocalStorage() {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  })
  return store
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('defaultIntegrationSettings', () => {
  it('produces redmine defaults with the standard field mapping', () => {
    const defaults = defaultIntegrationSettings()
    expect(defaults.provider).toBe('redmine')
    expect(defaults.baseUrl).toBe('')
    expect(defaults.apiKey).toBe('')
    expect(defaults.trackerId).toBeNull()
    expect(defaults.useDevProxy).toBe(false)
    expect(defaults.knownFields).toEqual([])
    expect(defaults.mapping).toEqual(defaultFieldMapping())
  })
})

describe('loadIntegrationSettings', () => {
  it('returns defaults when nothing is stored', () => {
    stubLocalStorage()
    expect(loadIntegrationSettings()).toEqual(defaultIntegrationSettings())
  })

  it('returns defaults when localStorage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(loadIntegrationSettings()).toEqual(defaultIntegrationSettings())
  })

  it('merges saved values over defaults', () => {
    const store = stubLocalStorage()
    store.set(STORAGE_KEY, JSON.stringify({ baseUrl: 'https://r.example.com', apiKey: 'k', trackerId: 4 }))
    const loaded = loadIntegrationSettings()
    expect(loaded.baseUrl).toBe('https://r.example.com')
    expect(loaded.apiKey).toBe('k')
    expect(loaded.trackerId).toBe(4)
    expect(loaded.useDevProxy).toBe(false)
  })

  it('merges mapping.fields per key so old saves gain new field defaults', () => {
    const store = stubLocalStorage()
    // Simulate a save from an older version that predates the 'details' field
    // and remapped 'text' away from the default.
    const oldFields = { ...defaultFieldMapping().fields, text: 'summary' } as Record<string, string | null>
    delete oldFields.details
    store.set(STORAGE_KEY, JSON.stringify({ mapping: { fields: oldFields, extraFields: ['cf_1'] } }))

    const loaded = loadIntegrationSettings()
    expect(loaded.mapping.fields.text).toBe('summary')
    expect(loaded.mapping.fields.details).toBe('description')
    expect(loaded.mapping.fields.start).toBe('start_date')
    expect(loaded.mapping.extraFields).toEqual(['cf_1'])
  })

  it('returns defaults for corrupt JSON', () => {
    const store = stubLocalStorage()
    store.set(STORAGE_KEY, '{not json')
    expect(loadIntegrationSettings()).toEqual(defaultIntegrationSettings())
  })
})

describe('saveIntegrationSettings', () => {
  it('round-trips settings through localStorage', () => {
    stubLocalStorage()
    const saved = { ...defaultIntegrationSettings(), baseUrl: 'https://r.example.com', apiKey: 'k' }
    saveIntegrationSettings(saved)
    expect(loadIntegrationSettings()).toEqual(saved)
  })

  it('does not throw when localStorage is unavailable or writes fail', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(() => saveIntegrationSettings(defaultIntegrationSettings())).not.toThrow()

    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      },
    })
    expect(() => saveIntegrationSettings(defaultIntegrationSettings())).not.toThrow()
  })
})
