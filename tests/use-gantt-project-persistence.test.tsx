import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { idbClear, idbGet, idbSet } from '@/lib/storage/idb'
import type { PersistedProject } from '@/lib/storage/persistence'
import { useGanttProject } from '@/hooks/use-gantt-project'

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

describe('useGanttProject persistence', () => {
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
