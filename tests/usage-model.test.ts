import { describe, expect, it } from 'vitest'
import type { ITask } from '@svar-ui/react-gantt'
import { defaultCalendarConfig } from '@/lib/scheduler'
import { buildUsageModel, markResourceOverallocation } from '@/lib/usage-model'
import type { GanttResource, TaskWithResources } from '@/types/gantt'

const resources: GanttResource[] = [
  { id: 1, label: 'Alex' },
  { id: 2, label: 'Sam' },
]

function task(id: number, start: Date, end: Date, duration: number, assigned: number[] = []): ITask {
  return {
    id,
    text: `Task ${id}`,
    start,
    end,
    duration,
    type: 'task',
    resources: assigned,
  } as TaskWithResources
}

describe('usage allocation model', () => {
  it('splits planned work evenly across assigned resources', () => {
    const model = buildUsageModel({
      mode: 'task',
      tasks: [task(1, new Date(2026, 8, 7), new Date(2026, 8, 9), 2, [1, 2])],
      resources,
      calendar: defaultCalendarConfig,
      durationUnit: 'day',
      timescale: 'day',
      groupBy: 'task',
    })

    expect(model.totalWork).toBe(16)
    expect(model.rows[0].totalWork).toBe(16)
    expect(model.rows[0].children.map((row) => row.totalWork)).toEqual([8, 8])
  })

  it('flags weekly over-allocation when a single contained day exceeds capacity', () => {
    const model = markResourceOverallocation(buildUsageModel({
      mode: 'resource',
      tasks: [
        task(1, new Date(2026, 8, 7), new Date(2026, 8, 8), 1, [1]),
        task(2, new Date(2026, 8, 7), new Date(2026, 8, 8), 1, [1]),
      ],
      resources: [resources[0]],
      calendar: defaultCalendarConfig,
      durationUnit: 'day',
      timescale: 'week',
      groupBy: 'resource',
    }), defaultCalendarConfig)

    expect(model.periods[0].capacityHours).toBe(40)
    expect(model.rows[0].periodWork[model.periods[0].key]).toBe(16)
    expect(model.rows[0].overallocatedPeriods).toContain(model.periods[0].key)
  })
  it('keeps peak-day metadata truthful for a weekly warning', () => {
    const model = markResourceOverallocation(buildUsageModel({
      mode: 'resource',
      tasks: [
        task(1, new Date(2026, 8, 7), new Date(2026, 8, 8), 1, [1]),
        task(2, new Date(2026, 8, 7), new Date(2026, 8, 8), 1, [1]),
      ],
      resources: [resources[0]],
      calendar: defaultCalendarConfig,
      durationUnit: 'day',
      timescale: 'week',
      groupBy: 'resource',
    }), defaultCalendarConfig)
    const period = model.periods[0]
    const peak = model.rows[0].peakDayByPeriod[period.key]

    expect(peak).toEqual({
      date: '2026-09-07',
      dailyWork: 16,
      dailyCapacity: 8,
      resourceLabel: 'Alex',
    })
    expect(period.capacityHours).toBe(40)
  })

  it('builds Resource and Phase group roots with exact rollups', () => {
    const phase = { id: 10, text: 'Design phase', type: 'summary' } as ITask
    const phaseTask = task(1, new Date(2026, 8, 7), new Date(2026, 8, 8), 1)
    phaseTask.parent = phase.id
    const resourceModel = buildUsageModel({
      mode: 'resource',
      tasks: [task(1, new Date(2026, 8, 7), new Date(2026, 8, 8), 1, [1])],
      resources: [{ id: 1, label: 'Alex' }],
      calendar: defaultCalendarConfig,
      durationUnit: 'day',
      timescale: 'day',
      groupBy: 'resource',
    })
    const phaseModel = buildUsageModel({
      mode: 'task',
      tasks: [phase, phaseTask],
      resources,
      calendar: defaultCalendarConfig,
      durationUnit: 'day',
      timescale: 'day',
      groupBy: 'phase',
    })

    expect(resourceModel.rows[0].label).toBe('Alex')
    expect(resourceModel.rows[0].children[0].label).toBe('Task 1')
    expect(resourceModel.rows[0].totalWork).toBe(8)
    expect(phaseModel.rows[0].label).toBe('Design phase')
    expect(phaseModel.rows[0].children[0].children[0].label).toBe('Unassigned')
    expect(phaseModel.totalWork).toBe(8)
  })

  it('does not allocate work on a weekend-only interval and honors holidays', () => {
    const weekend = buildUsageModel({
      mode: 'resource',
      tasks: [task(1, new Date(2026, 8, 5), new Date(2026, 8, 7), 1, [1])],
      resources: [resources[0]],
      calendar: defaultCalendarConfig,
      durationUnit: 'day',
      timescale: 'day',
      groupBy: 'resource',
    })
    const holiday = buildUsageModel({
      mode: 'resource',
      tasks: [task(2, new Date(2026, 8, 1), new Date(2026, 8, 4), 3, [1])],
      resources: [resources[0]],
      calendar: defaultCalendarConfig,
      durationUnit: 'day',
      timescale: 'day',
      groupBy: 'resource',
    })

    expect(weekend.rows[0].periodWork['2026-09-05']).toBe(0)
    expect(holiday.rows[0].periodWork['2026-09-01']).toBe(12)
    expect(holiday.rows[0].periodWork['2026-09-02']).toBe(0)
    expect(holiday.totalWork).toBe(24)
  })

  it('filters descendants while preserving matching ancestors and filtered totals', () => {
    const model = buildUsageModel({
      mode: 'task',
      tasks: [task(1, new Date(2026, 8, 7), new Date(2026, 8, 8), 1, [1, 2])],
      resources,
      calendar: defaultCalendarConfig,
      durationUnit: 'day',
      timescale: 'day',
      filter: 'Alex',
      groupBy: 'task',
    })

    expect(model.rows).toHaveLength(1)
    expect(model.rows[0].label).toBe('Task 1')
    expect(model.rows[0].children.map((row) => row.label)).toEqual(['Alex'])
    expect(model.rows[0].totalWork).toBe(4)
    expect(model.totalWork).toBe(4)
  })
  it('aggregates work at day, week, and month boundaries', () => {
    const scheduled = task(3, new Date(2026, 8, 4), new Date(2026, 8, 8), 2, [1])
    const dayModel = buildUsageModel({
      mode: 'resource',
      tasks: [scheduled],
      resources: [resources[0]],
      calendar: defaultCalendarConfig,
      durationUnit: 'day',
      timescale: 'day',
      groupBy: 'resource',
    })
    const weekModel = buildUsageModel({
      mode: 'resource',
      tasks: [scheduled],
      resources: [resources[0]],
      calendar: defaultCalendarConfig,
      durationUnit: 'day',
      timescale: 'week',
      groupBy: 'resource',
    })
    const monthModel = buildUsageModel({
      mode: 'resource',
      tasks: [scheduled],
      resources: [resources[0]],
      calendar: defaultCalendarConfig,
      durationUnit: 'day',
      timescale: 'month',
      groupBy: 'resource',
    })

    expect(dayModel.rows[0].periodWork['2026-09-04']).toBe(8)
    expect(dayModel.rows[0].periodWork['2026-09-07']).toBe(8)
    expect(weekModel.periods).toHaveLength(2)
    expect(weekModel.rows[0].periodWork['2026-08-31']).toBe(8)
    expect(weekModel.rows[0].periodWork['2026-09-07']).toBe(8)
    expect(monthModel.periods).toHaveLength(1)
    expect(monthModel.rows[0].periodWork['2026-09-01']).toBe(16)
  })

  it('deduplicates duplicate assignments and ignores unknown resources', () => {
    const model = buildUsageModel({
      mode: 'task',
      tasks: [task(4, new Date(2026, 8, 7), new Date(2026, 8, 8), 1, [1, 1, 999])],
      resources,
      calendar: defaultCalendarConfig,
      durationUnit: 'day',
      timescale: 'day',
      groupBy: 'task',
    })

    expect(model.rows[0].children.map((row) => row.label)).toEqual(['Alex'])
    expect(model.rows[0].children[0].totalWork).toBe(8)
    expect(model.totalWork).toBe(8)
  })

  it('suppresses overallocation metadata in Task Usage', () => {
    const model = markResourceOverallocation(buildUsageModel({
      mode: 'task',
      tasks: [
        task(5, new Date(2026, 8, 7), new Date(2026, 8, 8), 1, [1]),
        task(6, new Date(2026, 8, 7), new Date(2026, 8, 8), 1, [1]),
      ],
      resources: [resources[0]],
      calendar: defaultCalendarConfig,
      durationUnit: 'day',
      timescale: 'week',
      groupBy: 'task',
    }), defaultCalendarConfig)

    expect(model.rows.every((row) => row.overallocatedPeriods.length === 0)).toBe(true)
    expect(model.rows.every((row) => row.peakDayByPeriod[model.periods[0].key] === undefined)).toBe(true)
  })

  it('rolls holiday-skipped work across a month boundary', () => {
    const model = buildUsageModel({
      mode: 'resource',
      tasks: [task(7, new Date(2026, 7, 31), new Date(2026, 8, 3), 3, [1])],
      resources: [resources[0]],
      calendar: defaultCalendarConfig,
      durationUnit: 'day',
      timescale: 'month',
      groupBy: 'resource',
    })

    expect(model.rows[0].periodWork['2026-08-01']).toBe(12)
    expect(model.rows[0].periodWork['2026-09-01']).toBe(12)
    expect(model.totalWork).toBe(24)
  })
  it('allocates hour durations across working days without converting them to days', () => {
    const model = buildUsageModel({
      mode: 'resource',
      tasks: [task(8, new Date(2026, 8, 7), new Date(2026, 8, 9), 12, [1])],
      resources: [resources[0]],
      calendar: defaultCalendarConfig,
      durationUnit: 'hour',
      timescale: 'day',
      groupBy: 'resource',
    })

    expect(model.totalWork).toBe(12)
    expect(model.rows[0].totalWork).toBe(12)
    expect(model.rows[0].periodWork['2026-09-07']).toBe(6)
    expect(model.rows[0].periodWork['2026-09-08']).toBe(6)
    expect(model.dailyWork['resource:1']).toEqual({
      '2026-09-07': 6,
      '2026-09-08': 6,
    })
  })

  it('does not mark a week overallocated when its total fits day-by-day capacity', () => {
    const model = markResourceOverallocation(buildUsageModel({
      mode: 'resource',
      tasks: [task(9, new Date(2026, 8, 7), new Date(2026, 8, 12), 5, [1])],
      resources: [resources[0]],
      calendar: defaultCalendarConfig,
      durationUnit: 'day',
      timescale: 'week',
      groupBy: 'resource',
    }), defaultCalendarConfig)
    const period = model.periods[0]
    const row = model.rows[0]

    expect(period.capacityHours).toBe(40)
    expect(row.periodWork[period.key]).toBe(40)
    expect(row.overallocatedPeriods).toEqual([])
    expect(row.peakDayByPeriod[period.key]).toMatchObject({
      date: '2026-09-07',
      dailyWork: 8,
      dailyCapacity: 8,
    })
  })

  it('groups multiple resources with exact resource rollups', () => {
    const groupedResources: GanttResource[] = [
      { id: 1, label: 'Alex' },
      { id: 2, label: 'Sam' },
      { id: 3, label: 'Zoe' },
    ]
    const model = buildUsageModel({
      mode: 'resource',
      tasks: [
        task(10, new Date(2026, 8, 7), new Date(2026, 8, 8), 1, [1]),
        task(11, new Date(2026, 8, 7), new Date(2026, 8, 9), 2, [2]),
        task(12, new Date(2026, 8, 7), new Date(2026, 8, 9), 2, [1, 3]),
      ],
      resources: groupedResources,
      calendar: defaultCalendarConfig,
      durationUnit: 'day',
      timescale: 'day',
      groupBy: 'resource',
    })

    expect(model.rows.map((row) => row.label)).toEqual(['Alex', 'Sam', 'Zoe'])
    expect(model.rows.map((row) => row.totalWork)).toEqual([16, 16, 8])
    expect(model.rows[0].children.map((row) => row.label)).toEqual(['Task 10', 'Task 12'])
    expect(model.totalWork).toBe(40)
  })

  it('groups assigned nested tasks and tasks without a phase separately', () => {
    const designPhase = { id: 20, text: 'Design phase', type: 'summary' } as ITask
    const buildPhase = { id: 21, text: 'Build phase', type: 'summary' } as ITask
    const designTask = task(22, new Date(2026, 8, 7), new Date(2026, 8, 8), 1, [1])
    designTask.parent = designPhase.id
    const buildTask = task(23, new Date(2026, 8, 8), new Date(2026, 8, 9), 1, [2])
    buildTask.parent = buildPhase.id
    const unassignedPhaseTask = task(24, new Date(2026, 8, 7), new Date(2026, 8, 8), 1)
    const model = buildUsageModel({
      mode: 'task',
      tasks: [designPhase, designTask, buildPhase, buildTask, unassignedPhaseTask],
      resources,
      calendar: defaultCalendarConfig,
      durationUnit: 'day',
      timescale: 'day',
      groupBy: 'phase',
    })

    expect(model.rows.map((row) => row.label)).toEqual(['Build phase', 'Design phase', 'Unassigned phase'])
    const buildRow = model.rows.find((row) => row.label === 'Build phase')
    const designRow = model.rows.find((row) => row.label === 'Design phase')
    const unassignedRow = model.rows.find((row) => row.label === 'Unassigned phase')
    expect(buildRow?.totalWork).toBe(8)
    expect(buildRow?.children[0].children.map((row) => row.label)).toEqual(['Sam'])
    expect(designRow?.totalWork).toBe(8)
    expect(designRow?.children[0].children.map((row) => row.label)).toEqual(['Alex'])
    expect(unassignedRow?.totalWork).toBe(8)
    expect(unassignedRow?.children[0].children.map((row) => row.label)).toEqual(['Unassigned'])
    expect(model.totalWork).toBe(24)
  })

  it('shows an Unassigned child by default for a task without resources', () => {
    const model = buildUsageModel({
      mode: 'task',
      tasks: [
        task(25, new Date(2026, 8, 7), new Date(2026, 8, 8), 1),
        task(26, new Date(2026, 8, 7), new Date(2026, 8, 8), 1, [1]),
      ],
      resources,
      calendar: defaultCalendarConfig,
      durationUnit: 'day',
      timescale: 'day',
      groupBy: 'task',
    })

    expect(model.rows[0].children.map((row) => [row.label, row.totalWork])).toEqual([['Unassigned', 8]])
    expect(model.rows[0].totalWork).toBe(8)
    expect(model.rows[1].children.map((row) => [row.label, row.totalWork])).toEqual([['Alex', 8]])
    expect(model.totalWork).toBe(16)
  })

  it('keeps matching resource ancestors and recalculates filtered work', () => {
    const filterResources: GanttResource[] = [
      { id: 1, label: 'Alex' },
      { id: 2, label: 'Sam' },
    ]
    const apiTask = task(27, new Date(2026, 8, 7), new Date(2026, 8, 8), 1, [1])
    apiTask.text = 'API delivery'
    const documentationTask = task(28, new Date(2026, 8, 7), new Date(2026, 8, 8), 1, [1])
    documentationTask.text = 'Documentation'
    const qaTask = task(29, new Date(2026, 8, 7), new Date(2026, 8, 8), 1, [2])
    qaTask.text = 'QA validation'
    const taskFilterModel = buildUsageModel({
      mode: 'resource',
      tasks: [apiTask, documentationTask, qaTask],
      resources: filterResources,
      calendar: defaultCalendarConfig,
      durationUnit: 'day',
      timescale: 'day',
      filter: 'API',
      groupBy: 'resource',
    })
    const resourceFilterModel = buildUsageModel({
      mode: 'resource',
      tasks: [apiTask, documentationTask, qaTask],
      resources: filterResources,
      calendar: defaultCalendarConfig,
      durationUnit: 'day',
      timescale: 'day',
      filter: 'Alex',
      groupBy: 'resource',
    })

    expect(taskFilterModel.rows.map((row) => row.label)).toEqual(['Alex'])
    expect(taskFilterModel.rows[0].children.map((row) => row.label)).toEqual(['API delivery'])
    expect(taskFilterModel.rows[0].totalWork).toBe(8)
    expect(resourceFilterModel.rows.map((row) => row.label)).toEqual(['Alex'])
    expect(resourceFilterModel.rows[0].children.map((row) => row.label)).toEqual(['API delivery', 'Documentation'])
    expect(resourceFilterModel.rows[0].totalWork).toBe(16)
  })

  it('suppresses overallocation metadata recursively throughout Task Usage', () => {
    const phase = { id: 30, text: 'Delivery', type: 'summary' } as ITask
    const nested = task(31, new Date(2026, 8, 7), new Date(2026, 8, 8), 1, [1])
    nested.parent = phase.id
    const model = markResourceOverallocation(buildUsageModel({
      mode: 'task',
      tasks: [phase, nested, task(32, new Date(2026, 8, 7), new Date(2026, 8, 8), 1)],
      resources,
      calendar: defaultCalendarConfig,
      durationUnit: 'day',
      timescale: 'week',
      groupBy: 'phase',
    }), defaultCalendarConfig)
    const collectRows = (rows: typeof model.rows): typeof model.rows =>
      rows.flatMap((row) => [row, ...collectRows(row.children)])
    const allRows = collectRows(model.rows)

    expect(allRows.length).toBeGreaterThan(2)
    expect(allRows.every((row) =>
      row.overallocatedPeriods.length === 0 &&
      Object.values(row.peakDayByPeriod).every((peak) => peak === undefined)
    )).toBe(true)
  })
  it('propagates truthful peak metadata to resource roots', () => {
    const model = markResourceOverallocation(buildUsageModel({
      mode: 'resource',
      tasks: [
        task(33, new Date(2026, 8, 7), new Date(2026, 8, 8), 1, [1]),
        task(34, new Date(2026, 8, 7), new Date(2026, 8, 8), 1, [1]),
      ],
      resources: [{ id: 1, label: 'Alex' }],
      calendar: defaultCalendarConfig,
      durationUnit: 'day',
      timescale: 'month',
      groupBy: 'resource',
    }), defaultCalendarConfig)
    const root = model.rows[0]
    const peak = root.peakDayByPeriod['2026-09-01']
    expect(root.overallocatedPeriods).toEqual(['2026-09-01'])
    expect(peak).toMatchObject({ date: '2026-09-07', dailyWork: 16, dailyCapacity: 8, resourceLabel: 'Alex' })
  })

  it('tolerates malformed tasks and resources without breaking rollups', () => {
    const noResources = task(50, new Date(2026, 8, 7), new Date(2026, 8, 8), 1)
    delete (noResources as TaskWithResources).resources
    const noDates = { id: 51, text: 'No dates', duration: 1, type: 'task' } as ITask
    const zeroDuration = task(52, new Date(2026, 8, 7), new Date(2026, 8, 8), 0, [1])
    const unknownResource = task(53, new Date(2026, 8, 7), new Date(2026, 8, 8), 1, [99])
    const noText = task(54, new Date(2026, 8, 7), new Date(2026, 8, 8), 1, [1])
    delete noText.text
    delete noText.type
    const model = buildUsageModel({
      mode: 'resource',
      tasks: [noResources, noDates, zeroDuration, unknownResource, noText],
      resources: [{ id: 1, label: '' }],
      calendar: { ...defaultCalendarConfig, workingHoursPerDay: undefined } as typeof defaultCalendarConfig,
      durationUnit: 'day',
      timescale: 'day',
      groupBy: 'resource',
    })

    expect(model.rows.map((row) => row.label)).toEqual(['Resource 1'])
    expect(model.rows[0].children.map((row) => row.label)).toEqual(['Task 52', 'Task 54'])
    expect(model.rows[0].children.map((row) => row.secondaryLabel)).toEqual(['task', 'Task'])
    expect(model.rows[0].totalWork).toBe(8)
  })

  it('preserves a matching Phase ancestor when only the phase name matches', () => {
    const phase = { id: 40, text: 'Release phase', type: 'summary' } as ITask
    const child = task(41, new Date(2026, 8, 7), new Date(2026, 8, 8), 1, [1])
    child.parent = phase.id
    const other = task(42, new Date(2026, 8, 7), new Date(2026, 8, 8), 1, [2])
    const model = buildUsageModel({
      mode: 'task',
      tasks: [phase, child, other],
      resources,
      calendar: defaultCalendarConfig,
      durationUnit: 'day',
      timescale: 'day',
      filter: 'Release phase',
      groupBy: 'phase',
    })

    expect(model.rows.map((row) => row.label)).toEqual(['Release phase'])
    expect(model.rows[0].children.map((row) => row.label)).toEqual(['Task 41'])
    expect(model.totalWork).toBe(8)
  })
})
