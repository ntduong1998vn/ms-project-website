import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ITask } from '@svar-ui/react-gantt'
import { ensureSyncIdentities, hasLocalChanges, mappingFingerprint, maxCursor, snapshot, syncEqual, syncFetchCursor, syncFields, taskBaseline, withBaseline } from '@/lib/integrations/baseline'
import { executeSync, mergeSyncTasks, planSync, pushNewTasks } from '@/lib/integrations/two-way'
import { defaultFieldMapping } from '@/lib/integrations/fields'
import { defaultIntegrationSettings } from '@/lib/integrations/settings'
import { createRedmineProvider } from '@/lib/integrations/redmine/client'
import { applyRemoteIssues } from '@/lib/integrations/sync'
import { defaultCalendarConfig } from '@/lib/scheduler'
import { resequenceProject } from '@/lib/task-helpers'
import type { IntegrationFieldMapping, PushContext, RemoteIssue } from '@/lib/integrations/types'

const mapping: IntegrationFieldMapping = { fields: { ...Object.fromEntries(Object.keys(defaultFieldMapping().fields).map((key) => [key, null])) as IntegrationFieldMapping['fields'], text: 'subject', progress: 'done_ratio', details: 'description' }, extraFields: ['cf_1'] }
const task = (text = 'Base'): ITask => ({ id: 1, text, progress: 20, details: '', cf_1: 'A', externalSource: 'redmine', externalKey: '101' })
const issue = (text = 'Base', key = '101'): RemoteIssue => ({ key, updatedOn: '2026-09-02T00:00:00Z', fields: { subject: text, done_ratio: 20, description: '', cf_1: 'A' } })
const based = () => withBaseline(task(), mapping, '2026-09-01T00:00:00Z')
const makePlan = (tasks = [based()], issues = [issue()], autoPull = false) => planSync({ tasks, issues, links: [], resources: [], mapping, descriptors: [], calendar: defaultCalendarConfig, durationUnit: 'day', autoPull })
const response = (body: unknown) => new Response(JSON.stringify(body))
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('baseline and comparator', () => {
  it.each([true, false])('keeps parent identity stable across resequencing (linked: %s)', async (linked) => {
    const parentMapping = { ...mapping, fields: { ...mapping.fields, parent: 'parent_id' } }
    const identified = ensureSyncIdentities([
      { id: 10, text: 'Parent', ...(linked ? { externalSource: 'redmine', externalKey: '500' } : {}) },
      { ...task(), id: 20, parent: 10 },
      { id: 30, text: 'Other parent', externalSource: 'redmine', externalKey: '600' },
    ])
    const original = identified.map((t) => t.id === 20 ? withBaseline(t, parentMapping, undefined, identified) : t)
    const tasks = resequenceProject([{ id: 50, text: 'Added before parent' }, ...original], [], null).tasks
    const child = tasks.find((t) => t.externalKey === '101')!
    expect(child.parent).toBe(2)
    expect(taskBaseline(child)?.base.parent).toBe(linked ? 'remote:redmine:500' : `local:${identified[0].syncIdentity}`)
    expect(hasLocalChanges(child, parentMapping, tasks)).toBe(false)
    const plan = planSync({ tasks, issues: [], links: [], resources: [], mapping: parentMapping, descriptors: [], calendar: defaultCalendarConfig, durationUnit: 'day' })
    const push = vi.fn()
    const result = await executeSync(plan, {}, push)
    expect(push).not.toHaveBeenCalled()
    expect(hasLocalChanges(result.tasks.find((t) => t.externalKey === '101')!, parentMapping, result.tasks)).toBe(false)
    expect(hasLocalChanges({ ...child, parent: 4 }, parentMapping, tasks)).toBe(true)
    if (linked) {
      const changed = planSync({ tasks, issues: [{ ...issue(), fields: { ...issue().fields, parent_id: '600' } }], links: [], resources: [], mapping: parentMapping, descriptors: [], calendar: defaultCalendarConfig, durationUnit: 'day' })
      expect(changed.conflicts).toEqual([])
      const pulled = await executeSync(changed, {}, push)
      expect(pulled.tasks.find((t) => t.externalKey === '101')?.parent).toBe(4)
    }
  })
  it('requires a matching mapping fingerprint and complete baselines to reuse a cursor', () => {
    const settings = { ...defaultIntegrationSettings(), mapping, syncCursor: issue().updatedOn, syncMappingFingerprint: mappingFingerprint(mapping) }
    expect(syncFetchCursor(settings, [based()])).toBe(settings.syncCursor)
    expect(syncFetchCursor({ ...settings, syncMappingFingerprint: undefined }, [based()])).toBeUndefined()
    expect(syncFetchCursor(settings, [])).toBeUndefined()
    expect(syncFetchCursor(settings, [task()])).toBeUndefined()
    const remapped = { ...mapping, fields: { ...mapping.fields, text: 'cf_2' } }
    expect(syncFetchCursor({ ...settings, mapping: remapped }, [based()])).toBeUndefined()
    expect(syncFetchCursor({ ...settings, mapping: { ...mapping, extraFields: ['cf_1', 'cf_2'] } }, [based()])).toBeUndefined()
    expect(mappingFingerprint({ ...mapping, extraFields: ['cf_2', 'cf_1'] })).toBe(mappingFingerprint({ ...mapping, extraFields: ['cf_1', 'cf_2'] }))
  })
  it.each([[null, ''], [undefined, null], [1.00000001, 1], [new Date(2026, 8, 1), '2026-09-01T00:00:00.000Z']])('normalizes %s and %s', (a, b) => {
    expect(syncEqual(a, b, a instanceof Date ? 'start' : '')).toBe(true)
  })
  it('normalizes resources without sorting ordinary arrays and handles structured values', () => {
    expect(syncEqual([2, 1], [1, 2], 'resources')).toBe(true)
    expect(syncEqual([2, 1], [1, 2])).toBe(false)
    expect(syncEqual({ b: null, a: 1 }, { a: 1, b: '' })).toBe(true)
    expect(syncEqual('bad', 'other', 'end')).toBe(false)
    expect(syncEqual('2026-09-02', '2026-09-01', 'start')).toBe(false)
  })
  it('compares day strings in local time west of UTC', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles')
    expect(syncEqual(new Date(2026, 8, 1), '2026-09-01', 'start')).toBe(true)
  })
  it('snapshots mapped fields and extra values without aliasing or successors', () => {
    const t = based()
    expect(hasLocalChanges(t, mapping)).toBe(false)
    t.cf_1 = 'B'
    expect(hasLocalChanges(t, mapping)).toBe(true)
    expect(taskBaseline(t)?.base.cf_1).toBe('A')
    expect(hasLocalChanges(task(), mapping)).toBe(true)
    expect(hasLocalChanges({ ...t, externalSync: { base: {} } }, mapping)).toBe(true)
    expect(syncFields(defaultFieldMapping()).some((f) => f.field === 'successors')).toBe(false)
    const dated = { ...t, start: new Date(2026, 8, 1), resources: [2, 1] }
    const saved = withBaseline(dated, defaultFieldMapping())
    const restored = JSON.parse(JSON.stringify(saved)) as ITask
    expect(hasLocalChanges(restored, defaultFieldMapping())).toBe(false)
    expect(snapshot(dated, mapping).details).toBe('')
  })
  it('advances only to a valid maximum timestamp', () => {
    expect(maxCursor(undefined, [undefined, 'bad'])).toBeUndefined()
    expect(maxCursor('2026-09-02T00:00:00Z', ['2026-09-01T00:00:00Z', '2026-09-03T00:00:00Z'])).toBe('2026-09-03T00:00:00Z')
  })
})

describe('three-way merge', () => {
  it.each([false, true])('keeps a pulled finish with unmapped Duration and baselines the final schedule (constraint: %s)', async (constraint) => {
    const datesMapping = { ...mapping, fields: { ...mapping.fields, start: 'start_date', end: 'due_date' } }
    const original = withBaseline({ ...task(), start: new Date(2026, 8, 7), end: new Date(2026, 8, 8), duration: 1 }, datesMapping)
    const predecessor = { id: 2, text: 'Predecessor', start: new Date(2026, 8, 10), end: new Date(2026, 8, 11), duration: 1 }
    const tasks = constraint ? [original, predecessor] : [original]
    const links = constraint ? [{ id: 1, source: 2, target: 1, type: 'e2s' }] : []
    const issues = [{ ...issue(), fields: { ...issue().fields, start_date: '2026-09-07', due_date: '2026-09-10' } }]
    const input = { tasks, links, issues, resources: [], descriptors: [], mapping: datesMapping, calendar: defaultCalendarConfig, durationUnit: 'day' as const, autoSchedule: true }
    const plan = planSync(input)
    const push = vi.fn()
    const result = await executeSync(plan, {}, push)
    const merged = mergeSyncTasks(tasks, tasks, result.tasks, datesMapping, { ...plan, acceptedFields: result.acceptedFields })
    expect(merged[0].duration).toBe(4)
    expect(merged[0].start).toEqual(new Date(2026, 8, constraint ? 11 : 7))
    expect(merged[0].end).toEqual(new Date(2026, 8, constraint ? 17 : 11))
    expect(taskBaseline(merged[0])?.base.end).toEqual(merged[0].end)
    expect(hasLocalChanges(merged[0], datesMapping, merged)).toBe(false)
    const again = await executeSync(planSync({ ...input, tasks: merged }), {}, push)
    expect(again.tasks[0].end).toEqual(merged[0].end)
    expect(again.report).toMatchObject({ pushed: 0, pulled: 0, failed: [] })
    expect(push).not.toHaveBeenCalled()
    const concurrent = mergeSyncTasks(tasks, [{ ...tasks[0], text: 'Edited during sync' }, ...tasks.slice(1)], result.tasks, datesMapping, { ...plan, acceptedFields: result.acceptedFields })
    expect(hasLocalChanges(concurrent[0], datesMapping, concurrent)).toBe(true)
  })
  it('conflicts on a remapped field instead of trusting its old baseline, including older remote issues', async () => {
    const remapped = { ...mapping, fields: { ...mapping.fields, text: 'cf_2' } }
    const original = { ...based(), text: 'Local edit' }
    const remote = { ...issue(), updatedOn: '2025-01-01T00:00:00Z', fields: { ...issue().fields, cf_2: 'Older remote value' } }
    const input = { tasks: [original], issues: [remote], links: [], resources: [], mapping: remapped, descriptors: [], calendar: defaultCalendarConfig, durationUnit: 'day' as const }
    const plan = planSync(input)
    expect(plan.conflicts.map((c) => c.field)).toEqual(['text'])
    const push = vi.fn()
    await expect(executeSync(plan, {}, push)).rejects.toThrow('Choose a value')
    expect(push).not.toHaveBeenCalled()
    const auto = await executeSync(planSync({ ...input, autoPull: true }), {}, push)
    expect(taskBaseline(auto.tasks[0])?.mapping?.text).toBe('subject')
    expect(hasLocalChanges(auto.tasks[0], remapped)).toBe(true)
    const resolved = await executeSync(plan, { [plan.conflicts[0].id]: 'remote' }, push)
    expect(resolved.tasks[0].text).toBe('Older remote value')
    expect(hasLocalChanges(resolved.tasks[0], remapped)).toBe(false)
  })
  it('clears obsolete open flags after remote reparenting without mutating the source', async () => {
    const parentMapping = { ...mapping, fields: { ...mapping.fields, parent: 'parent_id' } }
    const [parent, originalChild] = ensureSyncIdentities([{ id: 5, text: 'Former parent', open: true, type: 'summary' }, { ...task(), parent: 5 }])
    const child = withBaseline(originalChild, parentMapping, undefined, [parent, originalChild])
    const tasks = [parent, child]
    const plan = planSync({ tasks, issues: [{ ...issue(), fields: { ...issue().fields, parent_id: null } }], links: [], resources: [], mapping: parentMapping, descriptors: [], calendar: defaultCalendarConfig, durationUnit: 'day' })
    const result = await executeSync(plan, {}, vi.fn())
    expect(result.tasks[0].open).toBeUndefined()
    const merged = mergeSyncTasks(tasks, tasks, result.tasks, parentMapping)
    expect(merged[0].open).toBeUndefined()
    expect(merged[1].parent).toBeUndefined()
    expect(parent.open).toBe(true)
  })
  it.each([true, false])('reschedules unfetched and local successors only with auto-schedule enabled (%s)', async (autoSchedule) => {
    const datesMapping = { ...mapping, fields: { ...mapping.fields, start: 'start_date', end: 'due_date' } }
    const predecessor = withBaseline({ ...task(), start: new Date(2026, 8, 7), end: new Date(2026, 8, 8), duration: 1 }, datesMapping)
    const successor = withBaseline({ ...task(), id: 2, externalKey: '102', start: new Date(2026, 8, 8), end: new Date(2026, 8, 9), duration: 1 }, datesMapping)
    const local = { id: 3, text: 'Local', start: new Date(2026, 8, 9), end: new Date(2026, 8, 10), duration: 1 }
    const tasks = [predecessor, successor, local]
    const links = [{ id: 1, source: 1, target: 2, type: 'e2s' }, { id: 2, source: 2, target: 3, type: 'e2s' }]
    const plan = planSync({ tasks, links, resources: [], issues: [{ ...issue(), fields: { ...issue().fields, start_date: '2026-09-10', due_date: '2026-09-10' } }], descriptors: [], mapping: datesMapping, calendar: defaultCalendarConfig, durationUnit: 'day', autoSchedule })
    const result = await executeSync(plan, {}, vi.fn())
    const merged = mergeSyncTasks(tasks, tasks, result.tasks, datesMapping, plan)
    expect(merged[1].start).toEqual(new Date(2026, 8, autoSchedule ? 11 : 8))
    expect(merged[2].start).toEqual(new Date(2026, 8, autoSchedule ? 14 : 9))
    expect(result.tasks[1].start).toEqual(merged[1].start)
  })
  it.each(['Environment', ''])('uses task labels and custom labels with a missing-label fallback (%s)', (label) => {
    const plan = planSync({ tasks: [{ ...based(), text: 'Local', cf_1: 'Local' }], issues: [{ ...issue('Remote'), fields: { ...issue('Remote').fields, cf_1: 'Remote' } }],
      links: [], resources: [], mapping, descriptors: [{ key: 'cf_1', label, kind: 'custom', valueType: 'string' }], calendar: defaultCalendarConfig, durationUnit: 'day' })
    expect(plan.conflicts.map(({ field, fieldLabel }) => ({ field, fieldLabel }))).toEqual([
      { field: 'text', fieldLabel: 'Task Name' }, { field: 'cf_1', fieldLabel: label || 'cf_1' },
    ])
    expect(makePlan().conflicts).toEqual([])
  })
  it.each([
    ['local-only', 'Local', 'Base', 'Local', 1, 0],
    ['remote-only', 'Base', 'Remote', 'Remote', 0, 1],
    ['both equal', 'Same', 'Same', 'Same', 0, 0],
    ['unchanged', 'Base', 'Base', 'Base', 0, 0],
  ])('%s', async (_name, local, remote, expected, pushed, pulled) => {
    const t = { ...based(), text: String(local) }
    const plan = makePlan([t], [issue(String(remote))])
    expect(plan.conflicts).toEqual([])
    const push = vi.fn(async () => {})
    const result = await executeSync(plan, {}, push)
    expect(result.tasks[0].text).toBe(expected)
    expect(result.report).toMatchObject({ pushed, pulled, failed: [] })
    expect(hasLocalChanges(result.tasks[0], mapping)).toBe(false)
    expect(push).toHaveBeenCalledTimes(Number(pushed))
    if (pushed) expect(push.mock.calls[0]).toEqual(['101', expect.objectContaining({ text: expected }), new Set(['subject'])])
  })
  it.each(['local', 'remote'] as const)('resolves both-changed with %s', async (choice) => {
    const plan = makePlan([{ ...based(), text: 'Local' }], [issue('Remote')])
    expect(plan.conflicts).toHaveLength(1)
    const push = vi.fn(async () => {})
    await expect(executeSync(plan, {}, push)).rejects.toThrow('Choose a value')
    expect(push).not.toHaveBeenCalled()
    expect(plan.tasks[0].text).toBe('Local')
    const result = await executeSync(plan, { [plan.conflicts[0].id]: choice }, push)
    expect(result.tasks[0].text).toBe(choice === 'local' ? 'Local' : 'Remote')
    expect(result.report.conflictsResolved).toBe(1)
    expect(hasLocalChanges(result.tasks[0], mapping)).toBe(false)
  })
  it('treats differing legacy fields as conflicts and equal fields as synchronized', async () => {
    const plan = makePlan([task()], [issue('Different')])
    expect(plan.conflicts.map((c) => c.field)).toEqual(['text'])
    const equal = await executeSync(makePlan([task()], [issue()]), {}, vi.fn())
    expect(hasLocalChanges(equal.tasks[0], mapping)).toBe(false)
  })
  it('pushes local dirty fields even when absent from the incremental response', async () => {
    const push = vi.fn(async () => {})
    const result = await executeSync(makePlan([{ ...based(), text: 'Local' }], []), {}, push)
    expect(result.report.pushed).toBe(1)
    expect(taskBaseline(result.tasks[0])?.updatedOn).toBe('2026-09-01T00:00:00Z')
    expect(hasLocalChanges(result.tasks[0], mapping)).toBe(false)
    const legacy = await executeSync(makePlan([task()], []), {}, push)
    expect(hasLocalChanges(legacy.tasks[0], mapping)).toBe(true)
  })
  it('inserts new issues with baselines, pulls relations, and is idempotent', async () => {
    const plan = makePlan([], [issue('New', '102')])
    const result = await executeSync(plan, {}, vi.fn())
    expect(result.report.inserted).toBe(1)
    expect(taskBaseline(result.tasks[0])?.updatedOn).toBe(issue().updatedOn)
    expect(hasLocalChanges(result.tasks[0], mapping)).toBe(false)
    const repeat = await executeSync(makePlan(result.tasks, [issue('New', '102')]), {}, vi.fn())
    expect(repeat.report).toMatchObject({ inserted: 0, pushed: 0, pulled: 0 })
    expect((await executeSync(makePlan([], []), {}, vi.fn())).tasks).toEqual([])
  })
  it('keeps failed tasks and their baseline unchanged, then retries dirty fields', async () => {
    const original = { ...based(), text: 'Local' }
    const remote = issue(); remote.fields.done_ratio = 40
    const failed = await executeSync(makePlan([original], [remote]), {}, async () => { throw new Error('422 validation failed') })
    expect(failed.report.failed).toEqual([{ key: '101', task: 'Local', error: '422 validation failed' }])
    expect(failed.tasks[0]).toBe(original)
    expect(hasLocalChanges(failed.tasks[0], mapping)).toBe(true)
    const retried = await executeSync(makePlan(failed.tasks, [remote]), {}, vi.fn(async () => {}))
    expect(retried.report).toMatchObject({ pushed: 1, pulled: 1, failed: [] })
    expect(hasLocalChanges(retried.tasks[0], mapping)).toBe(false)
    const rawError = await executeSync(makePlan([original], []), {}, async () => { throw 'offline' })
    expect(rawError.report.failed[0].error).toBe('offline')
  })
  it('limits concurrent pushes to four', async () => {
    let active = 0; let max = 0
    const tasks = Array.from({ length: 9 }, (_, i) => ({ ...based(), id: i + 1, externalKey: String(i), text: 'Dirty' }))
    const result = await executeSync(makePlan(tasks, []), {}, async () => {
      active++; max = Math.max(max, active)
      await new Promise((resolve) => setTimeout(resolve, 1))
      active--
    })
    expect(max).toBe(4)
    expect(result.report.pushed).toBe(9)
  })
  it('auto-pull skips dirty fields, applies clean remote changes and never pushes', async () => {
    const original = { ...based(), text: 'Local' }
    const remote = issue('Remote'); remote.fields.done_ratio = 40
    const plan = makePlan([original], [remote], true)
    expect(plan.conflicts).toHaveLength(1)
    const push = vi.fn()
    const result = await executeSync(plan, {}, push)
    expect(push).not.toHaveBeenCalled()
    expect(result.tasks[0]).toMatchObject({ text: 'Local', progress: 40 })
    expect(taskBaseline(result.tasks[0])?.base.text).toBe('Base')
    expect(hasLocalChanges(result.tasks[0], mapping)).toBe(true)
    const skipped = await executeSync(makePlan([original], [issue()], true), {}, push)
    expect(skipped.tasks[0].text).toBe('Local')
  })
  it('preserves edits made during a request and does not resurrect deleted tasks', () => {
    const original = based()
    const result = withBaseline({ ...original, text: 'Synced' }, mapping)
    const current = { ...original, text: 'Edited while syncing', details: 'Local note' }
    const merged = mergeSyncTasks([original], [current, { id: 2, text: 'New local' }], [result, { id: 3, text: 'Inserted' }], mapping)
    expect(merged[0]).toMatchObject({ text: current.text, details: current.details })
    expect(hasLocalChanges(merged[0], mapping)).toBe(true)
    expect(merged.map((t) => t.id)).toEqual([1, 2, 3])
    expect(mergeSyncTasks([original], [], [result], mapping)).toEqual([])
    expect(mergeSyncTasks([original], [original], [], mapping)).toEqual([original])
  })
  it('records baselines on every full Get task', () => {
    const result = applyRemoteIssues([issue()], [], mapping, { tasks: [], links: [], resources: [] }, 'redmine', defaultCalendarConfig, 'day', false)
    if (result.kind !== 'success') throw new Error('Expected task')
    expect(taskBaseline(result.tasks[0])?.base.text).toBe('Base')
    expect(hasLocalChanges(result.tasks[0], mapping)).toBe(false)
  })

  it('keeps an overlapping scheduled full Get idempotent, including weekend finishes', async () => {
    const fullMapping = defaultFieldMapping()
    const issues = [{ ...issue(), fields: { ...issue().fields, start_date: '2026-09-10', due_date: '2026-09-12', estimated_hours: 24 } }]
    const descriptors = [{ key: 'estimated_hours', kind: 'standard' as const, valueType: 'hours' as const, label: 'Hours' }]
    const get = applyRemoteIssues(issues, descriptors, fullMapping, { tasks: [], links: [], resources: [] }, 'redmine', defaultCalendarConfig, 'day', true)
    if (get.kind !== 'success') throw new Error('Expected task')
    const plan = planSync({ ...get, issues, descriptors, mapping: fullMapping, calendar: defaultCalendarConfig, durationUnit: 'day', autoSchedule: true })
    const result = await executeSync(plan, {}, vi.fn())
    expect(plan.conflicts).toEqual([])
    expect(result.report).toMatchObject({ pulled: 0, pushed: 0, inserted: 0 })
  })
})

describe('incremental provider', () => {
  it('accepts dirty standard name fields and sends only their writable ID keys', async () => {
    const fetch = vi.fn(async () => new Response(''))
    vi.stubGlobal('fetch', fetch)
    const context = { ...ctx, mapping: { ...ctx.mapping, extraFields: ['status', 'fixed_version', 'tracker', 'priority'] },
      remoteMeta: { ...ctx.remoteMeta, statuses: [{ id: 2, name: 'Active' }], versions: [{ id: 3, name: 'Release' }], trackers: [{ id: 4, name: 'Bug' }], priorities: [{ id: 5, name: 'High' }] } }
    await createRedmineProvider(settings).updateIssue('101', { ...task(), status: 'Active', fixed_version: 'Release', tracker: 'Bug', priority: 'High' }, context, new Set(context.mapping.extraFields))
    expect(JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ issue: { status_id: 2, fixed_version_id: 3, tracker_id: 4, priority_id: 5 } })
  })
  const settings = { ...defaultIntegrationSettings(), baseUrl: 'https://redmine.test', projectIdentifier: 'demo' }
  const ctx: PushContext = { mapping: defaultFieldMapping(), descriptors: [], resources: [], keyByTaskId: new Map(), remoteMeta: { trackers: [], members: [], statuses: [], priorities: [], versions: [] }, workingHoursPerDay: 8, durationUnit: 'day' }
  it('encodes the inclusive cursor and ordering on every page and exposes updatedOn', async () => {
    const urls: URL[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(new URL(url))
      return response({ issues: [{ id: urls.length, subject: 'Task', updated_on: issue().updatedOn }], total_count: 2 })
    }))
    const issues = await createRedmineProvider(settings).fetchIssues({ updatedSince: '2026-09-01T12:00:00Z' })
    expect(issues).toHaveLength(2)
    for (const url of urls) {
      expect(url.searchParams.get('updated_on')).toBe('>=2026-09-01T12:00:00Z')
      expect(url.searchParams.get('sort')).toBe('updated_on:asc,id:asc')
      expect(url.searchParams.get('status_id')).toBe('*')
      expect(url.searchParams.get('project_id')).toBe('demo')
    }
    expect(urls[1].searchParams.get('offset')).toBe('1')
    expect(issues[0].updatedOn).toBe(issue().updatedOn)
  })
  it('sends only selected dirty remote keys, including custom fields', async () => {
    const fetch = vi.fn(async () => new Response(''))
    vi.stubGlobal('fetch', fetch)
    const provider = createRedmineProvider(settings)
    const context = { ...ctx, mapping: { ...ctx.mapping, extraFields: ['cf_1', 'cf_2', 'status'] } }
    await provider.updateIssue('101', { ...task(), cf_2: 'B' }, context, new Set(['subject', 'cf_1']))
    expect(JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ issue: { subject: 'Base', custom_fields: [{ id: 1, value: 'A' }] } })
    await provider.updateIssue('101', task(), ctx, new Set())
    expect(fetch).toHaveBeenCalledTimes(1)
    await provider.updateIssue('101', task(), ctx, new Set(['assigned_to', 'parent_id']))
    expect(JSON.parse(String((fetch.mock.calls[1] as unknown as [string, RequestInit])[1].body))).toEqual({ issue: { assigned_to_id: '', parent_issue_id: '' } })
    await expect(provider.updateIssue('101', task(), context, new Set(['author']))).rejects.toThrow('no writable')
    await expect(provider.updateIssue('101', task(), ctx, new Set(['subject', 'start_date']))).rejects.toThrow('start_date')
    const customContext: PushContext = { ...ctx, mapping: { ...ctx.mapping, fields: { ...ctx.mapping.fields, resources: 'cf_3', parent: 'cf_4' } }, descriptors: [{ key: 'cf_3', label: 'Users', kind: 'custom', valueType: 'user', multiple: true }] }
    await provider.updateIssue('101', task(), customContext, new Set(['cf_3', 'cf_4']))
    expect(JSON.parse(String((fetch.mock.calls[2] as unknown as [string, RequestInit])[1].body))).toEqual({ issue: { custom_fields: [{ id: 3, value: [] }, { id: 4, value: '' }] } })
  })

  it('sets a baseline after create and retains successful creates before a failure', async () => {
    const created: ITask[] = []
    const context = { ...ctx, mapping, keyByTaskId: new Map<string, string>() }
    const provider = { createIssue: vi.fn().mockResolvedValueOnce('200').mockRejectedValueOnce(new Error('422')) }
    const parent = { id: 1, text: 'Parent', progress: 0 }
    await expect(pushNewTasks([parent, { id: 2, text: 'Child', parent: 1 }], provider, context, (t) => created.push(t))).rejects.toThrow('422')
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ externalKey: '200', externalSource: 'redmine' })
    expect(hasLocalChanges(created[0], mapping)).toBe(false)
    expect(context.keyByTaskId.get('1')).toBe('200')
    parent.text = 'Edited during create'
    expect(taskBaseline(created[0])?.base.text).toBe('Parent')
  })
})
