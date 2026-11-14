// Client for the media downloader service (/dl/api, see downloader/app.py).
import { basic, type Auth } from './auth'

export interface DlJob {
  id: string
  url: string
  site: string
  status: 'queued' | 'running' | 'uploading' | 'done' | 'error'
  message: string
  progress: string
  files: string[]
  folder: string
  created: number
  updated: number
  /** Set when the same link was already downloaded in the last minutes. */
  duplicate?: boolean
  /** Files skipped because this user downloaded them before. */
  skipped?: number
}

export class Dl {
  constructor(private auth: Auth) {}

  private async call<T>(method: string, path: string, body?: BodyInit, type = 'application/json'): Promise<T> {
    const res = await fetch('/dl/api' + path, {
      method,
      body,
      credentials: 'omit',
      headers: { Authorization: basic(this.auth), ...(body ? { 'Content-Type': type } : {}) },
    })
    let data: any = {}
    try {
      data = await res.json()
    } catch {
      /* empty */
    }
    if (!res.ok) throw new Error(data.error || `Download service error (${res.status})`)
    return data as T
  }

  jobs = () => this.call<{ jobs: DlJob[] }>('GET', '/jobs').then((r) => r.jobs)
  start = (urls: string[]) => this.call<{ jobs: DlJob[] }>('POST', '/jobs', JSON.stringify({ urls })).then((r) => r.jobs)
  /** Runs a job again; only media not downloaded before is fetched unless `all` is set. */
  retry = (id: string, all = false) => this.call('POST', `/jobs/${id}/retry`, JSON.stringify({ all }))
  remove = (id: string) => this.call('DELETE', `/jobs/${id}`)
  cookies = () => this.call<{ domains: string[]; updated: number | null }>('GET', '/cookies')
  setCookies = (text: string) => this.call<{ rows: number }>('PUT', '/cookies', text, 'text/plain')
  clearCookies = () => this.call('DELETE', '/cookies')
}

/** Pulls the first web link out of shared text ("Look at this https://x.com/..."). */
export function extractUrls(text: string): string[] {
  return Array.from(text.matchAll(/https?:\/\/[^\s<>"']+/g), (m) => m[0].replace(/[),.!?]+$/, ''))
}
