import type { IncomingMessage, ServerResponse } from 'node:http'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { Readable } from 'node:stream'

const MAX_BODY_BYTES = 1024 * 1024
const jsonError = (status: number, error: string) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } })

function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number)
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113))
  }
  if (isIP(address) !== 6) return false
  const normalized = new URL(`http://[${address}]`).hostname.slice(1, -1)
  const [first, second = '0'] = normalized.split(':')
  const prefix = Number.parseInt(first, 16)
  const next = Number.parseInt(second || '0', 16)
  return prefix >= 0x2000 && prefix <= 0x3fff && prefix !== 0x2002 &&
    !(prefix === 0x2001 && (next < 0x200 || next === 0xdb8)) && !(prefix === 0x3fff && next < 0x1000)
}

async function publicAddresses(target: URL) {
  const hostname = target.hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '').toLowerCase()
  if (/(^|\.)(localhost|local|internal)$/.test(hostname)) return []
  const family = isIP(hostname)
  const addresses = family ? [{ address: hostname, family }] : await lookup(hostname, { all: true, verbatim: true })
  return addresses.length && addresses.every(({ address }) => isPublicAddress(address)) ? addresses : []
}

function fetchPublic(url: URL, method: string, headers: Headers, body: ArrayBuffer | undefined, addresses: Awaited<ReturnType<typeof publicAddresses>>): Promise<Response> {
  return new Promise((resolve, reject) => {
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest
    const request = send(url, {
      method, headers: Object.fromEntries(headers), signal: AbortSignal.timeout(30_000),
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, addresses)
        else callback(null, addresses[0].address, addresses[0].family)
      },
    }, (response) => {
      const status = response.statusCode ?? 502
      const empty = method === 'HEAD' || [204, 205, 304].includes(status)
      if (empty) response.resume()
      resolve(new Response(empty ? null : Readable.toWeb(response) as ReadableStream<Uint8Array>, {
        status, headers: { 'Content-Type': response.headers['content-type'] ?? 'application/octet-stream' },
      }))
    })
    request.on('error', reject)
    request.end(body ? Buffer.from(body) : undefined)
  })
}

export async function proxyRedmine(request: Request, allowedOrigins = process.env.REDMINE_ALLOWED_ORIGINS ?? ''): Promise<Response> {
  const allowed = allowedOrigins.split(',').map((origin) => origin.trim()).filter(Boolean)
  let upstream: URL
  try {
    const target = new URL(request.headers.get('x-redmine-target') ?? '')
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.search || target.hash) throw new Error()
    if (allowed.length && !allowed.includes(target.origin)) return jsonError(403, 'Redmine target is not in REDMINE_ALLOWED_ORIGINS.')
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/redmine-proxy/')) throw new Error()
    upstream = new URL(target.origin + target.pathname.replace(/\/+$/, '') + '/' + url.pathname.slice('/api/redmine-proxy/'.length) + url.search)
    if (upstream.origin !== target.origin) throw new Error()
    const pathname = decodeURIComponent(upstream.pathname)
    if (!pathname.endsWith('.json') || [...pathname].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || char === '\\')) return jsonError(400, 'Only Redmine .json API paths are allowed.')
  } catch {
    return jsonError(400, 'Invalid Redmine target or proxy path; use an http(s) URL.')
  }
  if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(request.method)) return jsonError(405, 'Unsupported proxy method.')
  const headers = new Headers()
  const hopHeaders = (request.headers.get('connection') ?? '').toLowerCase().split(',').map((key) => key.trim())
  for (const key of ['x-redmine-api-key', 'content-type', 'accept']) {
    const value = request.headers.get(key)
    if (value && !hopHeaders.includes(key)) headers.set(key, value)
  }
  if (!headers.get('x-redmine-api-key')?.trim()) return jsonError(400, 'X-Redmine-API-Key is required.')
  let addresses: Awaited<ReturnType<typeof publicAddresses>> = []
  if (!allowed.length) {
    try { addresses = await publicAddresses(upstream) }
    catch { return jsonError(502, 'Cannot resolve the Redmine hostname. Check its public DNS records.') }
    if (!addresses.length) return jsonError(403, 'Redmine target must resolve only to public IP addresses.')
  }
  let body: ArrayBuffer | undefined
  if (request.body) {
    if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) return jsonError(413, 'Proxy request body exceeds 1 MiB.')
    const reader = request.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > MAX_BODY_BYTES) { await reader.cancel(); return jsonError(413, 'Proxy request body exceeds 1 MiB.') }
      chunks.push(chunk.value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    body = bytes.buffer
  }
  try {
    const response = allowed.length
      ? await fetch(upstream, { method: request.method, headers, body, redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(30_000) })
      : await fetchPublic(upstream, request.method, headers, body, addresses)
    return new Response(response.body, { status: response.status, headers: { 'Content-Type': response.headers.get('content-type') ?? 'application/octet-stream', 'Cache-Control': 'no-store' } })
  } catch {
    return jsonError(502, 'Cannot reach Redmine. Check its URL and network access.')
  }
}

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  try {
    const chunks: Buffer[] = []
    let size = 0
    if (req.body !== undefined) {
      const data = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body))
      chunks.push(data)
      size = data.length
    } else {
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        const data = Buffer.from(chunk)
        size += data.length
        if (size > MAX_BODY_BYTES) break
        chunks.push(data)
      }
    }
    if (size > MAX_BODY_BYTES) { res.writeHead(413, { 'Content-Type': 'application/json', 'Connection': 'close' }); res.end(JSON.stringify({ error: 'Proxy request body exceeds 1 MiB.' })); req.resume(); return }
    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value)
    const body = size && req.method !== 'GET' && req.method !== 'HEAD' ? Uint8Array.from(Buffer.concat(chunks)).buffer : undefined
    const response = await proxyRedmine(new Request('http://proxy.internal' + req.url, { method: req.method, headers, body }))
    res.statusCode = response.status
    response.headers.forEach((value, key) => res.setHeader(key, value))
    res.end(Buffer.from(await response.arrayBuffer()))
  } catch {
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Redmine proxy request failed.' }))
  }
}
