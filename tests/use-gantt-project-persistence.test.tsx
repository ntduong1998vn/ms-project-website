import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as storage from '@/lib/storage/idb'
import { idbClear, idbGet, idbSet } from '@/lib/storage/idb'
import type { PersistedProject, PersistedSettings } from '@/lib/storage/persistence'
import { useGanttProject } from '@/hooks/use-gantt-project'
import { defaultCalendarConfig } from '@/lib/scheduler'

const seeded: PersistedProject = {
  v: 1,
  tasks: [
    {
      id: 7,
      text: 'Persisted Task',
      start: new Date(2026, 2, 2),
      end: new Date(2026, 2, 6),
      duration: 4,
      type: 'task',
      progress: 0,
    },
  ],
  links: [],
  resourceList: [{ id: 3, label: 'Bob' }],
}

beforeEach(async () => {
  await idbClear()
})

afterEach(() => vi.restoreAllMocks())

describe('useGanttProject persistence', () => {
  it.each(['project', 'settings'] as const)('does not overwrite %s after its startup read fails', async (slot) => {
    const settings: PersistedSettings = {
      v: 1,
      calendarConfig: defaultCalendarConfig,
      isAutoSchedule: false,
      durationUnit: 'hour',
      zoom: 'week',
      viewMode: 'gantt',
      isWorkColumnVisible: true,
      isGanttVisible: false,
    }
    await idbSet('project', seeded)
    await idbSet('settings', settings)
    const get = IDBObjectStore.prototype.get
    const read = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (key) {
      if (key === slot) throw new DOMException('Read denied', 'SecurityError')
      return get.call(this, key)
    })
    const writes = vi.spyOn(storage, 'idbSet')
    const { result } = renderHook(() => useGanttProject())
    const healthySlot = slot === 'project' ? 'settings' : 'project'
    await waitFor(() => expect(writes).toHaveBeenCalledWith(healthySlot, expect.anything()))
    read.mockRestore()
    writes.mockClear()
    act(() => {
      result.current.state.setTasks([{ ...seeded.tasks[0], text: 'Edited' }])
      result.current.state.setZoom('month')
    })
    await waitFor(() => expect(writes).toHaveBeenCalledWith(healthySlot, expect.anything()))
    expect(writes.mock.calls.some(([key]) => key === slot)).toBe(false)
    await expect(idbGet(slot)).resolves.toEqual(slot === 'project' ? seeded : settings)
  })

  it('persists settings changed after an empty startup and restores them on remount', async () => {
    const first = renderHook(() => useGanttProject())
    await waitFor(async () => expect(await idbGet('settings')).toBeDefined())
    act(() => first.result.current.state.setZoom('month'))
    await waitFor(async () => expect((await idbGet<PersistedSettings>('settings'))?.zoom).toBe('month'))
    first.unmount()
    const second = renderHook(() => useGanttProject())
    await waitFor(() => expect(second.result.current.state.zoom).toBe('month'))
  })

  it('hydrates state from IndexedDB on mount', async () => {
    await idbSet('project', seeded)
    const { result } = renderHook(() => useGanttProject())
    await waitFor(() => {
      expect(result.current.state.tasks.map((t) => t.text)).toContain('Persisted Task')
    })
    expect(result.current.state.tasks[0].start).toBeInstanceOf(Date)
    expect(result.current.state.resourceList).toEqual([{ id: 3, label: 'Bob' }])
  })

  it('persists project changes to IndexedDB after the debounce', async () => {
    const { result } = renderHook(() => useGanttProject())
    // Wait for hydration to complete (gate flips even with empty store).
    await waitFor(() => expect(result.current.state.tasks).toEqual([]))

    await act(async () => {
      result.current.state.setTasks(seeded.tasks)
    })

    await waitFor(async () => {
      const stored = await idbGet<PersistedProject>('project')
      expect(stored?.tasks.map((t) => t.text)).toContain('Persisted Task')
    })
  })
})
