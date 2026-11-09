import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In development, Nextcloud is reached through the same origin, exactly like the
// Caddy proxy does in production. Set NEXTCLOUD to your server's address.
const target = process.env.NEXTCLOUD ?? 'http://localhost:8080'
const proxy: Record<string, any> = Object.fromEntries(
  ['/remote.php', '/ocs', '/index.php', '/login', '/core'].map((p) => [
    p,
    {
      target,
      changeOrigin: true,
      // same as the Caddy proxy: no cookies either way (see deploy/Caddyfile)
      configure: (proxy: any) => {
        proxy.on('proxyReq', (req: any) => req.removeHeader('cookie'))
        proxy.on('proxyRes', (res: any) => delete res.headers['set-cookie'])
      },
    },
  ]),
)

// `npm run preview` serves the production build with the same CSP Caddy sends.
const csp = readFileSync(new URL('./Caddyfile', import.meta.url), 'utf8').match(/Content-Security-Policy "([^"]+)"/)?.[1]

// The download service runs in Docker; point CLOUD at a deployed instance to use it in development.
proxy['/dl'] = { target: process.env.CLOUD ?? 'http://localhost:8093', changeOrigin: true } as any

export default defineConfig({
  plugins: [react()],
  server: { port: 5181, proxy },
  preview: { port: 5182, proxy, headers: csp ? { 'Content-Security-Policy': csp } : {} },
  build: { target: 'es2022', chunkSizeWarningLimit: 800 },
})
