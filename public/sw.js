// Service worker: adds the stored Nextcloud app password to requests the browser
// makes on its own (<img>, <video>, <a download>, PDF frames), so files stream
// straight from Nextcloud instead of being buffered in memory first.
const AUTH_CACHE = 'cloud-ui-auth'
const AUTH_KEY = '/__cloud-ui-auth'
let auth = null

async function loadAuth() {
  if (auth) return auth
  const cache = await caches.open(AUTH_CACHE)
  const res = await cache.match(AUTH_KEY)
  auth = res ? await res.json() : null
  return auth
}

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'auth') auth = e.data.auth
})

const PROTECTED = /^\/(remote\.php\/dav\/|index\.php\/core\/preview|core\/preview)/

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (url.origin !== self.location.origin || !PROTECTED.test(url.pathname)) return
  if (req.headers.has('Authorization')) return
  event.respondWith(withAuth(req, url))
})

async function withAuth(req, url) {
  const a = await loadAuth()
  if (!a) return fetch(req)
  const inline = url.searchParams.get('inline') === '1'
  url.searchParams.delete('inline')
  const headers = new Headers()
  for (const h of ['Range', 'If-None-Match', 'If-Modified-Since', 'Accept']) {
    const v = req.headers.get(h)
    if (v) headers.set(h, v)
  }
  headers.set('Authorization', 'Basic ' + btoa(a.loginName + ':' + a.appPassword))
  const res = await fetch(url.toString(), { method: req.method, headers, credentials: 'omit' })
  if (!inline) return res
  // Opening a PDF in a frame needs it served inline and without Nextcloud's
  // "default-src 'none'" policy (that policy blocks the browser's PDF viewer).
  // Only PDFs get this; any other type keeps the policy so an uploaded HTML or
  // SVG file can never run script on this origin.
  const out = new Headers(res.headers)
  out.delete('Content-Disposition')
  if ((out.get('Content-Type') || '').startsWith('application/pdf')) {
    out.delete('Content-Security-Policy')
  } else {
    out.set('Content-Security-Policy', "default-src 'none'; sandbox")
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out })
}
