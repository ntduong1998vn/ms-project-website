import { describe, expect, it } from 'vitest'
import type { ITask } from '@svar-ui/react-gantt'
import { defaultFieldMapping } from '@/lib/integrations/fields'
import {
  buildIssuePayload,
  customFieldKey,
  flattenRedmineIssue,
  parseCustomFieldKey,
} from '@/lib/integrations/redmine/fields'
import type { RedmineIssue } from '@/lib/integrations/redmine/types'
import type { IntegrationFieldMapping, PushContext, RemoteFieldDescriptor } from '@/lib/integrations/types'
import type { GanttResource } from '@/types/gantt'

function redmineIssue(partial: Partial<RedmineIssue> & { id: number }): RedmineIssue {
  return {
    subject: `Issue ${partial.id}`,
    tracker: { id: 1, name: 'Bug' },
    status: { id: 1, name: 'New' },
    priority: { id: 2, name: 'Normal' },
    ...partial,
  }
}

function ctx(overrides: {
  mapping?: IntegrationFieldMapping
  descriptors?: RemoteFieldDescriptor[]
  keyByTaskId?: Map<string, string>
  resources?: GanttResource[]
  remoteMeta?: PushContext['remoteMeta']
  visibleRemoteColumns?: string[]
  durationUnit?: 'day' | 'hour'
} = {}): PushContext {
  const mapping = overrides.mapping ?? defaultFieldMapping()
  return {
    mapping,
    descriptors: overrides.descriptors ?? [],
    keyByTaskId: overrides.keyByTaskId ?? new Map(),
    resources: overrides.resources ?? [],
    remoteMeta: overrides.remoteMeta ?? { trackers: [], statuses: [], priorities: [], versions: [], members: [] },
    // Default: every imported extraField counts as a displayed column.
    visibleRemoteColumns: overrides.visibleRemoteColumns ?? mapping.extraFields,
    workingHoursPerDay: 8,
    durationUnit: overrides.durationUnit ?? 'day',
  }
}

describe('flattenRedmineIssue', () => {
  it('copies scalar fields and splits named entities into readable values', () => {
    const remote = flattenRedmineIssue(redmineIssue({
      id: 10,
      subject: 'Build it',
      description: 'details here',
      start_date: '2026-09-07',
      due_date: '2026-09-09',
      done_ratio: 30,
      estimated_hours: 12.5,
      parent: { id: 4 },
      assigned_to: { id: 7, name: 'Alice' },
      author: { id: 3, name: 'Eve' },
      fixed_version: { id: 2, name: 'v1.0' },
    }))

    expect(remote.key).toBe('10')
    expect(remote.fields).toMatchObject({
      subject: 'Build it',
      description: 'details here',
      start_date: '2026-09-07',
      due_date: '2026-09-09',
      done_ratio: 30,
      estimated_hours: 12.5,
      parent_id: 4,
      assigned_to: 'Alice',
      assigned_to_id: 7,
      tracker: 'Bug',
      status: 'New',
      priority: 'Normal',
      author: 'Eve',
      fixed_version: 'v1.0',
    })
  })

  it('omits optional keys that are absent from the issue', () => {
    const remote = flattenRedmineIssue(redmineIssue({ id: 5 }))
    expect(remote.key).toBe('5')
    expect(remote.fields.description).toBeUndefined()
    expect(remote.fields.start_date).toBeUndefined()
    expect(remote.fields.due_date).toBeUndefined()
    expect(remote.fields.estimated_hours).toBeUndefined()
    expect(remote.fields.parent_id).toBeUndefined()
    expect(remote.fields.assigned_to).toBeUndefined()
    expect(remote.fields.author).toBeUndefined()
    expect(remote.fields.fixed_version).toBeUndefined()
    expect(remote.fields.successors).toEqual([])
  })

  it('flattens custom fields to cf_N keys and joins multi-value entries', () => {
    const remote = flattenRedmineIssue(redmineIssue({
      id: 1,
      custom_fields: [
        { id: 7, name: 'Sprint', value: 'Sprint 3' },
        { id: 9, name: 'Tags', value: ['a', 'b', 'c'] },
      ],
    }))

    expect(remote.fields.cf_7).toBe('Sprint 3')
    expect(remote.fields.cf_9).toBe('a; b; c')
  })

  it('normalizes relations to successors for both directions with dedupe', () => {
    const remote = flattenRedmineIssue(redmineIssue({
      id: 10,
      relations: [
        // outgoing precedes: 10 precedes 11 → 11 is a successor
        { id: 1, issue_id: 10, issue_to_id: 11, relation_type: 'precedes', delay: 2 },
        // incoming follows: 12 follows 10 → 12 is a successor
        { id: 2, issue_id: 12, issue_to_id: 10, relation_type: 'follows', delay: null },
        // incoming precedes: 13 precedes 10 → predecessor, not a successor
        { id: 3, issue_id: 13, issue_to_id: 10, relation_type: 'precedes', delay: 0 },
        // outgoing follows: 10 follows 14 → predecessor, not a successor
        { id: 4, issue_id: 10, issue_to_id: 14, relation_type: 'follows', delay: 0 },
        // unrelated types are ignored
        { id: 5, issue_id: 10, issue_to_id: 15, relation_type: 'relates', delay: null },
        // duplicate relation id (appears on both endpoint payloads) dedupes
        { id: 1, issue_id: 10, issue_to_id: 11, relation_type: 'precedes', delay: 2 },
        // self-link skipped
        { id: 6, issue_id: 10, issue_to_id: 10, relation_type: 'precedes', delay: 0 },
      ],
    }))

    expect(remote.fields.successors).toEqual([
      { key: '11', delay: 2 },
      { key: '12', delay: 0 },
    ])
  })
})

describe('custom field key helpers', () => {
  it('round-trips cf_N keys and rejects anything else', () => {
    expect(customFieldKey(12)).toBe('cf_12')
    expect(parseCustomFieldKey('cf_12')).toBe(12)
    expect(parseCustomFieldKey('subject')).toBeNull()
    expect(parseCustomFieldKey('cf_')).toBeNull()
    expect(parseCustomFieldKey('cf_12x')).toBeNull()
  })
})

describe('buildIssuePayload', () => {
  it('writes mapped fields with create-only project_id and tracker_id', () => {
    const task: ITask = {
      id: 1,
      text: 'Build',
      details: 'notes',
      start: new Date(2026, 8, 7),
      end: new Date(2026, 8, 9), // exclusive → inclusive due_date Sep 8
      duration: 2,
      progress: 33.6,
      type: 'task',
    }
    const payload = buildIssuePayload(task, ctx(), 'create', {
      trackerId: 3,
      projectIdentifier: 'proj',
    })

    expect(payload).toEqual({
      subject: 'Build',
      description: 'notes',
      start_date: '2026-09-07',
      due_date: '2026-09-08',
      estimated_hours: 16,
      done_ratio: 34,
      tracker_id: 3,
      project_id: 'proj',
    })
  })

  it('omits create-only fields and unmapped fields on update', () => {
    const task: ITask = { id: 1, text: 'Build', start: new Date(2026, 8, 7), duration: 1, progress: 0 }
    const mapping = defaultFieldMapping()
    mapping.fields.details = null
    mapping.fields.end = null
    const payload = buildIssuePayload(task, ctx({ mapping }), 'update', {
      trackerId: 3,
      projectIdentifier: 'proj',
    })

    expect(payload.project_id).toBeUndefined()
    expect(payload.tracker_id).toBeUndefined()
    expect(payload.description).toBeUndefined()
    expect(payload.due_date).toBeUndefined()
    expect(payload.subject).toBe('Build')
  })

  it('omits undefined start, end, and duration without crashing', () => {
    const payload = buildIssuePayload({ id: 1, text: 'Bare' }, ctx(), 'update')
    expect(payload).toEqual({ subject: 'Bare', description: '' })
  })

  it('writes estimated_hours in the configured duration unit', () => {
    const task: ITask = { id: 1, text: 'A', duration: 2 }
    expect(buildIssuePayload(task, ctx(), 'update').estimated_hours).toBe(16)
    expect(buildIssuePayload(task, ctx({ durationUnit: 'hour' }), 'update').estimated_hours).toBe(2)
  })

  it('writes parent_issue_id and assigned_to_id through the live key map and resource keys', () => {
    const task: ITask = { id: 2, text: 'Child', parent: 1, resources: [5] }
    const payload = buildIssuePayload(task, ctx({
      keyByTaskId: new Map([['1', '555']]),
      resources: [{ id: 5, label: 'Alice', externalSource: 'redmine', externalKey: '42' }],
    }), 'update')

    expect(payload.parent_issue_id).toBe(555)
    expect(payload.assigned_to_id).toBe(42)
  })

  it('omits unresolved parents and assignees without external keys', () => {
    const task: ITask = { id: 2, text: 'Child', parent: 1, resources: [5] }
    const payload = buildIssuePayload(task, ctx({
      resources: [{ id: 5, label: 'Local only' }],
    }), 'update')

    expect(payload.parent_issue_id).toBeUndefined()
    expect(payload.assigned_to_id).toBeUndefined()
  })

  it('writes milestone due_date equal to start_date', () => {
    const task: ITask = { id: 1, text: 'Release', type: 'milestone', start: new Date(2026, 8, 7), duration: 0 }
    const payload = buildIssuePayload(task, ctx(), 'update')
    expect(payload.due_date).toBe('2026-09-07')
  })

  it('emits extraFields as a custom_fields array, splitting multi-value fields', () => {
    const mapping = defaultFieldMapping()
    mapping.extraFields = ['cf_7', 'cf_9', 'status']
    const descriptors: RemoteFieldDescriptor[] = [
      { key: 'cf_9', label: 'Env (custom)', kind: 'custom', valueType: 'string', multiple: true },
    ]
    const task: ITask = { id: 1, text: 'A', cf_7: 'one', cf_9: 'a; b' }
    const payload = buildIssuePayload(task, ctx({ mapping, descriptors }), 'update')

    expect(payload.custom_fields).toEqual([
      { id: 7, value: 'one' },
      { id: 9, value: ['a', 'b'] },
    ])
  })

  it('writes empty multi-value custom fields as empty arrays and skips absent values', () => {
    const mapping = defaultFieldMapping()
    mapping.extraFields = ['cf_9']
    const descriptors: RemoteFieldDescriptor[] = [
      { key: 'cf_9', label: 'Env (custom)', kind: 'custom', valueType: 'string', multiple: true },
    ]
    // '' clears the remote field
    const cleared = buildIssuePayload(
      { id: 1, text: 'A', cf_9: '' },
      ctx({ mapping, descriptors }),
      'update'
    )
    expect(cleared.custom_fields).toEqual([{ id: 9, value: [] }])
    // absent value leaves the remote field untouched
    const untouched = buildIssuePayload(
      { id: 1, text: 'A' },
      ctx({ mapping, descriptors }),
      'update'
    )
    expect(untouched.custom_fields).toBeUndefined()
  })

  it('routes mapped cf_N fields into custom_fields and skips read-only keys', () => {
    const mapping = defaultFieldMapping()
    mapping.fields.details = 'cf_9'
    mapping.fields.progress = 'status'
    const task: ITask = { id: 1, text: 'A', details: 'via cf', progress: 50 }
    const payload = buildIssuePayload(task, ctx({ mapping }), 'update')

    expect(payload.custom_fields).toEqual([{ id: 9, value: 'via cf' }])
    expect(payload.description).toBeUndefined()
    expect(payload.status).toBeUndefined()
    expect(payload.done_ratio).toBeUndefined()
  })

  it('omits fields whose task values are missing or invalid', () => {
    const task: ITask = { id: 1, duration: Number.NaN, progress: Number.NaN }
    const payload = buildIssuePayload(task, ctx(), 'update')
    expect(payload.subject).toBeUndefined()
    expect(payload.start_date).toBeUndefined()
    expect(payload.due_date).toBeUndefined()
    expect(payload.estimated_hours).toBeUndefined()
    expect(payload.done_ratio).toBeUndefined()
  })

  it('omits parent and assignee when the resolved keys are not numeric', () => {
    const task: ITask = { id: 2, text: 'Child', parent: 1, resources: [5] }
    const payload = buildIssuePayload(task, ctx({
      keyByTaskId: new Map([['1', 'ABC-9']]),
      resources: [{ id: 5, label: 'Alice', externalSource: 'redmine', externalKey: 'not-a-number' }],
    }), 'update')
    expect(payload.parent_issue_id).toBeUndefined()
    expect(payload.assigned_to_id).toBeUndefined()
  })

  it('writes single-value custom fields as strings even without a descriptor', () => {
    const mapping = defaultFieldMapping()
    mapping.extraFields = ['cf_7']
    const task: ITask = { id: 1, text: 'A', cf_7: 42 }
    const payload = buildIssuePayload(task, ctx({ mapping }), 'update')
    expect(payload.custom_fields).toEqual([{ id: 7, value: '42' }])
  })

  it('emits no custom_fields key when extraFields hold only non-cf keys', () => {
    const mapping = defaultFieldMapping()
    mapping.extraFields = ['status']
    const payload = buildIssuePayload({ id: 1, text: 'A' }, ctx({ mapping }), 'update')
    expect(payload.custom_fields).toBeUndefined()
  })

  it('skips extraFields whose column is not displayed', () => {
    const mapping = defaultFieldMapping()
    mapping.extraFields = ['status', 'cf_7']
    const task: ITask = { id: 1, text: 'A', status: 'Closed', cf_7: 'x' }
    const payload = buildIssuePayload(task, ctx({
      mapping,
      visibleRemoteColumns: ['cf_7'],
      remoteMeta: { trackers: [], statuses: [{ id: 5, name: 'Closed' }], priorities: [], versions: [], members: [] },
    }), 'update')

    expect(payload.status_id).toBeUndefined()
    expect(payload.custom_fields).toEqual([{ id: 7, value: 'x' }])
  })

  it('resolves tracker names case-insensitively with trimming', () => {
    const mapping = defaultFieldMapping()
    mapping.extraFields = ['tracker']
    const task: ITask = { id: 1, text: 'A', tracker: '  bug ' }
    const payload = buildIssuePayload(task, ctx({
      mapping,
      remoteMeta: { trackers: [{ id: 2, name: 'Bug' }], statuses: [], priorities: [], versions: [], members: [] },
    }), 'update')

    expect(payload.tracker_id).toBe(2)
  })

  it('coerces done_ratio strings to the nearest step of 10 and clamps to 0-100', () => {
    const mapping = defaultFieldMapping()
    mapping.extraFields = ['done_ratio']
    const build = (value: unknown) =>
      buildIssuePayload({ id: 1, text: 'A', done_ratio: value } as ITask, ctx({ mapping }), 'update')

    expect(build('45').done_ratio).toBe(50)
    expect(build('44').done_ratio).toBe(40)
    expect(build('130').done_ratio).toBe(100)
    expect(build('abc').done_ratio).toBeUndefined()
  })

  it('falls back to member name match when the resource has no externalKey', () => {
    const mapping = defaultFieldMapping()
    mapping.extraFields = ['assigned_to']
    const task: ITask = { id: 1, text: 'A', assigned_to: 'Bob' }
    const payload = buildIssuePayload(task, ctx({
      mapping,
      resources: [{ id: 5, label: 'Bob' }],
      remoteMeta: { trackers: [], statuses: [], priorities: [], versions: [], members: [{ id: 8, name: 'Bob' }] },
    }), 'update')

    expect(payload.assigned_to_id).toBe(8)
  })
})
