import { describe, expect, it } from 'vitest'
import type { ILink, ITask } from '@svar-ui/react-gantt'
import { defaultFieldMapping, parseLocalDate } from '@/lib/integrations/fields'
import { applyRemoteIssues, linkedTasks, unlinkedTasks } from '@/lib/integrations/sync'
import type { IntegrationFieldMapping, RemoteFieldDescriptor, RemoteIssue } from '@/lib/integrations/types'
import { flattenRedmineIssue, redmineStandardFields } from '@/lib/integrations/redmine/fields'
import type { RedmineIssue } from '@/lib/integrations/redmine/types'
import { defaultCalendarConfig } from '@/lib/scheduler'
import type { GanttResource } from '@/types/gantt'

function issue(key: string, fields: RemoteIssue['fields'] = {}): RemoteIssue {
  return { key, fields }
}

function apply(
  issues: RemoteIssue[],
  existing: { tasks?: ITask[]; links?: ILink[]; resources?: GanttResource[] } = {},
  overrides: {
    mapping?: IntegrationFieldMapping
    descriptors?: RemoteFieldDescriptor[]
    durationUnit?: 'day' | 'hour'
    isAutoSchedule?: boolean
  } = {}
) {
  return applyRemoteIssues(
    issues,
    overrides.descriptors ?? redmineStandardFields,
    overrides.mapping ?? defaultFieldMapping(),
    { tasks: existing.tasks ?? [], links: existing.links ?? [], resources: existing.resources ?? [] },
    'redmine',
    defaultCalendarConfig,
    overrides.durationUnit ?? 'day',
    overrides.isAutoSchedule ?? false
  )
}

describe('applyRemoteIssues', () => {
  it('returns no-issues for an empty fetch', () => {
    expect(apply([])).toEqual({ kind: 'no-issues' })
  })

  it('inserts issues as numeric-id tasks with mapped fields and external keys', () => {
    const result = apply([
      issue('101', {
        subject: 'Design',
        start_date: '2026-09-07',
        due_date: '2026-09-08',
        done_ratio: 40,
        estimated_hours: 16,
      }),
      issue('102', { subject: 'Docs', estimated_hours: 16 }),
    ], { tasks: [{ id: 7, text: 'Local' }] })

    expect(result.kind).toBe('success')
    if (result.kind !== 'success') return
    expect(result.inserted).toBe(2)
    expect(result.updated).toBe(0)

    const design = result.tasks.find((task) => task.externalKey === '101')
    expect(design).toMatchObject({
      id: 8,
      text: 'Design',
      type: 'task',
      progress: 40,
      externalSource: 'redmine',
      externalKey: '101',
    })
    // due_date is inclusive: Sep 7 + Sep 8 → exclusive end Sep 9 → 2 working days
    expect(design?.end?.getDate()).toBe(9)
    expect(design?.duration).toBe(2)

    // estimated_hours converts at 8h/day when no dates are present
    const docs = result.tasks.find((task) => task.externalKey === '102')
    expect(docs).toMatchObject({ id: 9, duration: 2 })
  })

  it('parses remote dates as local midnight, not UTC', () => {
    const result = apply([issue('1', { subject: 'A', start_date: '2026-09-07', due_date: '2026-09-08' })])
    if (result.kind !== 'success') return
    const task = result.tasks[0]
    expect(task.start?.getFullYear()).toBe(2026)
    expect(task.start?.getMonth()).toBe(8)
    expect(task.start?.getDate()).toBe(7)
    expect(task.end?.getFullYear()).toBe(2026)
    expect(task.end?.getMonth()).toBe(8)
    expect(task.end?.getDate()).toBe(9)
  })

  it('updates mapped fields on linked tasks while preserving unmapped fields and ids', () => {
    const existing: ITask = {
      id: 5,
      text: 'Old name',
      start: new Date(2026, 8, 1),
      duration: 3,
      progress: 10,
      type: 'task',
      details: 'keep me',
      customProp: 'untouched',
      externalSource: 'redmine',
      externalKey: '42',
    }
    const mapping = defaultFieldMapping()
    mapping.fields.details = null
    const result = apply(
      [issue('42', { subject: 'New name', done_ratio: 80, start_date: '2026-09-07' })],
      { tasks: [existing] },
      { mapping }
    )

    expect(result.kind).toBe('success')
    if (result.kind !== 'success') return
    expect(result.updated).toBe(1)
    expect(result.inserted).toBe(0)
    expect(result.tasks).toHaveLength(1)
    const task = result.tasks[0]
    expect(task.id).toBe(5)
    expect(task.text).toBe('New name')
    expect(task.progress).toBe(80)
    expect(task.start?.getDate()).toBe(7)
    expect(task.details).toBe('keep me')
    expect(task.customProp).toBe('untouched')
    expect(task.externalSource).toBe('redmine')
    expect(task.externalKey).toBe('42')
  })

  it('resolves parent_id to internal ids even when the parent arrives after the child', () => {
    const result = apply([
      issue('2', { subject: 'Child', parent_id: 1 }),
      issue('1', { subject: 'Parent' }),
      issue('3', { subject: 'Orphan', parent_id: 999 }),
    ])

    expect(result.kind).toBe('success')
    if (result.kind !== 'success') return
    const parent = result.tasks.find((task) => task.externalKey === '1')
    const child = result.tasks.find((task) => task.externalKey === '2')
    const orphan = result.tasks.find((task) => task.externalKey === '3')
    expect(child?.parent).toBe(parent?.id)
    expect(orphan?.parent).toBeUndefined()
    // DFS ordering: inserted parents precede their children
    expect(result.tasks.indexOf(parent!)).toBeLessThan(result.tasks.indexOf(child!))
    expect(parent?.open).toBe(true)
  })

  it('rejects parents that are milestones or would create a cycle', () => {
    const mapping = defaultFieldMapping()
    mapping.fields.type = 'tracker'
    const result = apply([
      issue('1', { subject: 'A', parent_id: 2 }),
      issue('2', { subject: 'B', parent_id: 1 }),
      issue('3', { subject: 'M', tracker: 'milestone' }),
      issue('4', { subject: 'C', parent_id: 3 }),
    ], {}, { mapping })

    expect(result.kind).toBe('success')
    if (result.kind !== 'success') return
    const a = result.tasks.find((task) => task.externalKey === '1')
    const b = result.tasks.find((task) => task.externalKey === '2')
    const c = result.tasks.find((task) => task.externalKey === '4')
    // Exactly one side of the 1↔2 cycle may be parented
    expect((a?.parent !== undefined ? 1 : 0) + (b?.parent !== undefined ? 1 : 0)).toBe(1)
    // Milestones cannot be parents
    expect(c?.parent).toBeUndefined()
  })

  it('clears or preserves the local parent on update based on remote parent_id', () => {
    const tasks: ITask[] = [
      { id: 1, text: 'Root' },
      { id: 2, text: 'A', parent: 1, externalSource: 'redmine', externalKey: '2' },
      { id: 3, text: 'B', parent: 1, externalSource: 'redmine', externalKey: '3' },
    ]
    const result = apply(
      [issue('2', { subject: 'A' }), issue('3', { subject: 'B', parent_id: 999 })],
      { tasks }
    )
    if (result.kind !== 'success') return
    const a = result.tasks.find((task) => task.externalKey === '2')
    const b = result.tasks.find((task) => task.externalKey === '3')
    // Remote root issue clears the local parent
    expect(a?.parent).toBeUndefined()
    // Unresolvable remote parent keeps the existing local parent
    expect(b?.parent).toBe(1)
  })

  it('orders multiple inserted children after their inserted parent', () => {
    const result = apply([
      issue('2', { subject: 'Child A', parent_id: 1 }),
      issue('3', { subject: 'Child B', parent_id: 1 }),
      issue('1', { subject: 'Parent' }),
    ])
    if (result.kind !== 'success') return
    const parent = result.tasks.find((task) => task.externalKey === '1')
    const childA = result.tasks.find((task) => task.externalKey === '2')
    const childB = result.tasks.find((task) => task.externalKey === '3')
    expect(childA?.parent).toBe(parent?.id)
    expect(childB?.parent).toBe(parent?.id)
    expect(result.tasks.indexOf(parent!)).toBeLessThan(result.tasks.indexOf(childA!))
    expect(result.tasks.indexOf(parent!)).toBeLessThan(result.tasks.indexOf(childB!))
  })

  it('creates e2s links with lag for remote successors', () => {
    const result = apply([
      issue('1', { subject: 'A', successors: [{ key: '2', delay: 2 }] }),
      issue('2', { subject: 'B' }),
    ])

    expect(result.kind).toBe('success')
    if (result.kind !== 'success') return
    const a = result.tasks.find((task) => task.externalKey === '1')
    const b = result.tasks.find((task) => task.externalKey === '2')
    expect(result.links).toEqual([{ id: 1, source: a?.id, target: b?.id, type: 'e2s', lag: 2 }])
  })

  it('replaces synced-pair links on re-sync but preserves links to local-only tasks', () => {
    const tasks: ITask[] = [
      { id: 1, text: 'A', externalSource: 'redmine', externalKey: '1' },
      { id: 2, text: 'B', externalSource: 'redmine', externalKey: '2' },
      { id: 9, text: 'Local' },
    ]
    const links: ILink[] = [
      { id: 1, source: 1, target: 2, type: 'e2s' },
      { id: 2, source: 1, target: 9, type: 'e2s' },
    ]
    const result = apply(
      [issue('1', { subject: 'A', successors: [{ key: '2', delay: 3 }] }), issue('2', { subject: 'B' })],
      { tasks, links }
    )

    expect(result.kind).toBe('success')
    if (result.kind !== 'success') return
    const syncedLinks = result.links.filter((link) => link.source === 1 && link.target === 2)
    expect(syncedLinks).toHaveLength(1)
    expect(syncedLinks[0].lag).toBe(3)
    expect(result.links).toContainEqual({ id: 2, source: 1, target: 9, type: 'e2s' })
  })

  it('skips self-links, unknown targets, and duplicate successor entries', () => {
    const result = apply([
      issue('1', {
        subject: 'A',
        successors: [
          { key: '1', delay: 0 },
          { key: '2', delay: 1 },
          { key: '2', delay: 1 },
          { key: '999', delay: 0 },
        ],
      }),
      issue('2', { subject: 'B' }),
    ])

    expect(result.kind).toBe('success')
    if (result.kind !== 'success') return
    expect(result.links).toHaveLength(1)
    expect(result.links[0]).toMatchObject({ type: 'e2s', lag: 1 })
  })

  it('ignores malformed successor entries and non-numeric delays', () => {
    const result = apply([
      issue('1', {
        subject: 'A',
        successors: [{ delay: 1 }, 'junk', null, { key: '2', delay: 'x' }],
      }),
      issue('2', { subject: 'B', successors: 'not-an-array' }),
    ])
    if (result.kind !== 'success') return
    const a = result.tasks.find((task) => task.externalKey === '1')
    const b = result.tasks.find((task) => task.externalKey === '2')
    expect(result.links).toEqual([{ id: 1, source: a?.id, target: b?.id, type: 'e2s', lag: 0 }])
  })

  it('converts relation delay days to lag hours under the hour duration unit', () => {
    const result = apply(
      [issue('1', { subject: 'A', successors: [{ key: '2', delay: 2 }] }), issue('2', { subject: 'B' })],
      {},
      { durationUnit: 'hour' }
    )

    expect(result.kind).toBe('success')
    if (result.kind !== 'success') return
    expect(result.links[0].lag).toBe(16)
  })

  it('leaves existing links untouched when successors is unmapped', () => {
    const links: ILink[] = [{ id: 1, source: 1, target: 2, type: 'e2s' }]
    const mapping = defaultFieldMapping()
    mapping.fields.successors = null
    const result = apply(
      [issue('1', { subject: 'A', successors: [{ key: '2', delay: 5 }] })],
      {
        tasks: [
          { id: 1, text: 'A', externalSource: 'redmine', externalKey: '1' },
          { id: 2, text: 'B', externalSource: 'redmine', externalKey: '2' },
        ],
        links,
      },
      { mapping }
    )

    expect(result.kind).toBe('success')
    if (result.kind !== 'success') return
    expect(result.links).toEqual(links)
  })

  it('assigns link ids after the highest existing numeric link id', () => {
    const result = apply(
      [issue('1', { subject: 'A', successors: [{ key: '2', delay: 0 }] }), issue('2', { subject: 'B' })],
      {
        tasks: [
          { id: 1, text: 'A', externalSource: 'redmine', externalKey: '1' },
          { id: 2, text: 'B', externalSource: 'redmine', externalKey: '2' },
        ],
        links: [{ id: 'local', source: 1, target: 9, type: 'e2s' }],
      }
    )
    if (result.kind !== 'success') return
    const created = result.links.find((link) => link.target === 2)
    expect(created?.id).toBe(1)
  })

  it('resolves assignees by externalKey, then name, then creates a keyed resource', () => {
    const resources: GanttResource[] = [
      { id: 1, label: 'Someone', externalSource: 'redmine', externalKey: '7' },
      { id: 2, label: 'Bob' },
    ]
    const result = apply(
      [
        issue('1', { subject: 'A', assigned_to: 'Alice', assigned_to_id: 7 }),
        issue('2', { subject: 'B', assigned_to: 'bob', assigned_to_id: 8 }),
        issue('3', { subject: 'C', assigned_to: 'Carol', assigned_to_id: 9 }),
      ],
      { resources }
    )

    expect(result.kind).toBe('success')
    if (result.kind !== 'success') return
    const a = result.tasks.find((task) => task.externalKey === '1')
    const b = result.tasks.find((task) => task.externalKey === '2')
    const c = result.tasks.find((task) => task.externalKey === '3')
    expect(a?.resources).toEqual([1])
    expect(b?.resources).toEqual([2])
    expect(c?.resources).toEqual([3])
    expect(result.resources).toContainEqual({ id: 3, label: 'Carol', externalSource: 'redmine', externalKey: '9' })
  })

  it('creates a placeholder label when only assigned_to_id is known', () => {
    const result = apply([issue('1', { subject: 'A', assigned_to_id: 88 })])
    if (result.kind !== 'success') return
    expect(result.resources).toContainEqual({ id: 1, label: 'User #88', externalSource: 'redmine', externalKey: '88' })
    expect(result.tasks[0].resources).toEqual([1])
  })

  it('copies extraFields values verbatim onto the task', () => {
    const mapping = defaultFieldMapping()
    mapping.extraFields = ['cf_7']
    const result = apply([issue('1', { subject: 'A', cf_7: 'custom value' })], {}, { mapping })
    if (result.kind !== 'success') return
    expect(result.tasks[0].cf_7).toBe('custom value')
  })

  it('skips extraFields keys absent from the issue payload', () => {
    const mapping = defaultFieldMapping()
    mapping.extraFields = ['cf_7', 'cf_8']
    const result = apply([issue('1', { subject: 'A' })], {}, { mapping })
    if (result.kind !== 'success') return
    expect(result.tasks[0].cf_7).toBeUndefined()
    expect(result.tasks[0].cf_8).toBeUndefined()
  })

  it('maps a milestone type to zero duration with end equal to start', () => {
    const mapping = defaultFieldMapping()
    mapping.fields.type = 'tracker'
    const result = apply(
      [issue('1', { subject: 'Release', start_date: '2026-09-07', tracker: 'milestone' })],
      {},
      { mapping }
    )
    if (result.kind !== 'success') return
    const task = result.tasks[0]
    expect(task.type).toBe('milestone')
    expect(task.duration).toBe(0)
    expect(task.end?.getTime()).toBe(task.start?.getTime())
  })

  it('keeps the existing type when the mapped type value is not summary or milestone', () => {
    const mapping = defaultFieldMapping()
    mapping.fields.type = 'tracker'
    const existing: ITask = {
      id: 1,
      text: 'A',
      type: 'summary',
      externalSource: 'redmine',
      externalKey: '1',
    }
    const result = apply([issue('1', { subject: 'A', tracker: 'Bug' })], { tasks: [existing] }, { mapping })
    if (result.kind !== 'success') return
    expect(result.tasks[0].type).toBe('summary')
  })

  it('derives duration from dates when estimated_hours is absent', () => {
    const result = apply([issue('1', { subject: 'A', start_date: '2026-09-07', due_date: '2026-09-10' })])
    if (result.kind !== 'success') return
    // Sep 7-10 are Mon-Thu → 4 working days, not the default 1
    expect(result.tasks[0].duration).toBe(4)
  })

  it('keeps estimated_hours as hours only when the descriptor catalog says so', () => {
    const withCatalog = apply([issue('1', { subject: 'A', estimated_hours: 16 })])
    if (withCatalog.kind !== 'success') return
    expect(withCatalog.tasks[0].duration).toBe(2)

    const withoutCatalog = apply([issue('1', { subject: 'A', estimated_hours: 16 })], {}, { descriptors: [] })
    if (withoutCatalog.kind !== 'success') return
    expect(withoutCatalog.tasks[0].duration).toBe(16)
  })

  it('resolves duration from the mapped field type and falls back on update', () => {
    // hours valueType under the hour unit passes through unchanged
    const hourly = apply([issue('1', { subject: 'A', estimated_hours: 16 })], {}, { durationUnit: 'hour' })
    if (hourly.kind !== 'success') return
    expect(hourly.tasks[0].duration).toBe(16)

    // plain-number descriptor keeps the value as-is
    const descriptors: RemoteFieldDescriptor[] = [
      { key: 'dur', label: 'Dur', kind: 'custom', valueType: 'number' },
    ]
    const mapping = defaultFieldMapping()
    mapping.fields.duration = 'dur'
    const plain = apply([issue('1', { subject: 'A', dur: 5 })], {}, { mapping, descriptors })
    if (plain.kind !== 'success') return
    expect(plain.tasks[0].duration).toBe(5)

    // update with no remote duration keeps the existing duration
    const kept = apply(
      [issue('1', { subject: 'A' })],
      { tasks: [{ id: 1, text: 'A', duration: 7, externalSource: 'redmine', externalKey: '1' }] }
    )
    if (kept.kind !== 'success') return
    expect(kept.tasks[0].duration).toBe(7)
  })

  it('falls back to estimated_hours when due_date precedes start_date', () => {
    const result = apply([
      issue('1', { subject: 'A', start_date: '2026-09-10', due_date: '2026-09-07', estimated_hours: 16 }),
    ])
    if (result.kind !== 'success') return
    expect(result.tasks[0].duration).toBe(2)
    expect(result.tasks[0].end?.getTime()).toBeGreaterThan(result.tasks[0].start!.getTime())
  })

  it('clamps progress and falls back to Issue #key for missing subjects', () => {
    const result = apply([
      issue('1', { done_ratio: 250 }),
      issue('2', { subject: 'B', done_ratio: -5 }),
    ])
    if (result.kind !== 'success') return
    expect(result.tasks[0].progress).toBe(100)
    expect(result.tasks[0].text).toBe('Issue #1')
    expect(result.tasks[1].progress).toBe(0)
  })

  it('keeps existing values when remote fields are absent or blank on update', () => {
    const existing: ITask = {
      id: 1,
      text: 'Keep',
      progress: 55,
      duration: 4,
      externalSource: 'redmine',
      externalKey: '1',
    }
    const result = apply([issue('1', { subject: '' })], { tasks: [existing] })
    if (result.kind !== 'success') return
    const task = result.tasks[0]
    expect(task.text).toBe('Keep')
    expect(task.progress).toBe(55)
    expect(task.start).toBeInstanceOf(Date)
  })

  it('clears details and resources on update when the remote values are absent', () => {
    const existing: ITask = {
      id: 1,
      text: 'A',
      details: 'old notes',
      resources: [1],
      externalSource: 'redmine',
      externalKey: '1',
    }
    const result = apply([issue('1', { subject: 'A' })], {
      tasks: [existing],
      resources: [{ id: 1, label: 'Alice' }],
    })
    if (result.kind !== 'success') return
    expect(result.tasks[0].details).toBe('')
    expect(result.tasks[0].resources).toBeUndefined()
  })

  it('preserves resources on update when resources is unmapped', () => {
    const mapping = defaultFieldMapping()
    mapping.fields.resources = null
    const existing: ITask = {
      id: 1,
      text: 'A',
      resources: [1],
      externalSource: 'redmine',
      externalKey: '1',
    }
    const result = apply([issue('1', { subject: 'A', assigned_to: 'Bob', assigned_to_id: 9 })], {
      tasks: [existing],
      resources: [{ id: 1, label: 'Alice' }],
    }, { mapping })
    if (result.kind !== 'success') return
    expect(result.tasks[0].resources).toEqual([1])
  })

  it('does not set details on insert when the remote description is empty', () => {
    const result = apply([issue('1', { subject: 'A', description: '' })])
    if (result.kind !== 'success') return
    expect(result.tasks[0].details).toBeUndefined()
  })

  it('ignores tasks without ids when seeding external-key maps', () => {
    const result = apply(
      [issue('1', { subject: 'A' })],
      {
        tasks: [
          { text: 'No id', externalSource: 'redmine', externalKey: '1' },
          { id: 'x', text: 'String id', externalSource: 'redmine', externalKey: '2' },
        ],
      }
    )
    if (result.kind !== 'success') return
    // The id-less task cannot be matched; issue '1' inserts a new task
    expect(result.inserted).toBe(1)
    expect(result.tasks.find((task) => task.externalKey === '1' && task.id !== undefined)?.text).toBe('A')
  })

  it('auto-schedules successors after their predecessors when enabled', () => {
    const result = apply(
      [
        issue('1', { subject: 'A', start_date: '2026-09-07', due_date: '2026-09-08', successors: [{ key: '2', delay: 0 }] }),
        issue('2', { subject: 'B', start_date: '2026-09-07', due_date: '2026-09-08' }),
      ],
      {},
      { isAutoSchedule: true }
    )
    if (result.kind !== 'success') return
    const a = result.tasks.find((task) => task.externalKey === '1')
    const b = result.tasks.find((task) => task.externalKey === '2')
    expect(b?.start?.getTime()).toBeGreaterThanOrEqual(a?.end?.getTime() ?? 0)
  })

  it('normalizes stored relation rows into successor links with direction and dedupe', () => {
    const redmineIssue = (partial: Partial<RedmineIssue> & { id: number }): RedmineIssue => ({
      subject: `Issue ${partial.id}`,
      tracker: { id: 1, name: 'Bug' },
      status: { id: 1, name: 'New' },
      priority: { id: 2, name: 'Normal' },
      ...partial,
    })
    const issues = [
      // 'precedes' outgoing: 101 precedes 102 → 102 is 101's successor
      flattenRedmineIssue(redmineIssue({
        id: 101,
        relations: [{ id: 5, issue_id: 101, issue_to_id: 102, relation_type: 'precedes', delay: 1 }],
      })),
      // 'precedes' incoming on 102 produces no successor for 102; the same
      // relation row (id 5) on 102's payload must not duplicate the link
      flattenRedmineIssue(redmineIssue({
        id: 102,
        relations: [{ id: 5, issue_id: 101, issue_to_id: 102, relation_type: 'precedes', delay: 1 }],
      })),
      // 'follows' incoming: 101 follows 103 → 101 is 103's successor
      flattenRedmineIssue(redmineIssue({
        id: 103,
        relations: [{ id: 6, issue_id: 101, issue_to_id: 103, relation_type: 'follows', delay: 0 }],
      })),
    ]
    const result = apply(issues)

    expect(result.kind).toBe('success')
    if (result.kind !== 'success') return
    const idOf = (key: string) => result.tasks.find((task) => task.externalKey === key)?.id
    expect(result.links).toContainEqual({ id: 1, source: idOf('101'), target: idOf('102'), type: 'e2s', lag: 1 })
    expect(result.links).toContainEqual({ id: 2, source: idOf('103'), target: idOf('101'), type: 'e2s', lag: 0 })
    expect(result.links).toHaveLength(2)
  })
})

describe('parseLocalDate', () => {
  it('parses YYYY-MM-DD as local midnight and rejects garbage', () => {
    const date = parseLocalDate('2026-09-07')
    expect(date.getFullYear()).toBe(2026)
    expect(date.getMonth()).toBe(8)
    expect(date.getDate()).toBe(7)
    expect(date.getHours()).toBe(0)
    expect(Number.isNaN(parseLocalDate('09/07/2026').getTime())).toBe(true)
    expect(Number.isNaN(parseLocalDate('2026-13-01').getTime())).toBe(true)
    expect(Number.isNaN(parseLocalDate('2026-02-30').getTime())).toBe(true)
    expect(Number.isNaN(parseLocalDate('').getTime())).toBe(true)
  })
})

describe('unlinkedTasks / linkedTasks', () => {
  it('partitions tasks by provider link state', () => {
    const tasks: ITask[] = [
      { id: 1, externalSource: 'redmine', externalKey: '10' },
      { id: 2, externalSource: 'redmine' },
      { id: 3, externalSource: 'jira', externalKey: 'ABC-1' },
      { id: 4 },
    ]
    expect(linkedTasks(tasks, 'redmine').map((task) => task.id)).toEqual([1])
    expect(unlinkedTasks(tasks, 'redmine').map((task) => task.id)).toEqual([2, 3, 4])
  })
})
