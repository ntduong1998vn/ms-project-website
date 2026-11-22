import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ILink, ITask } from '@svar-ui/react-gantt'
import { defaultFieldMapping } from '@/lib/integrations/fields'
import { defaultCalendarConfig } from '@/lib/scheduler'
import { hasLocalChanges, mappingFingerprint, syncFetchCursor, taskBaseline, withBaseline } from '@/lib/integrations/baseline'
import { executeSync, planSync } from '@/lib/integrations/two-way'
import { applyRemoteIssues } from '@/lib/integrations/sync'
import { applyRelations, localRelations, pushRelations, relationsEqual } from '@/lib/integrations/relations'
import { createRedmineProvider } from '@/lib/integrations/redmine/client'
import { defaultIntegrationSettings } from '@/lib/integrations/settings'
import type { RemoteRelation } from '@/lib/integrations/types'

const mapping = { fields: { ...defaultFieldMapping().fields, start: null, end: null, duration: null, progress: null, details: null, parent: null, resources: null }, extraFields: [] }
const tasks: ITask[] = [1, 2, 3].map((id) => ({ id, text: `Task ${id}`, externalSource: 'redmine', externalKey: String(100 + id) }))
const link: ILink = { id: 1, source: 1, target: 2, type: 'e2s', lag: 2 }
const plan = (base: RemoteRelation[], links: ILink[], remote?: RemoteRelation[], autoPull = false) => planSync({
  tasks: tasks.map((task) => withBaseline(task, mapping, undefined, tasks, task.id === 1 ? base : [])), links, resources: [],
  issues: remote === undefined ? [] : [{ key: '101', fields: { subject: 'Task 1', successors: remote } }], descriptors: [], mapping, calendar: defaultCalendarConfig, durationUnit: 'day', autoPull,
})
const provider = () => ({ createRelation: vi.fn(async (_key: string, row: RemoteRelation) => ({ ...row, id: 99 })), deleteRelation: vi.fn(async () => {}) })
afterEach(() => vi.unstubAllGlobals())

describe('two-way successor relations', () => {
  it.each([false, true])('imports links to newly discovered successor tasks without deleting remote relations (source fetched: %s)', async (fetched) => {
    const rows = [{ id: 8, key: '999', delay: 2 }]
    const initial = plan(rows, [])
    const pending = planSync({ ...initial, issues: [
      ...(fetched ? [{ key: '101', fields: { subject: 'Task 1', successors: rows } }] : []),
      { key: '999', fields: { subject: 'New successor', successors: [] } },
    ], descriptors: [] })
    const p = provider()
    const push = vi.fn()
    const result = await executeSync(pending, {}, push, p)
    const target = result.tasks.find((task) => task.externalKey === '999')!
    expect(result.links).toContainEqual(expect.objectContaining({ source: 1, target: target.id, lag: 2 }))
    expect(taskBaseline(result.tasks[0])?.relations).toEqual(rows)
    expect(hasLocalChanges(result.tasks[0], mapping, result.tasks, result.links)).toBe(false)
    expect(result.report.failed).toEqual([])
    expect(p.deleteRelation).not.toHaveBeenCalled()
    expect(p.createRelation).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
    expect(initial.links).toEqual([])
  })
  it('keeps out-of-project relation IDs without deleting them and accepts unchanged links', async () => {
    const remote = [{ id: 8, key: '999', delay: 0 }]
    const p = provider()
    const pending = plan(remote, [], remote)
    const result = await executeSync(pending, {}, vi.fn(), p)
    expect(taskBaseline(result.tasks[0])?.relations).toEqual(remote)
    expect(result.report.skipped).toHaveLength(1)
    expect(result.report.pushed).toBe(0)
    expect(p.deleteRelation).not.toHaveBeenCalled()
    expect(hasLocalChanges(result.tasks[0], mapping, result.tasks, result.links)).toBe(false)
  })
  it('forces a full fetch until legacy relation baselines are available', () => {
    const settings = { ...defaultIntegrationSettings(), mapping, syncCursor: '2026-01-01', syncMappingFingerprint: mappingFingerprint(mapping) }
    const linked = plan([], []).tasks
    expect(syncFetchCursor(settings, linked)).toBe('2026-01-01')
    delete linked[0].externalSync!.relationsMapping
    expect(syncFetchCursor(settings, linked)).toBeUndefined()
  })
  it('adds a local relation and keeps its remote ID in a clean baseline', async () => {
    const p = provider()
    const result = await executeSync(plan([], [link], []), {}, vi.fn(), p)
    expect(p.createRelation).toHaveBeenCalledWith('101', { key: '102', delay: 2 })
    expect(result.report).toMatchObject({ pushed: 1, relationsAdded: 1, relationsRemoved: 0, failed: [] })
    expect(taskBaseline(result.tasks[0])?.relations).toEqual([{ key: '102', delay: 2, id: 99 }])
    expect(hasLocalChanges(result.tasks[0], mapping, result.tasks, result.links)).toBe(false)
  })
  it('removes remote relations by ID and retries partial failures idempotently', async () => {
    const base = [{ id: 8, key: '102', delay: 2 }]
    const p = provider()
    p.deleteRelation.mockRejectedValueOnce(new Error('Redmine 422'))
    const initial = plan(base, [], base)
    const failed = await executeSync(initial, {}, vi.fn(), p)
    expect(failed.report.failed[0].error).toContain('422')
    expect(taskBaseline(failed.tasks[0])?.relations).toEqual(base)
    const result = await executeSync(initial, {}, vi.fn(), p)
    expect(p.deleteRelation).toHaveBeenCalledWith(8)
    expect(result.report.relationsRemoved).toBe(1)
    expect(taskBaseline(result.tasks[0])?.relations).toEqual([])
    expect(relationsEqual([{ id: 1, key: '102', delay: 2 }], [{ id: 9, key: '102', delay: 2 }])).toBe(true)
  })
  it.each(['local', 'remote'] as const)('resolves successor conflicts with %s', async (choice) => {
    const p = provider()
    const pending = plan([], [link], [{ id: 8, key: '103', delay: 0 }])
    expect(pending.conflicts[0].fieldLabel).toBe('Successors')
    await expect(executeSync(pending, {}, vi.fn(), p)).rejects.toThrow('Choose a value')
    const result = await executeSync(pending, { [pending.conflicts[0].id]: choice }, vi.fn(), p)
    expect(result.report.conflictsResolved).toBe(1)
    expect(result.links[0].target).toBe(choice === 'local' ? 2 : 3)
    expect(p.createRelation).toHaveBeenCalledTimes(choice === 'local' ? 1 : 0)
  })
  it('pulls remote-only relations, skips dirty auto-pull conflicts, and handles legacy tasks', async () => {
    const p = provider()
    const remote = [{ id: 8, key: '103', delay: 1 }]
    const pulled = await executeSync(plan([], [], remote), {}, vi.fn(), p)
    expect(pulled.links[0]).toMatchObject({ source: 1, target: 3, lag: 1 })
    const auto = await executeSync(plan([], [link], remote, true), {}, vi.fn(), p)
    expect(auto.links).toEqual([link])
    expect(taskBaseline(auto.tasks[0])?.relations).toEqual([])
    expect(p.createRelation).not.toHaveBeenCalled()
    const legacy = plan([], [link], remote)
    delete legacy.tasks[0].externalSync
    const legacyPlan = planSync({ ...legacy, issues: [{ key: '101', fields: { subject: 'Task 1', successors: remote } }], descriptors: [] })
    expect(legacyPlan.conflicts.some((row) => row.field === 'successors')).toBe(true)
  })
  it('reports skipped unlinked, unsupported and fractional-lag links without removing them', async () => {
    const pending = plan([], [{ ...link, target: 999 }, { ...link, id: 2, type: 's2s' }, { ...link, id: 3, lag: 0.5 }, { ...link, id: 4, source: 999 }], [])
    const p = provider()
    const result = await executeSync(pending, {}, vi.fn(), p)
    expect(result.report.skipped).toHaveLength(4)
    expect(result.links).toEqual(pending.links)
    expect(p.createRelation).not.toHaveBeenCalled()
    expect(localRelations(tasks[0], tasks, [{ ...link, lag: 16 }], 8, 'hour').relations[0].delay).toBe(2)
    expect(applyRelations([], tasks[0], tasks, [{ key: '102', delay: 2 }], 8, 'hour')[0].lag).toBe(16)
  })
  it.each([{ type: 's2s' as const }, { lag: 0.5 }])('never writes a previously synced relation after an unwritable edit: %o', async (edit) => {
    const base = [{ id: 8, key: '102', delay: 2 }]
    const edited = { ...link, ...edit }
    for (const remote of [undefined, base, []]) {
      const p = provider()
      const push = vi.fn()
      const result = await executeSync(plan(base, [edited], remote), {}, push, p)
      expect(p.deleteRelation).not.toHaveBeenCalled()
      expect(p.createRelation).not.toHaveBeenCalled()
      expect(push).not.toHaveBeenCalled()
      expect(result.links).toEqual([edited])
      expect(taskBaseline(result.tasks[0])?.relations).toEqual(base)
      expect(result.report.skipped).toHaveLength(1)
      expect(hasLocalChanges(result.tasks[0], mapping, result.tasks, result.links)).toBe(true)
    }
  })
  it('preserves remote IDs on full Get and rejects removals without IDs', async () => {
    const rows = [{ id: 8, key: '102', delay: 2 }]
    const result = applyRemoteIssues([{ key: '101', fields: { subject: 'Task 1', successors: rows } }], [], mapping, { tasks, links: [], resources: [] }, 'redmine', defaultCalendarConfig, 'day', false)
    if (result.kind !== 'success') throw new Error('Expected success')
    expect(taskBaseline(result.tasks[0])?.relations).toEqual(rows)
    await expect(pushRelations('101', [], [{ key: '102', delay: 0 }], provider())).rejects.toThrow('Missing Redmine relation ID')
  })
  it('uses Redmine relation create/delete endpoints', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ relation: { id: 9 } })))
    vi.stubGlobal('fetch', fetch)
    const p = createRedmineProvider({ ...defaultIntegrationSettings(), baseUrl: 'https://redmine.test' })
    await p.createRelation('101', { key: '102', delay: 2 })
    await p.deleteRelation(9)
    const calls = fetch.mock.calls as unknown as Array<[string, RequestInit]>
    expect(calls[0][0]).toBe('https://redmine.test/issues/101/relations.json')
    expect(JSON.parse(String(calls[0][1].body))).toEqual({ relation: { issue_to_id: 102, relation_type: 'precedes', delay: 2 } })
    expect(calls[1]).toEqual(['https://redmine.test/relations/9.json', expect.objectContaining({ method: 'DELETE' })])
  })
})
