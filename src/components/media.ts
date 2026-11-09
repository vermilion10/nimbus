import { useEffect, useState } from 'react'
import { basic, loadAuth, swActive } from '../api/auth'

/**
 * Returns a src for an authenticated URL. With the service worker running the URL
 * is used as is; otherwise the file is fetched with the app password and shown
 * from a blob (fine for thumbnails, used for full files only as a fallback).
 */
export function useAuthedSrc(url: string | null): string | null {
  const direct = swActive()
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!url || direct) return
    const auth = loadAuth()
    if (!auth) return
    let alive = true
    let made: string | null = null
    const u = new URL(url, location.origin)
    u.searchParams.delete('inline')
    fetch(u, { headers: { Authorization: basic(auth) }, credentials: 'omit' })
      .then((r) => (r.ok ? r.blob() : Promise.reject(r.status)))
      .then((b) => {
        if (!alive) return
        made = URL.createObjectURL(b)
        setBlobUrl(made)
      })
      .catch(() => {})
    return () => {
      alive = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [url, direct])
  if (!url) return null
  return direct ? url : blobUrl
}
