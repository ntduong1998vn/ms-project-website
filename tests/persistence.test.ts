import { beforeEach, describe, expect, it } from 'vitest'
import { idbClear, idbSet } from '@/lib/storage/idb'
import { loadPersistedState, persistProject, persistSettings } from '@/lib/storage/persistence'
import { defaultCalendarConfig } from '@/lib/scheduler'
import type { ITask } from '@svar-ui/react-gantt'

const tasks: ITask[] = [
  {
    id: 1,
    text: 'Design',
    start: new Date(2026, 0, 5),
    end: new Date(2026, 0, 9),
    duration: 4,
    type: 'task',
    progress: 25,
  },
  {
    id: 2,
    text: 'Build',
    start: new Date(2026, 0, 12),
    end: new Date(2026, 0, 16),
    duration: 4,
    type: 'task',
    progress: 0,
  },
]

const settings = {
  calendarConfig: defaultCalendarConfig,
  isAutoSchedule: false,
  durationUnit: 'hour' as const,
  zoom: 'week' as const,
  viewMode: 'gantt' as const,
  isWorkColumnVisible: true,
  visibleRemoteColumns: ['status'],
  showCriticalPath: true,
  isGanttVisible: false,
}

beforeEach(async () => {
  await idbClear()
})

describe('persistProject / loadPersistedState', () => {
  it('round-trips tasks, links and resources', async () => {
    persistProject({
      tasks,
      links: [{ id: 1, source: 1, target: 2, type: 'e2s' }],
      resourceList: [{ id: 1, label: 'Alice' }],
    })
    const { project } = await loadPersistedState()
    expect(project?.v).toBe(1)
    expect(project?.tasks.map((t) => t.text)).toEqual(['Design', 'Build'])
    expect(project?.links).toEqual([{ id: 1, source: 1, target: 2, type: 'e2s' }])
    expect(project?.resourceList).toEqual([{ id: 1, label: 'Alice' }])
  })

  it('preserves Date instances through structured clone', async () => {
    persistProject({ tasks, links: [], resourceList: [] })
    const { project } = await loadPersistedState()
    const first = project?.tasks[0]
    expect(first?.start).toBeInstanceOf(Date)
    expect(first?.end).toBeInstanceOf(Date)
    expect((first!.start as Date).getTime()).toBe((tasks[0].start as Date).getTime())
  })

  it('returns undefined for both records when nothing is stored', async () => {
    await expect(loadPersistedState()).resolves.toEqual({
      project: undefined,
      settings: undefined,
    })
  })

  it('drops a corrupt project record without affecting settings', async () => {
    await idbSet('project', { v: 2, tasks: 'not-an-array' })
    persistSettings(settings)
    const { project, settings: loaded } = await loadPersistedState()
    expect(project).toBeUndefined()
    expect(loaded?.zoom).toBe('week')
  })

  it('drops a corrupt settings record without affecting project', async () => {
    persistProject({ tasks, links: [], resourceList: [] })
    await idbSet('settings', { v: 1, calendarConfig: null })
    const { project, settings: loaded } = await loadPersistedState()
    expect(loaded).toBeUndefined()
    expect(project?.tasks).toHaveLength(2)
  })
})

describe('persistSettings', () => {
  it('round-trips settings', async () => {
    persistSettings(settings)
    const { settings: loaded } = await loadPersistedState()
    expect(loaded).toEqual({ v: 1, ...settings })
  })
})
