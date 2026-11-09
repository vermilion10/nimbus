import { useEffect, useMemo, useRef, useState } from 'react'
import { Image as ImageIcon, Play } from 'lucide-react'
import type { Node } from '../api/dav'
import { useApp } from '../ctx'
import { useAuthedSrc } from '../components/media'
import { formatMonth, kindOf } from '../util'
import { ErrorState, Loading } from './FilesView'

const PAGE = 120

export function PhotosView() {
  const app = useApp()
  const { dav, version } = app
  const [items, setItems] = useState<Node[]>([])
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const busy = useRef(false)

  async function loadMore(reset = false) {
    if (busy.current) return
    busy.current = true
    setLoading(true)
    try {
      const offset = reset ? 0 : items.length
      const page = await dav.photos(offset, PAGE)
      setItems((prev) => (reset ? page : [...prev, ...page]))
      setDone(page.length < PAGE)
      setError(null)
    } catch (e) {
      setError(e)
    } finally {
      busy.current = false
      setLoading(false)
    }
  }

  useEffect(() => {
    setItems([])
    setDone(false)
    loadMore(true)
  }, [version]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = sentinel.current
    if (!el || done) return
    const io = new IntersectionObserver((e) => e[0].isIntersecting && loadMore(), { rootMargin: '800px' })
    io.observe(el)
    return () => io.disconnect()
  })

  const groups = useMemo(() => {
    const out: { label: string; items: { node: Node; index: number }[] }[] = []
    items.forEach((node, index) => {
      const label = formatMonth(node.taken ?? node.modified)
      if (out.at(-1)?.label !== label) out.push({ label, items: [] })
      out.at(-1)!.items.push({ node, index })
    })
    return out
  }, [items])

  return (
    <div className="page">
      {loading && <Loading />}
      <div className="page-head">
        <h1 className="page-title">Photos</h1>
        <span style={{ marginLeft: 'auto', color: 'var(--fg-muted)', fontSize: 13 }}>
          {items.length > 0 && `${items.length}${done ? '' : '+'} items`}
        </span>
      </div>
      {error ? (
        <ErrorState error={error} />
      ) : items.length === 0 && done ? (
        <div className="empty">
          <ImageIcon />
          <h2>No photos or videos yet</h2>
          <p>Images and videos anywhere in your files show up here, newest first.</p>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.label}>
            <h2 className="month">{g.label}</h2>
            <div className="photo-grid">
              {g.items.map(({ node, index }) => (
                <Photo key={node.path} node={node} onOpen={() => app.openViewer(items, index)} />
              ))}
            </div>
          </section>
        ))
      )}
      {items.length === 0 && !done && (
        <div className="photo-grid" style={{ marginTop: 8 }}>
          {Array.from({ length: 18 }, (_, i) => (
            <div key={i} className="skeleton" style={{ aspectRatio: '1' }} />
          ))}
        </div>
      )}
      <div ref={sentinel} style={{ height: 1 }} />
    </div>
  )
}

function Photo({ node, onOpen }: { node: Node; onOpen: () => void }) {
  const { dav } = useApp()
  const [failed, setFailed] = useState(false)
  const src = useAuthedSrc(node.hasPreview && !failed ? dav.previewUrl(node.fileId, 384, true, node.etag) : null)
  const isVideo = kindOf(node.mime) === 'video'
  return (
    <button className="photo" onClick={onOpen} aria-label={node.name} title={node.name}>
      {src ? (
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      ) : (
        <span style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--fg-muted)' }}>
          {isVideo ? <Play /> : <ImageIcon />}
        </span>
      )}
      {isVideo && (
        <span className="vid">
          <Play fill="currentColor" /> Video
        </span>
      )}
    </button>
  )
}
