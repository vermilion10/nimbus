// Installation settings, read from /config.js (window.CLOUD_CONFIG) at startup.

interface CloudConfig {
  nextcloudUrl?: string
  publicDir?: string
  publicBase?: string
}

const cfg: CloudConfig = (window as unknown as { CLOUD_CONFIG?: CloudConfig }).CLOUD_CONFIG ?? {}

/** Nextcloud's own web interface, or '' when not configured. */
export const NEXTCLOUD_URL = (cfg.nextcloudUrl ?? '').replace(/\/+$/, '')

/** Folder in the user's files whose contents are published read-only. */
export const PUBLIC_DIR = '/' + (cfg.publicDir ?? '/Public').replace(/^\/+|\/+$/g, '')

/** Address the folder is published at, or '' when sharing is off. */
export const PUBLIC_BASE = (cfg.publicBase ?? '').replace(/\/+$/, '')

export const SHARING = PUBLIC_BASE !== ''

export function isPublic(path: string): boolean {
  return SHARING && path.startsWith(PUBLIC_DIR + '/')
}

/** Public address of a file or folder inside PUBLIC_DIR, or null outside it. */
export function publicUrl(path: string, isDir: boolean): string | null {
  if (!isPublic(path)) return null
  const rel = path.slice(PUBLIC_DIR.length)
  const encoded = rel.split('/').map(encodeURIComponent).join('/')
  return PUBLIC_BASE + encoded + (isDir ? '/' : '')
}
