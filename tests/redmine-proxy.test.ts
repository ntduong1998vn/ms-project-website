import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import handler, { proxyRedmine } from '../api/redmine-proxy/[...path]'

const network = vi.hoisted(() => ({ lookup: vi.fn(), httpsRequest: vi.fn(), httpRequest: vi.fn() }))
vi.mock('node:dns/promises', () => ({ lookup: network.lookup }))
vi.mock('node:https', () => ({ request: network.httpsRequest }))
vi.mock('node:http', () => ({ request: network.httpRequest }))

beforeEach(() => {
  vi.resetAllMocks()
  network.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  for (const send of [network.httpsRequest, network.httpRequest]) send.mockImplementation((_url, _options, callback) => {
    const outgoing = Object.assign(new EventEmitter(), { end: vi.fn(() => callback(Object.assign(Readable.from([Buffer.from('public response')]), { statusCode: 401, headers: { 'content-type': 'application/json' } }))) })
    return outgoing
  })
})

const request = (target = 'https://redmine.test/redmine', init: RequestInit = {}) => new Request('https://app.test/api/redmine-proxy/issues.json?offset=100&status_id=*', { ...init, headers: { 'x-redmine-target': target, 'x-redmine-api-key': 'test-key', ...init.headers } })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('production Redmine proxy', () => {
  it('rejects other origins when an allowlist is configured', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
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
    const result = await proxyRedmine(request(undefined, { headers: { connection: 'content-type', 'content-type': 'text/plain' } }), 'https://redmine.test')
    expect(result.status).toBe(302)
    expect(result.headers.get('location')).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(new Headers((fetch.mock.calls[0] as unknown as [URL, RequestInit])[1].headers).has('content-type')).toBe(false)
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
      headers: { 'x-redmine-target': 'http://redmine.test', 'content-type': 'application/json', 'x-redmine-api-key': 'test-key' },
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

  it.each(['https://public.test', 'http://public.test:8080', 'https://public.test:8443'])('allows public targets without configuration: %s', async (target) => {
    vi.stubEnv('REDMINE_ALLOWED_ORIGINS', '')
    const response = await proxyRedmine(request(target))
    expect(response.status).toBe(401)
    expect(await response.text()).toBe('public response')
    expect(network.lookup).toHaveBeenCalledExactlyOnceWith('public.test', { all: true, verbatim: true })
    const send = target.startsWith('https:') ? network.httpsRequest : network.httpRequest
    const options = send.mock.calls[0][1]
    const callback = vi.fn()
    options.lookup('public.test', { all: true }, callback)
    expect(callback).toHaveBeenCalledWith(null, [{ address: '93.184.216.34', family: 4 }])
    const single = vi.fn()
    options.lookup('public.test', {}, single)
    expect(single).toHaveBeenCalledWith(null, '93.184.216.34', 4)
    expect(options.headers['x-redmine-api-key']).toBe('test-key')
  })
  it.each(['8.8.8.8', '[2606:4700:4700::1111]'])('allows public IP literals: %s', async (host) => {
    expect((await proxyRedmine(request('https://' + host), '')).status).toBe(401)
    expect(network.lookup).not.toHaveBeenCalled()
  })
  it('uses open mode when the variable is unset and passes method, body and query safely', async () => {
    vi.stubEnv('REDMINE_ALLOWED_ORIGINS', undefined)
    const response = await proxyRedmine(request('https://public.test/redmine', { method: 'POST', body: '{"issue":{}}', headers: { 'content-type': 'application/json', cookie: 'secret=1', authorization: 'secret' } }))
    expect(response.status).toBe(401)
    const [url, options] = network.httpsRequest.mock.calls[0]
    expect(String(url)).toBe('https://public.test/redmine/issues.json?offset=100&status_id=*')
    expect(options.method).toBe('POST')
    expect(options.headers).toEqual({ 'content-type': 'application/json', 'x-redmine-api-key': 'test-key' })
    expect(network.httpsRequest.mock.results[0].value.end).toHaveBeenCalledWith(Buffer.from('{"issue":{}}'))
  })
  it('never follows redirects in open mode', async () => {
    network.httpsRequest.mockImplementation((_url, _options, callback) => Object.assign(new EventEmitter(), {
      end: () => callback(Object.assign(Readable.from([]), { statusCode: 302, headers: { location: 'http://169.254.169.254/latest/meta-data.json', 'set-cookie': 'secret=1' } })),
    }))
    const response = await proxyRedmine(request('https://public.test'), '')
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(network.httpsRequest).toHaveBeenCalledTimes(1)
    expect(network.httpRequest).not.toHaveBeenCalled()
  })
  it('returns a safe error for open-mode connection failures', async () => {
    network.httpsRequest.mockImplementation(() => {
      const outgoing = Object.assign(new EventEmitter(), { end: () => outgoing.emit('error', new Error('sensitive network details')) })
      return outgoing
    })
    const response = await proxyRedmine(request('https://public.test'), '')
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('sensitive')
  })
  it.each([
    '0.0.0.0', '0.1.2.3', '10.0.0.1', '100.64.0.1', '100.127.255.254', '127.0.0.1', '169.254.169.254',
    '172.16.0.1', '172.31.255.254', '192.168.0.1', '192.0.0.1', '192.0.2.1', '192.88.99.1',
    '198.18.0.1', '198.19.255.254', '198.51.100.1', '203.0.113.1', '224.0.0.1', '240.0.0.1', '255.255.255.255',
    '[::]', '[::1]', '[fc00::1]', '[fd12::1]', '[fe80::1]', '[fec0::1]', '[ff02::1]',
    '[::ffff:127.0.0.1]', '[::ffff:10.0.0.1]', '[::ffff:8.8.8.8]', '[2001:db8::1]', '[2002:7f00:1::]',
    'localhost', 'localhost.', 'app.localhost', 'example.local', 'app.internal', 'app.internal.', '127.1', '0x7f000001',
  ])('rejects non-public literals and local names: %s', async (host) => {
    expect((await proxyRedmine(request('http://' + host), '')).status).toBe(403)
    expect(network.httpsRequest).not.toHaveBeenCalled()
    expect(network.httpRequest).not.toHaveBeenCalled()
    expect(network.lookup).not.toHaveBeenCalled()
  })
  it.each(['10.0.0.1', '172.16.0.1', '192.168.1.1', '127.0.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:10.0.0.1'])('rejects mixed public/private DNS answers: %s', async (address) => {
    network.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }, { address, family: address.includes(':') ? 6 : 4 }])
    expect((await proxyRedmine(request('https://public.test'), '')).status).toBe(403)
    expect(network.httpsRequest).not.toHaveBeenCalled()
  })
  it('handles empty DNS results and lookup failures without connecting', async () => {
    network.lookup.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('DNS failure'))
    expect((await proxyRedmine(request(), '')).status).toBe(403)
    expect((await proxyRedmine(request(), '')).status).toBe(502)
    expect(network.httpsRequest).not.toHaveBeenCalled()
  })
  it('keeps explicit allowlist behavior even for non-public targets', async () => {
    const fetch = vi.fn(async () => new Response('allowed'))
    vi.stubGlobal('fetch', fetch)
    expect((await proxyRedmine(request('http://localhost'), 'http://localhost')).status).toBe(200)
    expect(network.lookup).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it.each(['', 'https://redmine.test'])('requires a key and a .json API path in both modes (%s)', async (allowed) => {
    const missing = request()
    missing.headers.delete('x-redmine-api-key')
    expect((await proxyRedmine(missing, allowed)).status).toBe(400)
    expect((await proxyRedmine(request(undefined, { headers: { connection: 'x-redmine-api-key' } }), allowed)).status).toBe(400)
    const html = new Request('https://app.test/api/redmine-proxy/login?next=issues.json', { headers: request().headers })
    expect((await proxyRedmine(html, allowed)).status).toBe(400)
    expect(network.lookup).not.toHaveBeenCalled()
  })
})
