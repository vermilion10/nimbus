// OCS API: current user and share links.
import { basic, type Auth } from './auth'

export interface User {
  id: string
  displayName: string
  email: string
  quota: { used: number; total: number; relative: number }
}

export interface Share {
  id: string
  /** 0 user, 1 group, 3 public link, 4 email, 6 federated */
  shareType: number
  path: string
  itemType: 'file' | 'folder'
  name: string
  url?: string
  sharedWith?: string
  sharedWithName?: string
  expiration?: string
  permissions: number
  hasPassword: boolean
  label: string
  mime: string
  fileId: number
  created: Date
}

export class Ocs {
  constructor(private auth: Auth) {}

  private async call<T>(method: string, path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL('/ocs/v2.php' + path, location.origin)
    url.searchParams.set('format', 'json')
    let body: URLSearchParams | undefined
    if (params && method === 'GET') {
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    } else if (params) {
      body = new URLSearchParams(params)
    }
    const res = await fetch(url, {
      method,
      body,
      credentials: 'omit',
      headers: {
        Authorization: basic(this.auth),
        'OCS-APIRequest': 'true',
        Accept: 'application/json',
      },
    })
    let data: { ocs?: { meta?: { message?: string; statuscode?: number }; data?: T } } = {}
    try {
      data = await res.json()
    } catch {
      /* empty body */
    }
    if (!res.ok) throw new Error(data.ocs?.meta?.message || `Request failed (${res.status})`)
    return data.ocs?.data as T
  }

  async user(): Promise<User> {
    const d = await this.call<any>('GET', '/cloud/user')
    return {
      id: d.id,
      displayName: d['display-name'] || d.displayname || d.id,
      email: d.email || '',
      quota: {
        used: Number(d.quota?.used ?? 0),
        total: Number(d.quota?.total ?? 0),
        relative: Number(d.quota?.relative ?? 0),
      },
    }
  }

  async shares(path?: string): Promise<Share[]> {
    const params: Record<string, string> = path ? { path, reshares: 'true' } : {}
    const list = await this.call<any[]>('GET', '/apps/files_sharing/api/v1/shares', params)
    return (list ?? []).map(toShare)
  }

  async deleteShare(id: string): Promise<void> {
    await this.call('DELETE', `/apps/files_sharing/api/v1/shares/${encodeURIComponent(id)}`)
  }
}

function toShare(d: any): Share {
  return {
    id: String(d.id),
    shareType: Number(d.share_type),
    path: d.path,
    itemType: d.item_type,
    name: d.file_target?.split('/').pop() || d.path?.split('/').pop() || '',
    url: d.url || undefined,
    sharedWith: d.share_with || undefined,
    sharedWithName: d.share_with_displayname || undefined,
    expiration: d.expiration || undefined,
    permissions: Number(d.permissions),
    hasPassword: !!d.password || (d.share_type === 3 && !!d.share_with),
    label: d.label || '',
    mime: d.mimetype || '',
    fileId: Number(d.item_source || d.file_source),
    created: new Date(Number(d.stime) * 1000),
  }
}
