import { describe, expect, it } from 'vitest'
import type { ILink, ITask } from '@svar-ui/react-gantt'
import { parseCsv } from '@/lib/csv'
import { importGanttCsv, serializeGanttCsv } from '@/lib/gantt-csv'
import { defaultCalendarConfig } from '@/lib/scheduler'
import type { GanttResource, TaskWithResources } from '@/types/gantt'
import type { CsvTaskMapping } from '@/types/gantt-csv'

const headers = ['id', 'text', 'start', 'end', 'duration', 'type', 'progress', 'parent', 'resourceNames', 'predecessors', 'predecessorTypes']
const mapping: CsvTaskMapping = {
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
const resources: GanttResource[] = [{ id: 1, label: 'Alex' }]

function csvData(rows: string[][]) {
  return { fileName: 'schedule.csv', headers, rows }
}

function task(id: number, text: string, start: Date, duration: number, resourceIds: number[] = [], parent?: number): ITask {
  return {
    id,
    text,
    start,
    duration,
    type: 'task',
    progress: 0,
    resources: resourceIds,
    ...(parent === undefined ? {} : { parent }),
  } as TaskWithResources
}

describe('serializeGanttCsv', () => {
  it('preserves hierarchy, resource names, dependencies, and escaped values for consumers', () => {
    const tasks = [
      task(1, 'Design, "A"', new Date(2026, 8, 7), 2, [1, 99]),
      task(2, 'Build', new Date(2026, 8, 9), 1, [1], 1),
    ]
    const links: ILink[] = [{ id: 7, source: 1, target: 2, type: 'e2s' }]
    const parsed = parseCsv(serializeGanttCsv(tasks, links, resources))
    const first = parsed.find((row) => row[0] === '1')
    const second = parsed.find((row) => row[0] === '2')

    expect(parsed[0]).toEqual(headers)
    expect(first?.[1]).toBe('Design, "A"')
    expect(first?.[8]).toBe('Alex;99')
    expect(second?.[7]).toBe('1')
    expect(second?.[9]).toBe('1')
    expect(second?.[10]).toBe('e2s')
  })
})

describe('importGanttCsv', () => {
  it('creates mapped tasks, links, and named resources with dates and durations', () => {
    const result = importGanttCsv(csvData([
      ['10', 'Design', '2026-09-07', '2026-09-09', '2', 'summary', '0', '', 'Alex', '', ''],
      ['11', 'Build', '2026-09-09', '2026-09-11', '2', 'task', '25', '10', 'Alex;Taylor', '10', 'e2s'],
    ]), mapping, defaultCalendarConfig, 'day', false, resources)

    expect(result.kind).toBe('success')
    if (result.kind !== 'success') return
    expect(result.tasks).toHaveLength(2)
    expect(result.tasks[1]).toMatchObject({ id: 11, text: 'Build', duration: 2, progress: 25, parent: 10 })
    expect(result.tasks[1].start?.toISOString().slice(0, 10)).toBe('2026-09-09')
    expect(result.tasks[1].end?.toISOString().slice(0, 10)).toBe('2026-09-11')
    expect((result.tasks[1] as TaskWithResources).resources).toEqual([1, 2])
    expect(result.links).toEqual([{ id: 1, source: 10, target: 11, type: 'e2s' }])
    expect(result.resources.map((resource) => resource.label)).toEqual(['Alex', 'Taylor'])
  })

  it('normalizes duplicate or invalid IDs and rejects parent cycles', () => {
    const result = importGanttCsv(csvData([
      ['1', 'First', '2026-09-07', '', '1', 'task', '0', '2', '', '', ''],
      ['1', 'Duplicate', '2026-09-08', '', '1', 'task', '0', '1', '', '', ''],
      ['0', 'Invalid', '2026-09-09', '', '1', 'task', '0', '', '', '', ''],
    ]), mapping, defaultCalendarConfig, 'day', false, [])

    expect(result.kind).toBe('success')
    if (result.kind !== 'success') return
    expect(result.tasks.map((task) => task.id)).toEqual([1, 2, '0'])
    expect(result.tasks[0].parent).toBe(2)
    expect(result.tasks[1].parent).toBeUndefined()
    expect(result.tasks[2].parent).toBeUndefined()
  })

  it('resolves numeric resource IDs, creates names once, and supports auto-scheduling', () => {
    const result = importGanttCsv(csvData([
      ['20', 'Source', '2026-09-07', '', '2', 'task', '0', '', '1;Taylor;Taylor', '', ''],
      ['21', 'Target', '2026-09-01', '', '1', 'task', '0', '', 'Taylor', '20', 'e2s'],
    ]), mapping, defaultCalendarConfig, 'day', true, resources)

    expect(result.kind).toBe('success')
    if (result.kind !== 'success') return
    expect(result.resources).toEqual([{ id: 1, label: 'Alex' }, { id: 2, label: 'Taylor' }])
    expect((result.tasks[0] as TaskWithResources).resources).toEqual([1, 2])
    expect(result.links[0]).toMatchObject({ source: 20, target: 21, type: 'e2s' })
    expect(result.tasks[1].start).toEqual(result.tasks[0].end)
  })

  it('returns no-importable-rows when mapped task names are blank', () => {
    expect(importGanttCsv(csvData([['1', ' ', '', '', '', '', '', '', '', '', '']]), mapping, defaultCalendarConfig, 'day', false, [])).toEqual({ kind: 'no-importable-rows' })
  })
  it('uses safe defaults for invalid fields and filters invalid or duplicate predecessors', () => {
    const result = importGanttCsv(csvData([
      ['', 'No ID', 'not-a-date', 'also-invalid', 'bad', 'task', '150', '', '', '', ''],
      ['30', 'Milestone', '2026-09-07', '', '99', 'milestone', '-5', '', '', '30;999', 'ss;ff'],
      ['31', 'Target', '2026-09-08', '', 'bad', 'task', '101', '', '', '30;30;999', 'ff;sf;e2s'],
    ]), mapping, defaultCalendarConfig, 'day', false, [])

    expect(result.kind).toBe('success')
    if (result.kind !== 'success') return
    expect(result.tasks.map((task) => task.id)).toEqual([1, 30, 31])
    expect(result.tasks[0].progress).toBe(100)
    expect(result.tasks[0].duration).toBe(1)
    expect(result.tasks[0].start).toBeInstanceOf(Date)
    expect(result.tasks[1]).toMatchObject({ type: 'milestone', duration: 0, progress: 0 })
    expect(result.tasks[1].end).toEqual(result.tasks[1].start)
    expect(result.tasks[2].duration).toBe(1)
    expect(result.links).toEqual([{ id: 1, source: 30, target: 31, type: 'e2e' }])
  })
})
