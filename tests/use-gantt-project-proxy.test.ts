import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGanttProject } from '@/hooks/use-gantt-project'
import { defaultIntegrationSettings, loadIntegrationSettings, saveIntegrationSettings } from '@/lib/integrations/settings'
import { RedmineCorsError } from '@/lib/integrations/redmine/client'
import type { IntegrationSettings } from '@/lib/integrations/types'

const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0, effects: [] as Array<() => void> }))
const mocks = vi.hoisted(() => ({ createProvider: vi.fn(), error: vi.fn(), info: vi.fn(), success: vi.fn() }))
vi.mock('react', () => ({
  useState: (initial: unknown) => {
    const index = hooks.index++
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial
    return [hooks.values[index], (next: unknown) => { hooks.values[index] = typeof next === 'function' ? next(hooks.values[index]) : next }]
  },
  useRef: (initial: unknown) => {
    const index = hooks.index++
    if (!(index in hooks.values)) hooks.values[index] = { current: initial }
    return hooks.values[index]
  },
  useMemo: (compute: () => unknown) => compute(),
  useCallback: (callback: unknown) => callback,
  useLayoutEffect: (effect: () => void) => hooks.effects.push(effect),
  useEffect: () => {},
}))
vi.mock('react/compiler-runtime', () => ({ c: (size: number) => Array(size).fill(Symbol.for('react.memo_cache_sentinel')) }))
vi.mock('@/lib/integrations', () => ({ createProvider: mocks.createProvider }))
vi.mock('sonner', () => ({ toast: { error: mocks.error, info: mocks.info, success: mocks.success } }))

function RenderProject() {
  return useGanttProject()
}

function renderProject() {
  hooks.index = 0
  hooks.effects = []
  const project = RenderProject()
  for (const effect of hooks.effects) effect()
  return project
}

function newSettings(): IntegrationSettings {
  const defaults = defaultIntegrationSettings()
  return { ...defaults, baseUrl: 'https://new-redmine.test', apiKey: 'new-test-key', projectIdentifier: 'new-project',
    knownFields: [{ key: 'subject', label: 'Subject', kind: 'standard', valueType: 'string' }],
    mapping: { ...defaults.mapping, fields: { ...defaults.mapping.fields, duration: 'cf_42' }, extraFields: ['cf_43'] } }
}

beforeEach(() => {
  hooks.values = []
  vi.clearAllMocks()
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) })
  saveIntegrationSettings({ ...defaultIntegrationSettings(), baseUrl: 'https://old-redmine.test', apiKey: 'old-test-key', projectIdentifier: 'old-project' })
})
afterEach(() => vi.unstubAllGlobals())

describe('Save & Get proxy recovery', () => {
  it.each([false, true])('retains the latest saved connection and mappings and retries with proxy on (saved again: %s)', async (savedAgain) => {
    mocks.createProvider.mockImplementation((settings: IntegrationSettings) => ({ fetchIssues: vi.fn(async () => {
      if (!settings.useDevProxy) throw new RedmineCorsError()
      return []
    }) }))
    const initial = renderProject()
    let saved = newSettings()
    initial.actions.handleSaveAndGetIntegration(saved)
    await vi.waitFor(() => expect(mocks.error).toHaveBeenCalledTimes(1))
    const action = mocks.error.mock.calls[0][1].action
    expect(action.label).toBe('Use proxy')
    expect(loadIntegrationSettings()).toEqual(saved)
    if (savedAgain) {
      saved = { ...saved, projectIdentifier: 'latest-project', mapping: { ...saved.mapping, extraFields: ['cf_99'] } }
      renderProject().actions.handleSaveIntegrationSettings(saved)
    }
    action.onClick()
    await vi.waitFor(() => expect(mocks.createProvider).toHaveBeenCalledTimes(2))
    const expected = { ...saved, useDevProxy: true }
    expect(mocks.createProvider.mock.calls[1][0]).toEqual(expected)
    expect(loadIntegrationSettings()).toEqual(expected)
    expect(renderProject().state.integrationSettings).toEqual(expected)
    expect(mocks.info).toHaveBeenCalledWith('No issues were returned by Redmine.')
  })
  it('keeps direct settings on a successful empty Get', async () => {
    mocks.createProvider.mockReturnValue({ fetchIssues: vi.fn(async () => []) })
    const saved = newSettings()
    renderProject().actions.handleSaveAndGetIntegration(saved)
    await vi.waitFor(() => expect(mocks.info).toHaveBeenCalledWith('No issues were returned by Redmine.'))
    expect(mocks.error).not.toHaveBeenCalled()
    expect(loadIntegrationSettings()).toEqual(saved)
  })
  it('does not offer proxy recovery for an unrelated error', async () => {
    mocks.createProvider.mockReturnValue({ fetchIssues: vi.fn(async () => { throw new Error('Redmine 401') }) })
    const saved = newSettings()
    renderProject().actions.handleSaveAndGetIntegration(saved)
    await vi.waitFor(() => expect(mocks.error).toHaveBeenCalledWith('Redmine 401', undefined))
    expect(loadIntegrationSettings()).toEqual(saved)
  })
})
