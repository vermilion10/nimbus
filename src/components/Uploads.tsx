import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { DavError, joinPath, parentOf, type Dav } from '../api/dav'
import { formatBytes } from '../util'

export interface UploadInput {
  file: File
  /** Path relative to the target folder, for folder uploads ("a/b/c.jpg"). */
  rel?: string
}

interface Item {
  id: number
  name: string
  dir: string
  file: File
  loaded: number
  state: 'queued' | 'uploading' | 'done' | 'error' | 'cancelled'
  error?: string
  abort: AbortController
}

const PARALLEL = 3
let seq = 0

export function useUploads(dav: Dav, onChanged: () => void) {
  const [items, setItems] = useState<Item[]>([])
  const running = useRef(0)
  const queue = useRef<Item[]>([])
  const changedTimer = useRef(0)

  const update = (id: number, patch: Partial<Item>) =>
    setItems((list) => list.map((it) => (it.id === id ? { ...it, ...patch } : it)))

  const pump = useCallback(() => {
    while (running.current < PARALLEL && queue.current.length) {
      const it = queue.current.shift()!
      if (it.abort.signal.aborted) continue
      running.current++
      update(it.id, { state: 'uploading' })
      let last = 0
      dav
        .upload(
          it.dir,
          it.file,
          (loaded) => {
            // throttle re-renders to ~10/s per file
            const now = performance.now()
            if (now - last > 100 || loaded === it.file.size) {
              last = now
              update(it.id, { loaded })
            }
          },
          it.abort.signal,
        )
        .then(
          () => update(it.id, { state: 'done', loaded: it.file.size }),
          (e: unknown) =>
            update(it.id, {
              state: it.abort.signal.aborted ? 'cancelled' : 'error',
              error: e instanceof Error ? e.message : String(e),
            }),
        )
        .finally(() => {
          running.current--
          clearTimeout(changedTimer.current)
          changedTimer.current = window.setTimeout(onChanged, 400)
          pump()
        })
    }
  }, [dav, onChanged])

  const add = useCallback(
    async (dir: string, inputs: UploadInput[]) => {
      // Create folders first for folder uploads (parents before children).
      const dirs = new Set<string>()
      for (const { rel } of inputs) {
        if (!rel || !rel.includes('/')) continue
        let p = parentOf('/' + rel)
        while (p !== '/') {
          dirs.add(p)
          p = parentOf(p)
        }
      }
      for (const d of [...dirs].sort((a, b) => a.length - b.length)) {
        try {
          await dav.mkdir(joinPath(dir, d))
        } catch (e) {
          if (!(e instanceof DavError && e.status === 405)) throw e // 405: already exists
        }
      }
      const fresh: Item[] = inputs.map(({ file, rel }) => ({
        id: ++seq,
        name: rel || file.name,
        dir: rel && rel.includes('/') ? joinPath(dir, parentOf('/' + rel)) : dir,
        file,
        loaded: 0,
        state: 'queued',
        abort: new AbortController(),
      }))
      queue.current.push(...fresh)
      setItems((list) => [...list.filter((i) => i.state !== 'done'), ...fresh])
      pump()
    },
    [dav, pump],
  )

  const cancelAll = () => {
    for (const it of items) if (it.state === 'queued' || it.state === 'uploading') it.abort.abort()
    queue.current = []
  }

  const clear = () => setItems((list) => list.filter((i) => i.state === 'queued' || i.state === 'uploading'))

  return { items, add, cancelAll, clear }
}

export function UploadPanel({ uploads }: { uploads: ReturnType<typeof useUploads> }) {
  const { items, cancelAll, clear } = uploads
  const [collapsed, setCollapsed] = useState(false)
  const active = items.filter((i) => i.state === 'queued' || i.state === 'uploading')
  const failed = items.filter((i) => i.state === 'error')
  const total = items.reduce((s, i) => s + i.file.size, 0)
  const loaded = items.reduce((s, i) => s + (i.state === 'done' ? i.file.size : i.loaded), 0)

  // Hide the panel a while after everything succeeded.
  useEffect(() => {
    if (items.length && !active.length && !failed.length) {
      const t = setTimeout(clear, 5000)
      return () => clearTimeout(t)
    }
  }, [items.length, active.length, failed.length]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!items.length) return null
  const title = active.length
    ? `Uploading ${active.length} ${active.length === 1 ? 'file' : 'files'}`
    : failed.length
      ? `${failed.length} upload${failed.length === 1 ? '' : 's'} failed`
      : 'Uploads complete'

  return (
    <div className="uploads" role="status">
      <div className="uploads-head">
        <span>{title}</span>
        <button className="icon-btn state" aria-label={collapsed ? 'Expand' : 'Collapse'} onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? <ChevronUp /> : <ChevronDown />}
        </button>
        <button
          className="icon-btn state"
          aria-label={active.length ? 'Cancel uploads' : 'Close'}
          title={active.length ? 'Cancel uploads' : 'Close'}
          onClick={() => {
            cancelAll()
            clear()
          }}
        >
          <X />
        </button>
      </div>
      <div style={{ padding: '0 16px 12px' }}>
        <div className="meter">
          <span style={{ width: `${total ? (loaded / total) * 100 : 0}%` }} />
        </div>
        <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 6 }}>
          {formatBytes(loaded)} of {formatBytes(total)}
        </div>
      </div>
      {!collapsed && (
        <div className="uploads-list">
          {items.map((it) => (
            <div key={it.id} className={'up-item' + (it.state === 'error' ? ' error' : '')}>
              <div className="up-line">
                <span className="up-name" title={it.name}>
                  {it.name}
                </span>
                <span className="up-state">
                  {it.state === 'uploading'
                    ? `${Math.round((it.loaded / Math.max(1, it.file.size)) * 100)}%`
                    : it.state === 'queued'
                      ? 'Waiting'
                      : it.state === 'done'
                        ? 'Done'
                        : it.state === 'cancelled'
                          ? 'Cancelled'
                          : it.error}
                </span>
              </div>
              {it.state === 'uploading' && (
                <div className="meter" style={{ marginTop: 4, height: 3 }}>
                  <span style={{ width: `${(it.loaded / Math.max(1, it.file.size)) * 100}%` }} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Reads files (and whole folders) from a drop event. */
export async function filesFromDrop(dt: DataTransfer): Promise<UploadInput[]> {
  const entries = Array.from(dt.items)
    .map((i) => i.webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => !!e)
  if (!entries.length) return Array.from(dt.files).map((file) => ({ file }))
  const out: UploadInput[] = []
  async function walk(entry: FileSystemEntry, prefix: string): Promise<void> {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej))
      out.push({ file, rel: prefix + file.name })
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      let batch: FileSystemEntry[]
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej))
        for (const e of batch) await walk(e, prefix + entry.name + '/')
      } while (batch.length)
    }
  }
  for (const e of entries) await walk(e, '')
  return out
}
