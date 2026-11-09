import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  Presentation,
  type LucideIcon,
} from 'lucide-react'

export function formatBytes(n: number): string {
  if (!n || n < 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  const v = n / 1024 ** i
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })

export function formatRelative(d: Date): string {
  const sec = (d.getTime() - Date.now()) / 1000
  const abs = Math.abs(sec)
  if (abs < 60) return 'just now'
  if (abs < 3600) return rtf.format(Math.round(sec / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(sec / 3600), 'hour')
  if (abs < 86400 * 7) return rtf.format(Math.round(sec / 86400), 'day')
  return dateFmt.format(d)
}

export const formatDateTime = (d: Date) => dateTimeFmt.format(d)
export const formatMonth = (d: Date) => monthFmt.format(d)

export type Kind = 'folder' | 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'other'

export function kindOf(mime: string, name = ''): Kind {
  if (mime === 'inode/directory' || mime === 'httpd/unix-directory') return 'folder'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime === 'application/pdf') return 'pdf'
  if (
    mime.startsWith('text/') ||
    /json|xml|javascript|x-sh|yaml|toml|x-php|x-python|sql/.test(mime) ||
    /\.(md|txt|log|csv|ini|conf|cfg|env|yml|yaml|toml|json|ts|tsx|js|go|py|rs|sh|ps1|css|html)$/i.test(name)
  )
    return 'text'
  return 'other'
}

export function iconFor(mime: string, name = ''): LucideIcon {
  const k = kindOf(mime, name)
  if (k === 'folder') return Folder
  if (k === 'image') return FileImage
  if (k === 'video') return FileVideo
  if (k === 'audio') return FileAudio
  if (k === 'pdf') return FileText
  if (/zip|rar|7z|tar|gzip|x-xz|bzip/.test(mime)) return FileArchive
  if (/spreadsheet|excel|csv/.test(mime)) return FileSpreadsheet
  if (/presentation|powerpoint/.test(mime)) return Presentation
  if (/word|opendocument\.text|rtf/.test(mime)) return FileText
  if (k === 'text') return FileCode
  return File
}

// ---------- hash router ----------

function subscribeHash(cb: () => void) {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

export interface Route {
  view: 'files' | 'photos' | 'favorites' | 'shares' | 'trash' | 'search' | 'download'
  path: string
  query: string
  /** Link handed over by the Share menu (#/download?url=...). */
  shared: string
}

export function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/files/'
  const [pathPart, qs = ''] = raw.split('?')
  const segs = pathPart.split('/').filter(Boolean)
  const view = (segs[0] ?? 'files') as Route['view']
  const rest = '/' + segs.slice(1).map(decodeURIComponent).join('/')
  const params = new URLSearchParams(qs)
  const query = params.get('q') ?? ''
  const shared = params.get('url') ?? ''
  const known: Route['view'][] = ['files', 'photos', 'favorites', 'shares', 'trash', 'search', 'download']
  return { view: known.includes(view) ? view : 'files', path: rest, query, shared }
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribeHash, () => location.hash)
  return parseRoute(hash)
}

export function filesHref(path: string): string {
  return '#/files' + path.split('/').map(encodeURIComponent).join('/')
}

export function go(href: string) {
  if (location.hash !== href) location.hash = href
}

// ---------- theme ----------

export type StyleName = 'md3' | 'shadcn'
export type Mode = 'system' | 'light' | 'dark'
export interface Theme {
  style: StyleName
  mode: Mode
}

const THEME_KEY = 'cloud-ui:theme'

export const STYLES: { id: StyleName; label: string }[] = [
  { id: 'md3', label: 'Material 3' },
  { id: 'shadcn', label: 'Minimal (shadcn)' },
]

export function useTheme(): [Theme, (t: Partial<Theme>) => void] {
  const [theme, setTheme] = useState<Theme>(() => ({
    style: (document.documentElement.dataset.style as StyleName) || 'md3',
    mode: (document.documentElement.dataset.mode as Mode) || 'system',
  }))
  useEffect(() => {
    document.documentElement.dataset.style = theme.style
    document.documentElement.dataset.mode = theme.mode
    try {
      localStorage.setItem(THEME_KEY, JSON.stringify(theme))
    } catch {
      /* ignore */
    }
  }, [theme])
  return [theme, (t) => setTheme((prev) => ({ ...prev, ...t }))]
}

export function usePersisted<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem('cloud-ui:' + key)
      return raw ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })
  return [
    v,
    (nv: T) => {
      setV(nv)
      try {
        localStorage.setItem('cloud-ui:' + key, JSON.stringify(nv))
      } catch {
        /* ignore */
      }
    },
  ]
}

export function useMediaQuery(q: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = matchMedia(q)
      m.addEventListener('change', cb)
      return () => m.removeEventListener('change', cb)
    },
    () => matchMedia(q).matches,
  )
}

export async function copyText(s: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(s)
    return true
  } catch {
    // http:// origins other than localhost have no clipboard API
    const ta = document.createElement('textarea')
    ta.value = s
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}
