import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRedmineProvider } from '@/lib/integrations/redmine/client'
import { customFieldDescriptor, importCustomFieldSchema } from '@/lib/integrations/redmine/schema'
import { applyIntegrationMetadata, defaultIntegrationSettings, effectiveFields, invalidateIntegrationMetadata, loadIntegrationSettings } from '@/lib/integrations/settings'
import { applyRemoteIssues } from '@/lib/integrations/sync'
import { buildIssuePayload } from '@/lib/integrations/redmine/fields'
import { defaultCalendarConfig } from '@/lib/scheduler'
import type { RemoteProjectMetadata } from '@/lib/integrations/types'

const settings = () => ({ ...defaultIntegrationSettings(), baseUrl: 'https://redmine.test', projectIdentifier: 'demo' })
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const metadata = (): RemoteProjectMetadata => ({ warnings: [], fields: [], trackers: [], statuses: [], priorities: [], versions: [], members: [] })
afterEach(() => vi.unstubAllGlobals())

describe('non-admin discovery', () => {
  it('unions project IDs with all issue pages, infers types/options, and paginates memberships and projects', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      urls.push(input)
      const url = new URL(input)
      const offset = Number(url.searchParams.get('offset'))
      if (url.pathname === '/custom_fields.json') return response({}, 403)
      if (url.pathname === '/projects/demo.json') {
        expect(url.searchParams.get('include')).toBe('trackers,issue_custom_fields')
        return response({ project: { trackers: [{ id: 1, name: 'Task' }], issue_custom_fields: [{ id: 99, name: 'Unseen' }] } })
      }
      if (url.pathname.endsWith('/memberships.json')) return response({ memberships: [{ user: { id: offset + 1, name: 'Member' } }], total_count: 2 })
      if (url.pathname === '/projects.json') return response({ projects: [{ id: offset + 1, identifier: 'p' + offset, name: 'Project' }], total_count: 2 })
      if (url.pathname === '/issues.json') return response({ issues: [{ custom_fields: [
        { id: 1, name: 'Score', value: offset ? '42.5' : ' ' },
        { id: 2, name: 'Date', value: '2026-09-01' },
        { id: 3, name: 'Tags', value: offset ? ['beta', 'gamma'] : ['alpha'] },
        { id: 4, name: 'Mixed', value: offset ? 'text' : '12' },
        { id: 5, name: 'Empty', value: '' },
      ] }], total_count: 2 })
      return response({})
    }))
    const provider = createRedmineProvider(settings())
    const meta = await provider.fetchProjectMetadata()
    expect(meta.members).toHaveLength(2)
    expect(meta.trackers).toEqual([{ id: 1, name: 'Task' }])
    expect(meta.warnings).toHaveLength(1)
    expect(meta.warnings.join(' ')).not.toContain('Redmine 403')
    expect(meta.warnings.join(' ')).toContain('inferred from issues')
    expect(meta.fields.find((f) => f.key === 'cf_99')).toMatchObject({ valueType: 'string', label: 'Unseen (custom)' })
    expect(meta.fields.find((f) => f.key === 'cf_1')).toMatchObject({ valueType: 'number', options: undefined })
    expect(meta.fields.find((f) => f.key === 'cf_2')).toMatchObject({ valueType: 'date', options: undefined })
    expect(meta.fields.find((f) => f.key === 'cf_3')).toMatchObject({ multiple: true, options: [{ id: 'alpha' }, { id: 'beta' }, { id: 'gamma' }] })
    expect(meta.fields.find((f) => f.key === 'cf_4')?.valueType).toBe('string')
    expect(meta.fields.find((f) => f.key === 'cf_5')?.options).toBeUndefined()
    expect(await provider.listProjects()).toHaveLength(2)
    expect(urls.some((u) => u.includes('/issues.json') && u.includes('offset=1'))).toBe(true)
  })

  it('caps inference at 2000 issues and discards option sets larger than 30', async () => {
    let pages = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/custom_fields')) return response({}, 403)
      if (url.includes('/issues.json')) {
        const offset = Number(new URL(url).searchParams.get('offset'))
        pages++
        return response({ issues: Array.from({ length: 100 }, (_, i) => ({ custom_fields: [{ id: 1, name: 'Many', value: 'v' + (offset + i) }] })), total_count: 2100 })
      }
      return response({})
    }))
    const meta = await createRedmineProvider(settings()).fetchProjectMetadata()
    expect(pages).toBe(20)
    expect(meta.warnings.join(' ')).toContain('2000')
    expect(meta.fields.find((f) => f.key === 'cf_1')?.options).toBeUndefined()
  })

  it('uses typed admin schema without harvesting and reports individual metadata errors', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.includes('/custom_fields')) return response({ custom_fields: [{ id: 1, name: 'Number', field_format: 'float' }] })
      if (url.includes('/memberships')) return response('Forbidden', 403)
      return response({})
    })
    vi.stubGlobal('fetch', fetch)
    const meta = await createRedmineProvider(settings()).fetchProjectMetadata()
    expect(meta.fields.find((f) => f.key === 'cf_1')?.valueType).toBe('number')
    expect(meta.warnings.join(' ')).toContain('Memberships: Redmine 403')
    expect(fetch.mock.calls.some(([url]) => url.includes('/issues.json'))).toBe(false)
  })

  it('handles empty pages and propagates project-list errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ projects: [], total_count: 2 })))
    expect(await createRedmineProvider(settings()).listProjects()).toEqual([])
    vi.stubGlobal('fetch', vi.fn(async () => response({}, 403)))
    await expect(createRedmineProvider(settings()).listProjects()).rejects.toThrow('403')
    const meta = await createRedmineProvider(settings()).fetchProjectMetadata()
    expect(meta.warnings.join(' ')).toContain('Issue field inference')
  })

  it('preserves raw schema warnings for non-403 failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/custom_fields.json')
      ? response('Server unavailable', 500) : response({})))
    const meta = await createRedmineProvider(settings()).fetchProjectMetadata()
    expect(meta.warnings).toContain('Custom field schema: Redmine 500: "Server unavailable"')
    expect(meta.warnings.join(' ')).toContain('inferred from issues')
  })
})

describe('schema and effective fields', () => {
  it('imports issue schemas with shared format mappings and options', () => {
    const formats = ['int', 'float', 'date', 'user', 'version', 'list', 'bool', 'text']
    const fields = importCustomFieldSchema(JSON.stringify({ custom_fields: formats.map((field_format, id) => ({ id: id + 1, name: field_format, field_format, multiple: id === 5 ? '1' : false })) }))
    expect(fields.map((f) => f.valueType)).toEqual(['number', 'number', 'date', 'user', 'string', 'string', 'string', 'string'])
    expect(fields[5].multiple).toBe(true)
    expect(fields[6].options).toEqual([{ id: '1', label: 'Yes' }, { id: '0', label: 'No' }])
    expect(customFieldDescriptor({ id: 2, name: 'List', possible_values: [{ value: 'a' }, { value: 'b', label: 'Bee' }] }).options).toEqual([{ id: 'a', label: 'a' }, { id: 'b', label: 'Bee' }])
    expect(importCustomFieldSchema('{"custom_fields":[{"id":1,"name":"Project","customized_type":"project"}]}')).toEqual([])
    expect(importCustomFieldSchema('{"custom_fields":[]}')).toEqual([])
  })

  it.each(['broken', '{}', 'null', '{"custom_fields":[{}]}', '{"custom_fields":[{"id":0,"name":"x"}]}', '{"custom_fields":[{"id":1,"name":"x","possible_values":[{}]}]}'])('rejects malformed schemas: %s', (json) => {
    expect(() => importCustomFieldSchema(json)).toThrow()
  })

  it('merges manual descriptors and overrides without mutating settings; loads legacy defaults', () => {
    const s = settings()
    s.manualFields = [customFieldDescriptor({ id: 1, name: 'Manual' })]
    s.fieldOverrides = { cf_1: { label: 'Score', valueType: 'number', multiple: true, options: ['a', 'b'] } }
    const f = effectiveFields(s)
    expect(f.some((v) => v.key === 'subject')).toBe(true)
    expect(f.find((v) => v.key === 'cf_1')).toMatchObject({ label: 'Score', valueType: 'number', multiple: true, options: [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }] })
    expect(s.manualFields[0].label).toBe('Manual (custom)')
    s.knownFields = [customFieldDescriptor({ id: 1, name: 'Known' })]
    s.fieldOverrides = { cf_1: { label: 'Override' } }
    expect(effectiveFields(s)).toHaveLength(1)
    expect(effectiveFields(s)[0].label).toBe('Override')
    vi.stubGlobal('localStorage', { getItem: () => '{"baseUrl":"https://old"}' })
    expect(loadIntegrationSettings()).toMatchObject({ manualFields: [], fieldOverrides: {}, baseUrl: 'https://old' })
  })

  it('invalidates connection cache and prunes unknown custom mappings after discovery', () => {
    const s = settings()
    s.knownFields = [customFieldDescriptor({ id: 1, name: 'Old' })]
    s.mapping.fields.progress = 'cf_1'
    s.mapping.extraFields = ['cf_1', 'cf_2', 'status']
    s.trackerId = 9
    s.manualFields = [customFieldDescriptor({ id: 3, name: 'Manual' })]
    s.fieldOverrides = { cf_1: { valueType: 'number' } }
    expect(invalidateIntegrationMetadata(s, { projectIdentifier: 'demo' })).toEqual(s)
    expect(invalidateIntegrationMetadata(s, { apiKey: 'new' })).toEqual({ ...s, apiKey: 'new' })
    for (const patch of [{ baseUrl: 'https://new' }, { projectIdentifier: 'new' }]) {
      const invalid = invalidateIntegrationMetadata(s, patch)
      expect(invalid).toMatchObject({ knownFields: [], manualFields: [], fieldOverrides: {}, trackerId: null })
      const meta = metadata()
      meta.fields = [customFieldDescriptor({ id: 2, name: 'New' })]
      const applied = applyIntegrationMetadata(invalid, meta)
      expect(applied.mapping.fields.progress).toBeNull()
      expect(applied.mapping.fields.text).toBe('subject')
      expect(applied.mapping.extraFields).toEqual(['cf_2', 'status'])
    }
    expect(s.knownFields).toHaveLength(1)
  })
})

describe('typed custom field roundtrip', () => {
  it('pulls numeric strings/date fields and pushes numeric duration without hours conversion or visibility', () => {
    const s = settings()
    s.manualFields = [customFieldDescriptor({ id: 1, name: 'Duration', field_format: 'float' }), customFieldDescriptor({ id: 2, name: 'Progress', field_format: 'int' }), customFieldDescriptor({ id: 3, name: 'Start', field_format: 'date' })]
    s.mapping.fields.duration = 'cf_1'; s.mapping.fields.progress = 'cf_2'; s.mapping.fields.start = 'cf_3'; s.mapping.fields.end = null
    s.mapping.extraFields = ['cf_1', 'cf_4']
    const result = applyRemoteIssues([{ key: '1', fields: { subject: 'Typed', cf_1: '3', cf_2: '42.5', cf_3: '2026-09-07', cf_4: 'hidden' } }], effectiveFields(s), s.mapping, { tasks: [], links: [], resources: [] }, 'redmine', defaultCalendarConfig, 'day', false)
    expect(result.kind).toBe('success')
    if (result.kind !== 'success') return
    const task = result.tasks[0]
    expect(task.duration).toBe(3)
    expect(task.progress).toBe(42.5)
    expect(task.start?.getFullYear()).toBe(2026)
    const payload = buildIssuePayload(task, { mapping: s.mapping, descriptors: effectiveFields(s), keyByTaskId: new Map(), resources: [], remoteMeta: metadata(), workingHoursPerDay: 8, durationUnit: 'day' }, 'update')
    expect(payload.custom_fields).toContainEqual({ id: 1, value: '3' })
    expect(payload.custom_fields).toContainEqual({ id: 2, value: '43' })
    expect(payload.custom_fields).toContainEqual({ id: 3, value: '2026-09-07' })
    expect(payload.custom_fields).toContainEqual({ id: 4, value: 'hidden' })
    expect((payload.custom_fields as unknown[]).filter((f) => (f as { id: number }).id === 1)).toHaveLength(1)
  })

  it.each(['', 'abc', 'Infinity'])('ignores invalid numeric strings: %s', (value) => {
    const s = settings(); s.mapping.fields.progress = 'cf_1'; s.mapping.fields.duration = 'cf_1'
    const result = applyRemoteIssues([{ key: '1', fields: { cf_1: value } }], [], s.mapping, { tasks: [], links: [], resources: [] }, 'redmine', defaultCalendarConfig, 'day', false)
    if (result.kind !== 'success') throw new Error('Expected task')
    expect(result.tasks[0].progress).toBe(0)
    expect(result.tasks[0].duration).toBe(1)
  })
})
