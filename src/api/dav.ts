// WebDAV client for Nextcloud: files, search, trash, uploads.
import { basic, type Auth } from './auth'

export interface Node {
  /** Path inside the user's files, always starting with "/" ("/" is the root). */
  path: string
  name: string
  isDir: boolean
  size: number
  mime: string
  modified: Date
  fileId: number
  etag: string
  hasPreview: boolean
  favorite: boolean
  permissions: string
  shared: boolean
  /** Photos only: capture time from EXIF when Nextcloud has it. */
  taken?: Date
  width?: number
  height?: number
}

export interface TrashItem {
  /** Name inside the trash collection (filename.d<timestamp>). */
  id: string
  name: string
  originalLocation: string
  deletedAt: Date
  isDir: boolean
  size: number
  mime: string
  fileId: number
  hasPreview: boolean
}

export class DavError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

const NS = {
  d: 'DAV:',
  oc: 'http://owncloud.org/ns',
  nc: 'http://nextcloud.org/ns',
}

const FILE_PROPS = `
  <d:getlastmodified/><d:getetag/><d:getcontenttype/><d:resourcetype/>
  <d:getcontentlength/><oc:size/><oc:fileid/><oc:permissions/><oc:favorite/>
  <nc:has-preview/><oc:share-types/>
  <nc:metadata-photos-original_date_time/><nc:metadata-photos-size/>`

const XMLNS = `xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns"`

export class Dav {
  readonly user: string
  private auth: Auth

  constructor(auth: Auth) {
    this.auth = auth
    this.user = auth.loginName
  }

  /** URL of a file in the user's tree, for use as src/href (auth added by the service worker). */
  fileUrl(path: string, opts: { inline?: boolean; zip?: boolean } = {}): string {
    const q = new URLSearchParams()
    if (opts.inline) q.set('inline', '1')
    if (opts.zip) q.set('accept', 'zip')
    const qs = q.toString()
    return this.filesRoot() + encodePath(path) + (qs ? '?' + qs : '')
  }

  previewUrl(fileId: number, size = 256, crop = true, etag = ''): string {
    const q = new URLSearchParams({
      fileId: String(fileId),
      x: String(size),
      y: String(size),
      a: crop ? '0' : '1',
      mode: crop ? 'cover' : 'contain',
    })
    if (etag) q.set('v', etag.replace(/"/g, ''))
    return '/index.php/core/preview?' + q.toString()
  }

  filesRoot(): string {
    return `/remote.php/dav/files/${encodeURIComponent(this.user)}`
  }

  async request(method: string, url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set('Authorization', basic(this.auth))
    const res = await fetch(url, { ...init, method, headers, credentials: 'omit' })
    if (!res.ok && res.status !== 207) {
      let msg = res.statusText || `HTTP ${res.status}`
      try {
        const text = await res.text()
        const m = text.match(/<s:message>([^<]*)<\/s:message>/)
        if (m && m[1]) msg = decodeXml(m[1])
      } catch {
        /* keep status text */
      }
      throw new DavError(res.status, msg)
    }
    return res
  }

  async list(path: string): Promise<{ self: Node; children: Node[] }> {
    const res = await this.request('PROPFIND', this.filesRoot() + encodePath(path), {
      headers: { Depth: '1', 'Content-Type': 'application/xml' },
      body: `<?xml version="1.0"?><d:propfind ${XMLNS}><d:prop>${FILE_PROPS}</d:prop></d:propfind>`,
    })
    const nodes = this.parseNodes(await res.text())
    const norm = normDir(path)
    const self = nodes.find((n) => normDir(n.path) === norm) ?? nodes[0]
    const children = nodes.filter((n) => n !== self)
    return { self, children }
  }

  async quota(): Promise<{ used: number; available: number }> {
    const res = await this.request('PROPFIND', this.filesRoot() + '/', {
      headers: { Depth: '0', 'Content-Type': 'application/xml' },
      body: `<?xml version="1.0"?><d:propfind ${XMLNS}><d:prop><d:quota-used-bytes/><d:quota-available-bytes/></d:prop></d:propfind>`,
    })
    const doc = parseXml(await res.text())
    const used = Number(text(doc, NS.d, 'quota-used-bytes') || 0)
    const available = Number(text(doc, NS.d, 'quota-available-bytes') || -1)
    return { used, available }
  }

  /** Searches the whole tree. `where` is a DAV basicsearch condition. */
  async search(where: string, opts: { limit?: number; offset?: number; order?: string } = {}): Promise<Node[]> {
    const limit = opts.limit ?? 200
    const order = opts.order ?? '<d:prop><d:getlastmodified/></d:prop><d:descending/>'
    const body = `<?xml version="1.0"?>
<d:searchrequest ${XMLNS}>
 <d:basicsearch>
  <d:select><d:prop>${FILE_PROPS}<d:displayname/></d:prop></d:select>
  <d:from><d:scope><d:href>/files/${escapeXml(this.user)}</d:href><d:depth>infinity</d:depth></d:scope></d:from>
  <d:where>${where}</d:where>
  <d:orderby><d:order>${order}</d:order></d:orderby>
  <d:limit><d:nresults>${limit}</d:nresults>${opts.offset ? `<ns:firstresult xmlns:ns="https://github.com/icewind1991/SearchDAV/ns">${opts.offset}</ns:firstresult>` : ''}</d:limit>
 </d:basicsearch>
</d:searchrequest>`
    const res = await this.request('SEARCH', '/remote.php/dav/', {
      headers: { 'Content-Type': 'text/xml' },
      body,
    })
    return this.parseNodes(await res.text())
  }

  searchByName(term: string): Promise<Node[]> {
    return this.search(
      `<d:like><d:prop><d:displayname/></d:prop><d:literal>%${escapeXml(escapeLike(term))}%</d:literal></d:like>`,
      { limit: 300 },
    )
  }

  photos(offset: number, limit: number): Promise<Node[]> {
    return this.search(
      `<d:or>
        <d:like><d:prop><d:getcontenttype/></d:prop><d:literal>image/%</d:literal></d:like>
        <d:like><d:prop><d:getcontenttype/></d:prop><d:literal>video/%</d:literal></d:like>
      </d:or>`,
      {
        offset,
        limit,
        order: '<d:prop><nc:metadata-photos-original_date_time/></d:prop><d:descending/>',
      },
    )
  }

  async mkdir(path: string): Promise<void> {
    await this.request('MKCOL', this.filesRoot() + encodePath(path))
  }

  async move(from: string, to: string, overwrite = false): Promise<void> {
    await this.request('MOVE', this.filesRoot() + encodePath(from), {
      headers: {
        Destination: location.origin + this.filesRoot() + encodePath(to),
        Overwrite: overwrite ? 'T' : 'F',
      },
    })
  }

  async copy(from: string, to: string): Promise<void> {
    await this.request('COPY', this.filesRoot() + encodePath(from), {
      headers: { Destination: location.origin + this.filesRoot() + encodePath(to), Overwrite: 'F' },
    })
  }

  async remove(path: string): Promise<void> {
    await this.request('DELETE', this.filesRoot() + encodePath(path))
  }

  async setFavorite(path: string, favorite: boolean): Promise<void> {
    await this.request('PROPPATCH', this.filesRoot() + encodePath(path), {
      headers: { 'Content-Type': 'application/xml' },
      body: `<?xml version="1.0"?><d:propertyupdate ${XMLNS}><d:set><d:prop><oc:favorite>${favorite ? 1 : 0}</oc:favorite></d:prop></d:set></d:propertyupdate>`,
    })
  }

  async favorites(): Promise<Node[]> {
    const res = await this.request('REPORT', this.filesRoot() + '/', {
      headers: { 'Content-Type': 'application/xml' },
      body: `<?xml version="1.0"?><oc:filter-files ${XMLNS}><d:prop>${FILE_PROPS}</d:prop><oc:filter-rules><oc:favorite>1</oc:favorite></oc:filter-rules></oc:filter-files>`,
    })
    return this.parseNodes(await res.text())
  }

  async readText(path: string, maxBytes = 512 * 1024): Promise<string> {
    const res = await this.request('GET', this.filesRoot() + encodePath(path), {
      headers: { Range: `bytes=0-${maxBytes - 1}` },
    })
    return res.text()
  }

  async blob(path: string, zip = false): Promise<Blob> {
    const res = await this.request('GET', this.filesRoot() + encodePath(path) + (zip ? '?accept=zip' : ''))
    return res.blob()
  }

  // ---------- trash ----------

  private trashRoot(): string {
    return `/remote.php/dav/trashbin/${encodeURIComponent(this.user)}`
  }

  async trash(): Promise<TrashItem[]> {
    const res = await this.request('PROPFIND', this.trashRoot() + '/trash', {
      headers: { Depth: '1', 'Content-Type': 'application/xml' },
      body: `<?xml version="1.0"?><d:propfind ${XMLNS}><d:prop>
        <nc:trashbin-filename/><nc:trashbin-original-location/><nc:trashbin-deletion-time/>
        <d:getcontentlength/><oc:size/><d:getcontenttype/><d:resourcetype/><oc:fileid/><nc:has-preview/>
      </d:prop></d:propfind>`,
    })
    const doc = parseXml(await res.text())
    const items: TrashItem[] = []
    for (const r of Array.from(doc.getElementsByTagNameNS(NS.d, 'response'))) {
      const href = decodeURIComponent(text(r, NS.d, 'href'))
      const id = href.replace(/\/$/, '').split('/').pop() ?? ''
      if (href.replace(/\/$/, '').endsWith('/trash')) continue
      const isDir = r.getElementsByTagNameNS(NS.d, 'collection').length > 0
      items.push({
        id,
        name: text(r, NS.nc, 'trashbin-filename') || id,
        originalLocation: text(r, NS.nc, 'trashbin-original-location'),
        deletedAt: new Date(Number(text(r, NS.nc, 'trashbin-deletion-time')) * 1000),
        isDir,
        size: Number(text(r, NS.oc, 'size') || text(r, NS.d, 'getcontentlength') || 0),
        mime: isDir ? 'inode/directory' : text(r, NS.d, 'getcontenttype'),
        fileId: Number(text(r, NS.oc, 'fileid') || 0),
        hasPreview: text(r, NS.nc, 'has-preview') === 'true',
      })
    }
    return items.sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime())
  }

  async restore(item: TrashItem): Promise<void> {
    await this.request('MOVE', `${this.trashRoot()}/trash/${encodeURIComponent(item.id)}`, {
      headers: {
        Destination: `${location.origin}${this.trashRoot()}/restore/${encodeURIComponent(item.id)}`,
      },
    })
  }

  async deleteForever(item: TrashItem): Promise<void> {
    await this.request('DELETE', `${this.trashRoot()}/trash/${encodeURIComponent(item.id)}`)
  }

  async emptyTrash(): Promise<void> {
    await this.request('DELETE', `${this.trashRoot()}/trash`)
  }

  // ---------- uploads ----------

  /**
   * Uploads one file. Files over CHUNK_SIZE use Nextcloud's chunked upload, so
   * big videos don't hit request size limits and progress stays accurate.
   */
  async upload(
    dir: string,
    file: File,
    onProgress: (loaded: number) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const target = joinPath(dir, file.name)
    if (file.size <= CHUNK_SIZE) {
      await this.xhrPut(this.filesRoot() + encodePath(target), file, onProgress, signal, {
        'X-OC-Mtime': String(Math.floor(file.lastModified / 1000)),
      })
      return
    }
    const dest = location.origin + this.filesRoot() + encodePath(target)
    const uploadDir = `/remote.php/dav/uploads/${encodeURIComponent(this.user)}/cloud-ui-${crypto.randomUUID()}`
    await this.request('MKCOL', uploadDir, { headers: { Destination: dest } })
    try {
      let sent = 0
      for (let i = 0, n = 1; i < file.size; i += CHUNK_SIZE, n++) {
        const chunk = file.slice(i, i + CHUNK_SIZE)
        const base = sent
        await this.xhrPut(`${uploadDir}/${String(n).padStart(5, '0')}`, chunk, (l) => onProgress(base + l), signal, {
          Destination: dest,
          'OC-Total-Length': String(file.size),
        })
        sent += chunk.size
      }
      await this.request('MOVE', `${uploadDir}/.file`, {
        headers: {
          Destination: dest,
          'OC-Total-Length': String(file.size),
          'X-OC-Mtime': String(Math.floor(file.lastModified / 1000)),
          Overwrite: 'T',
        },
      })
    } catch (e) {
      this.request('DELETE', uploadDir).catch(() => {})
      throw e
    }
  }

  private xhrPut(
    url: string,
    body: Blob,
    onProgress: (loaded: number) => void,
    signal: AbortSignal,
    extra: Record<string, string>,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('PUT', url)
      xhr.setRequestHeader('Authorization', basic(this.auth))
      for (const [k, v] of Object.entries(extra)) xhr.setRequestHeader(k, v)
      xhr.upload.onprogress = (e) => onProgress(e.loaded)
      xhr.onload = () =>
        xhr.status >= 200 && xhr.status < 300
          ? resolve()
          : reject(new DavError(xhr.status, xhr.status === 507 ? 'Not enough storage space' : `Upload failed (${xhr.status})`))
      xhr.onerror = () => reject(new DavError(0, 'Network error during upload'))
      xhr.onabort = () => reject(new DavError(0, 'Upload cancelled'))
      signal.addEventListener('abort', () => xhr.abort(), { once: true })
      xhr.send(body)
    })
  }

  // ---------- parsing ----------

  private parseNodes(xml: string): Node[] {
    const doc = parseXml(xml)
    const prefix = this.filesRoot()
    const out: Node[] = []
    for (const r of Array.from(doc.getElementsByTagNameNS(NS.d, 'response'))) {
      // Only the 200 propstat holds values; 404 lists the props that don't exist.
      const ok = Array.from(r.getElementsByTagNameNS(NS.d, 'propstat')).find((ps) =>
        /\s200\s/.test(text(ps, NS.d, 'status')),
      )
      if (!ok) continue
      const href = text(r, NS.d, 'href')
      let path = decodeURIComponent(href)
      const rootDecoded = decodeURIComponent(prefix)
      if (path.startsWith(rootDecoded)) path = path.slice(rootDecoded.length)
      const isDir = ok.getElementsByTagNameNS(NS.d, 'collection').length > 0
      path = '/' + path.replace(/^\/+/, '').replace(/\/$/, '')
      const name = path === '/' ? 'Files' : path.split('/').pop()!
      const takenSec = Number(text(ok, NS.nc, 'metadata-photos-original_date_time'))
      const sizeEl = ok.getElementsByTagNameNS(NS.nc, 'metadata-photos-size')[0]
      out.push({
        path,
        name,
        isDir,
        size: Number(text(ok, NS.oc, 'size') || text(ok, NS.d, 'getcontentlength') || 0),
        mime: isDir ? 'inode/directory' : text(ok, NS.d, 'getcontenttype'),
        modified: new Date(text(ok, NS.d, 'getlastmodified')),
        fileId: Number(text(ok, NS.oc, 'fileid')),
        etag: text(ok, NS.d, 'getetag'),
        hasPreview: text(ok, NS.nc, 'has-preview') === 'true',
        favorite: text(ok, NS.oc, 'favorite') === '1',
        permissions: text(ok, NS.oc, 'permissions'),
        shared: ok.getElementsByTagNameNS(NS.oc, 'share-type').length > 0,
        taken: takenSec ? new Date(takenSec * 1000) : undefined,
        width: sizeEl ? Number(text(sizeEl, '*', 'width')) || undefined : undefined,
        height: sizeEl ? Number(text(sizeEl, '*', 'height')) || undefined : undefined,
      })
    }
    return out
  }
}

export const CHUNK_SIZE = 50 * 1024 * 1024

export function encodePath(path: string): string {
  return path
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/')
}

export function joinPath(dir: string, name: string): string {
  return (dir.replace(/\/+$/, '') + '/' + name).replace(/^\/*/, '/')
}

export function parentOf(path: string): string {
  const p = path.replace(/\/+$/, '')
  const i = p.lastIndexOf('/')
  return i <= 0 ? '/' : p.slice(0, i)
}

function normDir(p: string): string {
  return '/' + p.replace(/^\/+|\/+$/g, '')
}

function parseXml(xml: string): Document {
  return new DOMParser().parseFromString(xml, 'application/xml')
}

function text(el: Element | Document, ns: string, name: string): string {
  const found = el.getElementsByTagNameNS(ns, name)[0]
  return found?.textContent?.trim() ?? ''
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!)
}

function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, (c) => '\\' + c)
}

function decodeXml(s: string): string {
  return new DOMParser().parseFromString(`<x>${s}</x>`, 'application/xml').documentElement.textContent ?? s
}
