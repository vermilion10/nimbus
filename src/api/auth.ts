// Sign-in with Nextcloud's Login Flow v2: Nextcloud's own login page (with 2FA)
// runs in a new tab and hands back an app password for this browser.

export interface Auth {
  loginName: string
  appPassword: string
}

const KEY = 'cloud-ui:auth'
const AUTH_CACHE = 'cloud-ui-auth'
const AUTH_KEY = '/__cloud-ui-auth'

export function loadAuth(): Auth | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Auth) : null
  } catch {
    return null
  }
}

export async function saveAuth(auth: Auth | null): Promise<void> {
  try {
    if (auth) localStorage.setItem(KEY, JSON.stringify(auth))
    else localStorage.removeItem(KEY)
  } catch {
    /* storage blocked: the session lasts until the tab closes */
  }
  try {
    const cache = await caches.open(AUTH_CACHE)
    if (auth) await cache.put(AUTH_KEY, new Response(JSON.stringify(auth)))
    else await cache.delete(AUTH_KEY)
  } catch {
    /* Cache API unavailable: media falls back to blob loading */
  }
  navigator.serviceWorker?.controller?.postMessage({ type: 'auth', auth })
}

export async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  try {
    await navigator.serviceWorker.register('/sw.js')
    await navigator.serviceWorker.ready
  } catch {
    /* not fatal */
  }
}

export function swActive(): boolean {
  return !!navigator.serviceWorker?.controller
}

export interface LoginFlow {
  loginUrl: string
  token: string
}

export async function startLogin(): Promise<LoginFlow> {
  const res = await fetch('/index.php/login/v2', { method: 'POST' })
  if (!res.ok) throw new Error(`Could not start sign-in (${res.status})`)
  const data = await res.json()
  return { loginUrl: data.login, token: data.poll.token }
}

/** Polls until the user finishes in the Nextcloud tab. Resolves null if cancelled. */
export async function pollLogin(token: string, signal: AbortSignal): Promise<Auth | null> {
  while (!signal.aborted) {
    try {
      const res = await fetch('/login/v2/poll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }),
        signal,
      })
      if (res.ok) {
        const data = await res.json()
        return { loginName: data.loginName, appPassword: data.appPassword }
      }
    } catch (e) {
      if (signal.aborted) return null
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  return null
}

/** Revokes this browser's app password in Nextcloud, then forgets it. */
export async function logout(auth: Auth): Promise<void> {
  try {
    await fetch('/ocs/v2.php/core/apppassword', {
      method: 'DELETE',
      headers: {
        Authorization: basic(auth),
        'OCS-APIRequest': 'true',
      },
    })
  } finally {
    await saveAuth(null)
  }
}

export function basic(auth: Auth): string {
  const bytes = new TextEncoder().encode(`${auth.loginName}:${auth.appPassword}`)
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return 'Basic ' + btoa(bin)
}
