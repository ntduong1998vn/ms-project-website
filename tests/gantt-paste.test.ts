import { describe, expect, it } from 'vitest'
import type { ILink, ITask } from '@svar-ui/react-gantt'
import { applyGanttPaste } from '@/lib/gantt-paste'
import { defaultCalendarConfig } from '@/lib/scheduler'
import type { GanttResource, TaskWithResources } from '@/types/gantt'
import type { CsvImportData, CsvTaskMapping } from '@/types/gantt-csv'

const headers = ['id', 'text', 'start', 'end', 'duration', 'type', 'progress', 'parent', 'resourceNames', 'predecessors', 'predecessorTypes']
const fullMapping: CsvTaskMapping = {
  id: 0,
  text: 1,
  start: 2,
  end: 3,
  duration: 4,
  type: 5,
  progress: 6,
  parent: 7,
  resources: 8,
  predecessors: 9,
  predecessorTypes: 10,
}

function pasteData(rows: string[][]): CsvImportData {
  return { fileName: 'clipboard', headers, rows }
}

function existingTask(id: number, text: string, overrides: Partial<ITask> = {}): ITask {
  return {
    id,
    text,
    start: new Date(2026, 8, 7),
    end: new Date(2026, 8, 9),
    duration: 2,
    type: 'task',
    progress: 10,
    ...overrides,
  } as TaskWithResources
}

const noExisting = { tasks: [] as ITask[], links: [] as ILink[], resources: [] as GanttResource[] }

describe('applyGanttPaste', () => {
  it('inserts all rows when no id column is mapped', () => {
    const mapping: CsvTaskMapping = { ...fullMapping, id: null }
    const existing = { ...noExisting, tasks: [existingTask(1, 'Existing')] }
    const result = applyGanttPaste(
      pasteData([
        ['', 'Pasted A', '2026-09-07', '', '3', 'task', '40', '', '', '', ''],
        ['', 'Pasted B', '2026-09-10', '', '1', 'task', '0', '', '', '', ''],
      ]),
      mapping,
      existing,
      defaultCalendarConfig,
      'day',
      false
    )

    expect(result.kind).toBe('success')
    if (result.kind !== 'success') return
    expect(result.inserted).toBe(2)
    expect(result.updated).toBe(0)
    expect(result.tasks).toHaveLength(3)
    expect(result.tasks[0]).toMatchObject({ id: 1, text: 'Existing' })
    expect(result.tasks[1]).toMatchObject({ id: 2, text: 'Pasted A', duration: 3, progress: 40 })
    expect(result.tasks[2]).toMatchObject({ id: 3, text: 'Pasted B' })
  })

  it('updates only mapped fields and preserves the rest', () => {
    const existing = {
      ...noExisting,
      tasks: [existingTask(5, 'Old name', { progress: 55, duration: 4 })],
    }
    const result = applyGanttPaste(
      pasteData([['5', 'New name', '', '', '', '', '', '', '', '', '']]),
      fullMapping,
      existing,
      defaultCalendarConfig,
      'day',
      false
    )

    expect(result.kind).toBe('success')
    if (result.kind !== 'success') return
    expect(result.inserted).toBe(0)
    expect(result.updated).toBe(1)
    const task = result.tasks[0]
    expect(task.text).toBe('New name')
    expect(task.duration).toBe(4)
    expect(task.progress).toBe(55)
    expect(task.start).toEqual(new Date(2026, 8, 7))
  })

  it('mixes updates and inserts in one paste', () => {
    const existing = { ...noExisting, tasks: [existingTask(1, 'Keep'), existingTask(2, 'Rename me')] }
    const result = applyGanttPaste(
      pasteData([
        ['2', 'Renamed', '', '', '', '', '', '', '', '', ''],
        ['9', 'Brand new', '2026-09-07', '', '2', 'task', '0', '', '', '', ''],
      ]),
      fullMapping,
      existing,
      defaultCalendarConfig,
      'day',
      false
    )

    expect(result.kind).toBe('success')
    if (result.kind !== 'success') return
    expect(result.updated).toBe(1)
    expect(result.inserted).toBe(1)
    expect(result.tasks.map((task) => task.id)).toEqual([1, 2, 9])
    expect(result.tasks[1].text).toBe('Renamed')
    expect(result.tasks[2].text).toBe('Brand new')
  })

  it('replaces all incoming links on update and continues link ids', () => {
    const existing = {
      tasks: [existingTask(1, 'A'), existingTask(2, 'B'), existingTask(3, 'C')],
      links: [
        { id: 4, source: 1, target: 3, type: 'e2s' },
        { id: 9, source: 2, target: 3, type: 'e2e' },
      ] as ILink[],
      resources: [] as GanttResource[],
    }
    const result = applyGanttPaste(
      pasteData([['3', 'C', '', '', '', '', '', '', '', '2', 'ss']]),
      fullMapping,
      existing,
      defaultCalendarConfig,
      'day',
      false
    )

    expect(result.kind).toBe('success')
    if (result.kind !== 'success') return
    expect(result.links).toEqual([{ id: 10, source: 2, target: 3, type: 's2s' }])
  })

  it('resolves parents against pasted ids and existing task ids', () => {
    const existing = { ...noExisting, tasks: [existingTask(1, 'Phase', { type: 'summary' })] }
    const result = applyGanttPaste(
      pasteData([
        ['', 'New parent', '2026-09-07', '', '5', 'summary', '0', '', '', '', ''],
        ['', 'Child of pasted', '2026-09-07', '', '1', 'task', '0', '2', '', '', ''],
        ['', 'Child of existing', '2026-09-07', '', '1', 'task', '0', '1', '', '', ''],
      ]),
      fullMapping,
      existing,
      defaultCalendarConfig,
      'day',
      false
    )

    expect(result.kind).toBe('success')
    if (result.kind !== 'success') return
    const [parent, pastedChild, existingChild] = result.tasks.slice(1)
    expect(parent.type).toBe('summary')
    expect(parent.open).toBe(true)
    expect(pastedChild.parent).toBe(parent.id)
    expect(existingChild.parent).toBe(1)
  })

  it('creates resources for unknown labels and reuses known ones', () => {
    const existing = { ...noExisting, resources: [{ id: 1, label: 'Alex' }] as GanttResource[] }
    const result = applyGanttPaste(
      pasteData([['', 'Task', '2026-09-07', '', '1', 'task', '0', '', 'Alex;Taylor;1', '', '']]),
      fullMapping,
      existing,
      defaultCalendarConfig,
      'day',
      false
    )

    expect(result.kind).toBe('success')
    if (result.kind !== 'success') return
    expect(result.resources).toEqual([
      { id: 1, label: 'Alex' },
      { id: 2, label: 'Taylor' },
    ])
    expect((result.tasks[0] as TaskWithResources).resources).toEqual([1, 2])
  })

  it('clears parent and incoming links when mapped cells are empty on update', () => {
    const existing = {
      tasks: [existingTask(1, 'Parent', { type: 'summary' }), existingTask(2, 'Child', { parent: 1 })],
      links: [{ id: 1, source: 1, target: 2, type: 'e2s' }] as ILink[],
      resources: [] as GanttResource[],
    }
    const result = applyGanttPaste(
      pasteData([['2', 'Child', '', '', '', '', '', '', '', '', '']]),
      fullMapping,
      existing,
      defaultCalendarConfig,
      'day',
      false
    )

    expect(result.kind).toBe('success')
    if (result.kind !== 'success') return
    expect(result.tasks[1].parent).toBeUndefined()
    expect(result.links).toEqual([])
  })

  it('returns no-importable-rows when mapped text is blank in every row', () => {
    expect(
      applyGanttPaste(pasteData([['1', ' ', '', '', '', '', '', '', '', '', '']]), fullMapping, noExisting, defaultCalendarConfig, 'day', false)
    ).toEqual({ kind: 'no-importable-rows' })
  })

  it('auto-schedules the merged task list when enabled', () => {
    const existing = { ...noExisting, tasks: [existingTask(1, 'Predecessor')] }
    const rows = [['', 'Successor', '2026-09-01', '', '1', 'task', '0', '', '', '1', 'e2s']]
    const scheduled = applyGanttPaste(pasteData(rows), fullMapping, existing, defaultCalendarConfig, 'day', true)
    const manual = applyGanttPaste(pasteData(rows), fullMapping, existing, defaultCalendarConfig, 'day', false)

    expect(scheduled.kind).toBe('success')
    expect(manual.kind).toBe('success')
    if (scheduled.kind !== 'success' || manual.kind !== 'success') return
    expect(scheduled.links).toHaveLength(1)
    const successor = scheduled.tasks[1]
    expect(successor.start).toEqual(scheduled.tasks[0].end)
    expect(manual.tasks[1].start).toEqual(new Date('2026-09-01'))
  })
})
