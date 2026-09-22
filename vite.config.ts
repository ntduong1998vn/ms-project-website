import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'

// Dev-only Redmine proxy: browser CORS is not enabled by Redmine by default.
// The target comes from the x-redmine-target request header so the settings
// dialog's Base URL field controls proxying; the upstream host is pinned to
// that header's host so a crafted path cannot bounce the API key elsewhere.
const redmineDevProxy = (): Plugin => ({
  name: 'redmine-dev-proxy',
  configureServer(server) {
    server.middlewares.use('/redmine-proxy', (req, res) => {
      // connect strips the '/redmine-proxy' prefix — req.url is the remainder path+query
      const target = String(req.headers['x-redmine-target'] ?? '')
      let upstream: URL
      try {
        const base = new URL(target)
        if (base.protocol !== 'http:' && base.protocol !== 'https:') throw new Error()
        // preserve target subpaths (Redmine often deployed under a sub-URI) and
        // pin the host — connect's '.'-suffix route quirk lets '/redmine-proxy.evil'
        // reach here with req.url='.evil' → 'a.com.evil' would receive the API key
        upstream = new URL(base.origin + base.pathname.replace(/\/+$/, '') + (req.url ?? '/'))
        if (upstream.host !== base.host) throw new Error()
      } catch {
        res.statusCode = 400
        res.end('Invalid or missing x-redmine-target header (must be http(s) URL)')
        return
      }
      const headers: Record<string, string> = {}
      const skip: Record<string, true> = { 'x-redmine-target': true, host: true, connection: true, 'keep-alive': true, 'transfer-encoding': true, 'accept-encoding': true, 'content-length': true, te: true, trailer: true, upgrade: true, 'proxy-authorization': true }
      for (const [k, v] of Object.entries(req.headers)) {
        if (skip[k] === true || v === undefined) continue
        headers[k] = Array.isArray(v) ? v.join(', ') : v
      }
      headers.host = upstream.host
      // undici throws 'Request with GET/HEAD method cannot have body' — never pass req unconditionally
      const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
      fetch(upstream, { method: req.method, headers, body: hasBody ? req : undefined, ...(hasBody ? { duplex: 'half' } : {}) } as RequestInit)
        .then(async (r) => {
          res.statusCode = r.status
          // undici transparently decompresses — content-encoding/content-length from the
          // upstream describe the COMPRESSED body and must not be forwarded
          const skipRes: Record<string, true> = { 'content-encoding': true, 'transfer-encoding': true, 'content-length': true, connection: true }
          r.headers.forEach((v, k) => { if (skipRes[k] !== true) res.setHeader(k, v) })
          res.end(Buffer.from(await r.arrayBuffer()))
        })
        .catch((e) => { res.statusCode = 502; res.end(String(e)) })
    })
  },
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    babel({ presets: [reactCompilerPreset()] }),
    redmineDevProxy()
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts'],
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
      },
    },
  },
})
