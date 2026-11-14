import { useEffect, useState } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Info, Link2, MoreVertical } from 'lucide-react'
import type { Node } from '../api/dav'
import { useApp } from '../ctx'
import { formatBytes, formatDateTime, iconFor, kindOf } from '../util'
import { useNodeActions } from './actions'
import { useAuthedSrc } from './media'
import { publicUrl } from '../config'
import { PdfView } from './PdfView'
import { useUi } from './ui'

export function Viewer({ items, start, onClose }: { items: Node[]; start: number; onClose: () => void }) {
  const [index, setIndex] = useState(start)
  const node = items[index]
  const app = useApp()
  const ui = useUi()
  const actions = useNodeActions()

  const prev = () => setIndex((i) => Math.max(0, i - 1))
  const next = () => setIndex((i) => Math.min(items.length - 1, i + 1))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'VIDEO') return
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') prev()
      if (e.key === 'ArrowRight') next()
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })

  // swipe left/right on touch screens
  const [touchX, setTouchX] = useState<number | null>(null)
  // Photos fill the screen: a click hides or shows the controls, a double-click zooms.
  const [chrome, setChrome] = useState(true)
  const [zoom, setZoom] = useState(false)
  useEffect(() => setZoom(false), [index])

  if (!node) return null
  const kind = kindOf(node.mime, node.name)

  return (
    <div
      className={'viewer' + (chrome ? '' : ' bare') + (zoom ? ' zoom' : '')}
      data-kind={kind}
      role="dialog"
      aria-modal="true"
      aria-label={node.name}
    >
      <div
        className="viewer-stage"
        onClick={kind === 'image' ? () => setChrome((c) => !c) : undefined}
        onDoubleClick={kind === 'image' ? () => setZoom((z) => !z) : undefined}
        onTouchStart={(e) =>
          // no swiping between files while panning a PDF or a zoomed photo
          setTouchX(zoom || (e.target as HTMLElement).closest('.pdf') ? null : e.touches[0].clientX)
        }
        onTouchEnd={(e) => {
          if (touchX === null) return
          const dx = e.changedTouches[0].clientX - touchX
          if (dx > 60) prev()
          if (dx < -60) next()
          setTouchX(null)
        }}
      >
        <Content key={node.path} node={node} />
      </div>
      <div className="viewer-bar">
        <button className="icon-btn state" aria-label="Close" onClick={onClose}>
          <ArrowLeft />
        </button>
        <div className="title">
          <span className="name">{node.name}</span>
          {items.length > 1 && (
            <span className="count">
              {index + 1} of {items.length}
            </span>
          )}
        </div>
        <button
          className="icon-btn state"
          aria-label="Details"
          title="Details"
          onClick={() =>
            ui.show((close) => (
              <div className="scrim" onMouseDown={close} >
                <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
                  <div className="dialog-head">
                    <h2 style={{ wordBreak: 'break-word' }}>{node.name}</h2>
                  </div>
                  <div className="dialog-body" style={{ gap: 8 }}>
                    <Detail k="Type" v={node.mime} />
                    <Detail k="Size" v={formatBytes(node.size)} />
                    <Detail k="Modified" v={formatDateTime(node.modified)} />
                    {node.taken && <Detail k="Taken" v={formatDateTime(node.taken)} />}
                    {node.width && <Detail k="Dimensions" v={`${node.width} × ${node.height}`} />}
                    <Detail k="Folder" v={node.path.split('/').slice(0, -1).join('/') || '/'} />
                  </div>
                  <div className="dialog-actions">
                    <button className="btn btn-text state" onClick={close}>
                      Close
                    </button>
                  </div>
                </div>
              </div>
            ))
          }
        >
          <Info />
        </button>
        {publicUrl(node.path, node.isDir) && (
          <button className="icon-btn state" aria-label="Public link" title="Public link" onClick={() => app.share(node)}>
            <Link2 />
          </button>
        )}
        <button className="icon-btn state" aria-label="Download" title="Download" onClick={() => actions.download(node)}>
          <Download />
        </button>
        <button
          className="icon-btn state"
          aria-label="More"
          onClick={(e) =>
            ui.menu(
              e.currentTarget,
              actions.menuFor(node, { showLocation: true }).map((it) =>
                typeof it === 'object' && 'onClick' in it && /Delete|Move|Rename|Show in folder/.test(it.label)
                  ? { ...it, onClick: () => (onClose(), it.onClick()) }
                  : it,
              ),
            )
          }
        >
          <MoreVertical />
        </button>
      </div>
      {index > 0 && (
        <button className="viewer-nav prev" aria-label="Previous" onClick={prev}>
          <ChevronLeft />
        </button>
      )}
      {index < items.length - 1 && (
        <button className="viewer-nav next" aria-label="Next" onClick={next}>
          <ChevronRight />
        </button>
      )}
    </div>
  )
}

function Detail({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '96px 1fr', gap: 12 }}>
      <span style={{ color: 'var(--fg-muted)' }}>{k}</span>
      <span style={{ wordBreak: 'break-all' }}>{v}</span>
    </div>
  )
}

function Content({ node }: { node: Node }) {
  const { dav } = useApp()
  const actions = useNodeActions()
  const kind = kindOf(node.mime, node.name)
  const raw = /gif|svg|webp|avif/.test(node.mime)
  // Large preview for photos (fast); the original for formats previews would flatten.
  const imgSrc = useAuthedSrc(
    kind === 'image' ? (raw || !node.hasPreview ? dav.fileUrl(node.path) : dav.previewUrl(node.fileId, 2048, false, node.etag)) : null,
  )
  const mediaSrc = useAuthedSrc(kind === 'video' || kind === 'audio' ? dav.fileUrl(node.path) : null)
  // Desktop browsers show PDFs in a frame with their own viewer; phones (Chrome
  // on Android blocks PDFs in frames) get pdf.js instead.
  const nativePdf = kind === 'pdf' && navigator.pdfViewerEnabled && !matchMedia('(pointer: coarse)').matches
  const pdfSrc = useAuthedSrc(nativePdf ? dav.fileUrl(node.path, { inline: true }) : null)
  const [text, setText] = useState<string | null>(null)

  useEffect(() => {
    if (kind !== 'text') return
    dav.readText(node.path).then(setText, (e) => setText(`Could not load: ${e.message}`))
  }, [kind, node.path, dav])

  if (kind === 'image') return imgSrc ? <img src={imgSrc} alt={node.name} /> : <div className="spinner" />
  if (kind === 'video')
    return mediaSrc ? <video src={mediaSrc} controls autoPlay playsInline /> : <div className="spinner" />
  if (kind === 'audio') return mediaSrc ? <audio src={mediaSrc} controls autoPlay /> : <div className="spinner" />
  if (kind === 'pdf') {
    if (!nativePdf) return <PdfView url={dav.fileUrl(node.path)} name={node.name} />
    return pdfSrc ? <iframe src={pdfSrc} title={node.name} /> : <div className="spinner" />
  }
  if (kind === 'text') return <pre>{text ?? 'Loading…'}</pre>

  const Icon = iconFor(node.mime, node.name)
  return (
    <div className="viewer-none">
      <Icon />
      <div>
        <div style={{ fontSize: 16, color: '#fff' }}>No preview for this file</div>
        <div>
          {node.mime} · {formatBytes(node.size)}
        </div>
      </div>
      <button className="btn btn-filled state" onClick={() => actions.download(node)}>
        <Download /> Download
      </button>
    </div>
  )
}
