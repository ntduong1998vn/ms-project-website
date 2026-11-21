import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('unavailable IndexedDB', () => {
  it('keeps reads and writes usable when the API is absent', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const { idbGet, idbSet } = await import('@/lib/storage/idb')
    await expect(idbGet('project')).rejects.toThrow('IndexedDB is unavailable')
    await expect(idbSet('project', {})).resolves.toBeUndefined()
  })

  it('recovers after opening throws a security error', async () => {
    const open = vi.spyOn(indexedDB, 'open').mockImplementationOnce(() => {
      throw new DOMException('Denied', 'SecurityError')
    })
    const { idbGet, idbSet } = await import('@/lib/storage/idb')
    await expect(idbGet('project')).rejects.toThrow('IndexedDB is unavailable')
    await idbSet('recovered', 42)
    await expect(idbGet('recovered')).resolves.toBe(42)
    expect(open).toHaveBeenCalledTimes(2)
  })

  it('logs write errors without rejecting or blocking later changes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { persistProject } = await import('@/lib/storage/persistence')
    persistProject({ tasks: [{ id: 1, text: 'bad', custom: () => {} }], links: [], resourceList: [] })
    await vi.waitFor(() => expect(warn).toHaveBeenCalled())
    const { idbSet, idbGet } = await import('@/lib/storage/idb')
    await idbSet('after-error', 'ok')
    await expect(idbGet('after-error')).resolves.toBe('ok')
  })
})
