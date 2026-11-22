import { afterEach, describe, expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import handler, { proxyRedmine } from '../api/redmine-proxy/[...path]'

const request = (target = 'https://redmine.test/redmine', init: RequestInit = {}) => new Request('https://app.test/api/redmine-proxy/issues.json?offset=100&status_id=*', { ...init, headers: { 'x-redmine-target': target, 'x-redmine-api-key': 'test-key', ...init.headers } })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('production Redmine proxy', () => {
  it('disables proxying when the allowlist is empty and rejects other origins', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const disabled = await proxyRedmine(request(), '')
    expect(disabled.status).toBe(403)
    expect(await disabled.json()).toEqual({ error: expect.stringContaining('disabled') })
    expect((await proxyRedmine(request(), 'https://other.test')).status).toBe(403)
    expect((await proxyRedmine(request('https://redmine.test.evil'), 'https://redmine.test')).status).toBe(403)
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each(['file:///etc/passwd', 'ftp://redmine.test', 'https://user:password@redmine.test', 'not a URL'])('rejects invalid targets (%s)', async (target) => {
    expect((await proxyRedmine(request(target), 'https://redmine.test')).status).toBe(400)
  })
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('passes %s, query and body but strips cookies and hop headers', async (method) => {
    const fetch = vi.fn(async () => new Response('created', { status: 201, headers: { 'content-type': 'application/json', 'set-cookie': 'secret=1', connection: 'close' } }))
    vi.stubGlobal('fetch', fetch)
    const result = await proxyRedmine(request(undefined, { method, body: '{"issue":{"subject":"Updated"}}', headers: { 'Content-Type': 'application/json', cookie: 'session=secret', authorization: 'Bearer secret', connection: 'keep-alive', 'x-extra': 'discard' } }), ' https://other.test, https://redmine.test ')
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit]
    expect(String(url)).toBe('https://redmine.test/redmine/issues.json?offset=100&status_id=*')
    expect(init.method).toBe(method)
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe('{"issue":{"subject":"Updated"}}')
    expect(Object.fromEntries(new Headers(init.headers))).toEqual({ 'content-type': 'application/json', 'x-redmine-api-key': 'test-key' })
    expect(init.redirect).toBe('manual')
    expect(result.status).toBe(201)
    expect(result.headers.get('content-type')).toBe('application/json')
    expect(result.headers.get('set-cookie')).toBeNull()
    expect(result.headers.get('connection')).toBeNull()
    expect(await result.text()).toBe('created')
  })
  it('does not follow redirects, or forward connection-nominated headers', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://evil.test' } }))
    vi.stubGlobal('fetch', fetch)
    const result = await proxyRedmine(request(undefined, { headers: { connection: 'x-redmine-api-key' } }), 'https://redmine.test')
    expect(result.status).toBe(302)
    expect(result.headers.get('location')).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(new Headers((fetch.mock.calls[0] as unknown as [URL, RequestInit])[1].headers).has('x-redmine-api-key')).toBe(false)
  })
  it('caps streamed bodies and gives a safe upstream error', async () => {
    const fetch = vi.fn(async () => { throw new TypeError('sensitive upstream details') })
    vi.stubGlobal('fetch', fetch)
    expect((await proxyRedmine(request(undefined, { method: 'POST', body: 'x'.repeat(1024 * 1024 + 1) }), 'https://redmine.test')).status).toBe(413)
    expect(fetch).not.toHaveBeenCalled()
    const result = await proxyRedmine(request(), 'https://redmine.test')
    expect(result.status).toBe(502)
    expect(await result.text()).not.toContain('sensitive')
  })
  it.each([false, true])('adapts Node/Vercel requests (parsed body: %s)', async (parsed) => {
    const body = '{"relation":{"issue_to_id":102}}'
    const req = Object.assign(Readable.from([Buffer.from(body)]), {
      method: 'POST', url: '/api/redmine-proxy/issues/101/relations.json?x=1',
      headers: { 'x-redmine-target': 'http://redmine.test', 'content-type': 'application/json' },
      ...(parsed ? { body: JSON.parse(body) } : {}),
    }) as IncomingMessage & { body?: unknown }
    const res = { statusCode: 200, setHeader: vi.fn(), end: vi.fn(), writeHead: vi.fn() }
    const fetch = vi.fn(async () => new Response('{"relation":{"id":9}}', { status: 201 }))
    vi.stubGlobal('fetch', fetch)
    vi.stubEnv('REDMINE_ALLOWED_ORIGINS', 'http://redmine.test')
    await handler(req, res as unknown as ServerResponse)
    expect(res.statusCode).toBe(201)
    expect(res.end).toHaveBeenCalledWith(Buffer.from('{"relation":{"id":9}}'))
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit]
    expect(String(url)).toBe('http://redmine.test/issues/101/relations.json?x=1')
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe(body)
  })
})
