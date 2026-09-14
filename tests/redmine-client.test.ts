import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ITask } from '@svar-ui/react-gantt'
import { createProvider } from '@/lib/integrations'
import { createRedmineProvider } from '@/lib/integrations/redmine/client'
import { defaultIntegrationSettings } from '@/lib/integrations/settings'
import type { IntegrationSettings, PushContext } from '@/lib/integrations/types'
import { defaultFieldMapping } from '@/lib/integrations/fields'

function settings(overrides: Partial<IntegrationSettings> = {}): IntegrationSettings {
  return {
    ...defaultIntegrationSettings(),
    baseUrl: 'https://redmine.example.com',
    apiKey: 'secret-key',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function stubFetch(impl: (url: string) => Response | Promise<Response>) {
  const mock = vi.fn((input: RequestInfo | URL) => Promise.resolve(impl(String(input))))
  vi.stubGlobal('fetch', mock)
  return mock
}

function pushCtx(): PushContext {
  return {
    mapping: defaultFieldMapping(),
    descriptors: [],
    keyByTaskId: new Map(),
    resources: [],
    workingHoursPerDay: 8,
    durationUnit: 'day',
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createProvider', () => {
  it('returns a redmine provider and rejects unknown providers', () => {
    expect(createProvider(settings()).id).toBe('redmine')
    expect(() => createProvider(settings({ provider: 'jira' as IntegrationSettings['provider'] }))).toThrow(
      'Unknown provider: jira'
    )
  })
})

describe('testConnection', () => {
  it('returns the current user login', async () => {
    stubFetch(() => jsonResponse({ user: { id: 1, login: 'alice' } }))
    await expect(createRedmineProvider(settings()).testConnection()).resolves.toBe('alice')
  })

  it('throws when the response has no user login', async () => {
    stubFetch(() => jsonResponse({}))
    await expect(createRedmineProvider(settings()).testConnection()).rejects.toThrow(
      'Redmine did not return the current user.'
    )
  })
})

describe('fetchIssues', () => {
  it('builds the issues URL with project filter and API key header', async () => {
    const mock = stubFetch(() => jsonResponse({ issues: [], total_count: 0, offset: 0, limit: 100 }))
    const issues = await createRedmineProvider(settings({ projectIdentifier: 'my proj' })).fetchIssues()

    expect(issues).toEqual([])
    expect(mock).toHaveBeenCalledTimes(1)
    const [url, init] = mock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(
      'https://redmine.example.com/issues.json?limit=100&offset=0&include=relations&status_id=*&project_id=my%20proj'
    )
    expect((init.headers as Record<string, string>)['X-Redmine-API-Key']).toBe('secret-key')
  })

  it('omits project_id when no project identifier is configured', async () => {
    const mock = stubFetch(() => jsonResponse({ issues: [], total_count: 0 }))
    await createRedmineProvider(settings()).fetchIssues()
    const [url] = mock.mock.calls[0] as unknown as [string]
    expect(url).not.toContain('project_id')
  })

  it('paginates until total_count and flattens each issue', async () => {
    const issue = (id: number) => ({
      id,
      subject: `Issue ${id}`,
      tracker: { id: 1, name: 'Bug' },
      status: { id: 1, name: 'New' },
      priority: { id: 2, name: 'Normal' },
    })
    const mock = stubFetch((url) => {
      const offset = Number(new URL(url).searchParams.get('offset'))
      return jsonResponse({ issues: [issue(offset + 1)], total_count: 2, offset, limit: 100 })
    })
    const issues = await createRedmineProvider(settings()).fetchIssues()

    expect(mock).toHaveBeenCalledTimes(2)
    expect((mock.mock.calls[1] as unknown as [string])[0]).toContain('offset=1')
    expect(issues.map((remote) => remote.key)).toEqual(['1', '2'])
    expect(issues[0].fields.subject).toBe('Issue 1')
  })
})

describe('request error handling', () => {
  it('throws Redmine <status>: <body> for non-ok responses', async () => {
    stubFetch(() => new Response('boom', { status: 403 }))
    await expect(createRedmineProvider(settings()).testConnection()).rejects.toThrow('Redmine 403: boom')
  })

  it('translates network TypeErrors into a CORS hint', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    await expect(createRedmineProvider(settings()).testConnection()).rejects.toThrow(
      'Cannot reach Redmine. Check the URL, or enable "Use dev proxy" (CORS).'
    )
  })

  it('rethrows non-TypeError fetch failures unchanged', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new RangeError('weird'))))
    await expect(createRedmineProvider(settings()).testConnection()).rejects.toThrow(RangeError)
  })
})

describe('dev proxy mode', () => {
  it('routes through /redmine-proxy with the x-redmine-target header', async () => {
    const mock = stubFetch(() => jsonResponse({ user: { id: 1, login: 'alice' } }))
    await createRedmineProvider(settings({ useDevProxy: true })).testConnection()

    const [url, init] = mock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/redmine-proxy/users/current.json')
    const headers = init.headers as Record<string, string>
    expect(headers['x-redmine-target']).toBe('https://redmine.example.com')
    expect(headers['X-Redmine-API-Key']).toBe('secret-key')
  })
})

describe('createIssue / updateIssue', () => {
  it('posts the issue payload and returns the new key as a string', async () => {
    const task: ITask = { id: 1, text: 'New task', start: new Date(2026, 8, 7), duration: 1 }
    const mock = stubFetch(() => jsonResponse({ issue: { id: 1234 } }))
    const key = await createRedmineProvider(settings({ projectIdentifier: 'proj', trackerId: 3 })).createIssue(
      task,
      pushCtx()
    )

    expect(key).toBe('1234')
    const [url, init] = mock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://redmine.example.com/issues.json')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    const body = JSON.parse(String(init.body)) as { issue: Record<string, unknown> }
    expect(body.issue.subject).toBe('New task')
    expect(body.issue.project_id).toBe('proj')
    expect(body.issue.tracker_id).toBe(3)
  })

  it('puts updates to /issues/<key>.json and tolerates an empty body', async () => {
    const task: ITask = { id: 1, text: 'Renamed' }
    const mock = stubFetch(() => new Response('', { status: 200 }))
    await expect(
      createRedmineProvider(settings()).updateIssue('77', task, pushCtx())
    ).resolves.toBeUndefined()

    const [url, init] = mock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://redmine.example.com/issues/77.json')
    expect(init.method).toBe('PUT')
    const body = JSON.parse(String(init.body)) as { issue: Record<string, unknown> }
    expect(body.issue.subject).toBe('Renamed')
    expect(body.issue.project_id).toBeUndefined()
  })
})

describe('fetchProjectMetadata', () => {
  it('aggregates metadata, filters group memberships, and degrades failed requests to empty lists', async () => {
    stubFetch((url) => {
      if (url.includes('/projects/proj/memberships.json')) {
        return jsonResponse({
          memberships: [
            { id: 1, user: { id: 7, name: 'Alice' } },
            { id: 2, group: { id: 3, name: 'Dev Team' } },
            { id: 3, user: { id: 8, name: 'Bob' } },
          ],
        })
      }
      if (url.includes('/projects/proj.json')) {
        return jsonResponse({ project: { id: 1, name: 'P', identifier: 'proj', trackers: [{ id: 2, name: 'Bug' }] } })
      }
      if (url.includes('/issue_statuses.json')) return new Response('forbidden', { status: 403 })
      if (url.includes('/enumerations/issue_priorities.json')) {
        return jsonResponse({ issue_priorities: [{ id: 4, name: 'High' }] })
      }
      if (url.includes('/custom_fields.json')) {
        return jsonResponse({ custom_fields: [{ id: 9, name: 'Env', multiple: '1' }, { id: 10, name: 'Flag', multiple: false }] })
      }
      return new Response('not found', { status: 404 })
    })

    const meta = await createRedmineProvider(settings({ projectIdentifier: 'proj' })).fetchProjectMetadata()

    expect(meta.trackers).toEqual([{ id: 2, name: 'Bug' }])
    expect(meta.members).toEqual([
      { id: 7, name: 'Alice' },
      { id: 8, name: 'Bob' },
    ])
    expect(meta.statuses).toEqual([])
    expect(meta.priorities).toEqual([{ id: 4, name: 'High' }])
    const cf9 = meta.fields.find((field) => field.key === 'cf_9')
    const cf10 = meta.fields.find((field) => field.key === 'cf_10')
    expect(cf9).toMatchObject({ kind: 'custom', label: 'Env (custom)', multiple: true })
    expect(cf10).toMatchObject({ kind: 'custom', multiple: false })
    // Standard fields are always present even when custom_fields.json works
    expect(meta.fields.some((field) => field.key === 'subject' && field.kind === 'standard')).toBe(true)
  })

  it('harvests custom field descriptors from issues when custom_fields.json is forbidden', async () => {
    stubFetch((url) => {
      if (url.includes('/custom_fields.json')) return new Response('forbidden', { status: 403 })
      if (url.includes('/issues.json')) {
        return jsonResponse({
          issues: [{
            id: 1,
            subject: 'A',
            tracker: { id: 1, name: 'Bug' },
            status: { id: 1, name: 'New' },
            priority: { id: 2, name: 'Normal' },
            custom_fields: [
              { id: 9, name: 'Env', value: ['a', 'b'] },
              { id: 10, name: 'Flag', value: 'yes' },
            ],
          }],
          total_count: 1,
        })
      }
      return jsonResponse({})
    })

    const meta = await createRedmineProvider(settings()).fetchProjectMetadata()
    const cf9 = meta.fields.find((field) => field.key === 'cf_9')
    const cf10 = meta.fields.find((field) => field.key === 'cf_10')
    expect(cf9).toMatchObject({ kind: 'custom', label: 'Env (custom)', multiple: true })
    expect(cf10).toMatchObject({ kind: 'custom', multiple: false })
  })
})

describe('request edge cases', () => {
  it('strips trailing slashes from the base URL', async () => {
    const mock = stubFetch(() => jsonResponse({ user: { id: 1, login: 'a' } }))
    await createRedmineProvider(settings({ baseUrl: 'https://redmine.example.com///' })).testConnection()
    expect((mock.mock.calls[0] as unknown as [string])[0]).toBe('https://redmine.example.com/users/current.json')
  })

  it('sends no Content-Type header on body-less requests', async () => {
    const mock = stubFetch(() => jsonResponse({ user: { id: 1, login: 'a' } }))
    await createRedmineProvider(settings()).testConnection()
    const headers = (mock.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>
    expect(headers['Content-Type']).toBeUndefined()
  })

  it('reports an empty body when the error response text cannot be read', async () => {
    const res = new Response('x', { status: 500 })
    vi.spyOn(res, 'text').mockRejectedValue(new Error('stream gone'))
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(res)))
    await expect(createRedmineProvider(settings()).testConnection()).rejects.toThrow('Redmine 500:')
  })

  it('tolerates missing issues and total_count keys in the page envelope', async () => {
    stubFetch(() => jsonResponse({}))
    await expect(createRedmineProvider(settings()).fetchIssues()).resolves.toEqual([])
  })

  it('omits tracker_id and project_id when neither is configured', async () => {
    const task: ITask = { id: 1, text: 'A' }
    const mock = stubFetch(() => jsonResponse({ issue: { id: 9 } }))
    await createRedmineProvider(settings()).createIssue(task, pushCtx())
    const body = JSON.parse(String((mock.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as {
      issue: Record<string, unknown>
    }
    expect(body.issue.tracker_id).toBeUndefined()
    expect(body.issue.project_id).toBeUndefined()
  })

  it('encodes issue keys in the update URL', async () => {
    const mock = stubFetch(() => new Response('', { status: 200 }))
    await createRedmineProvider(settings()).updateIssue('a/b', { id: 1, text: 'A' }, pushCtx())
    expect((mock.mock.calls[0] as unknown as [string])[0]).toBe('https://redmine.example.com/issues/a%2Fb.json')
  })
})

describe('fetchProjectMetadata edge cases', () => {
  it('skips project-scoped requests when no project identifier is configured', async () => {
    const mock = stubFetch((url) => {
      if (url.includes('/issue_statuses.json')) return jsonResponse({ issue_statuses: [{ id: 1, name: 'New' }] })
      if (url.includes('/enumerations/issue_priorities.json')) return jsonResponse({})
      if (url.includes('/custom_fields.json')) return jsonResponse({})
      return new Response('not found', { status: 404 })
    })
    const meta = await createRedmineProvider(settings()).fetchProjectMetadata()

    const urls = mock.mock.calls.map((call) => String(call[0]))
    expect(urls.some((url) => url.includes('/projects/'))).toBe(false)
    expect(meta.trackers).toEqual([])
    expect(meta.members).toEqual([])
    expect(meta.statuses).toEqual([{ id: 1, name: 'New' }])
    // missing keys in the envelopes degrade to empty lists
    expect(meta.priorities).toEqual([])
    expect(meta.fields.every((field) => field.kind === 'standard')).toBe(true)
  })

  it('returns empty members when the memberships envelope is empty', async () => {
    stubFetch((url) => {
      if (url.includes('/memberships.json')) return jsonResponse({})
      if (url.includes('/projects/proj.json')) return jsonResponse({})
      return jsonResponse({})
    })
    const meta = await createRedmineProvider(settings({ projectIdentifier: 'proj' })).fetchProjectMetadata()
    expect(meta.members).toEqual([])
    expect(meta.trackers).toEqual([])
  })

  it('returns only standard fields when the issue-page harvest also fails', async () => {
    stubFetch(() => new Response('forbidden', { status: 403 }))
    const meta = await createRedmineProvider(settings()).fetchProjectMetadata()
    expect(meta.fields.every((field) => field.kind === 'standard')).toBe(true)
    expect(meta.fields.some((field) => field.key === 'subject')).toBe(true)
  })

  it('marks a harvested field multi-value when any issue returns an array', async () => {
    const issue = (id: number, env: string | string[]) => ({
      id,
      subject: `I${id}`,
      tracker: { id: 1, name: 'Bug' },
      status: { id: 1, name: 'New' },
      priority: { id: 2, name: 'Normal' },
      custom_fields: [{ id: 9, name: 'Env', value: env }],
    })
    stubFetch((url) => {
      if (url.includes('/custom_fields.json')) return new Response('forbidden', { status: 403 })
      if (url.includes('/issues.json')) {
        return jsonResponse({ issues: [issue(1, 'single'), issue(2, ['a', 'b'])], total_count: 2 })
      }
      return jsonResponse({})
    })
    const meta = await createRedmineProvider(settings()).fetchProjectMetadata()
    expect(meta.fields.find((field) => field.key === 'cf_9')?.multiple).toBe(true)
  })
})
