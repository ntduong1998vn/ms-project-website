import type { IncomingMessage, ServerResponse } from 'node:http'

const MAX_BODY_BYTES = 1024 * 1024
const jsonError = (status: number, error: string) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } })

export async function proxyRedmine(request: Request, allowedOrigins = process.env.REDMINE_ALLOWED_ORIGINS ?? ''): Promise<Response> {
  const allowed = allowedOrigins.split(',').map((origin) => origin.trim()).filter(Boolean)
  if (!allowed.length) return jsonError(403, 'Redmine proxy disabled: configure REDMINE_ALLOWED_ORIGINS on the server.')
  let upstream: URL
  try {
    const target = new URL(request.headers.get('x-redmine-target') ?? '')
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.search || target.hash) throw new Error()
    if (!allowed.includes(target.origin)) return jsonError(403, 'Redmine target is not in REDMINE_ALLOWED_ORIGINS.')
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/redmine-proxy/')) throw new Error()
    upstream = new URL(target.origin + target.pathname.replace(/\/+$/, '') + '/' + url.pathname.slice('/api/redmine-proxy/'.length) + url.search)
    if (upstream.origin !== target.origin) throw new Error()
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
    const response = await fetch(upstream, { method: request.method, headers, body, redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(30_000) })
    return new Response(response.body, { status: response.status, headers: { 'Content-Type': response.headers.get('content-type') ?? 'application/octet-stream', 'Cache-Control': 'no-store' } })
  } catch {
    return jsonError(502, 'Cannot reach the allowed Redmine server. Check its URL and network access.')
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
