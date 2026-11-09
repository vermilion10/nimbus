import { useEffect, useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { basic, loadAuth } from '../api/auth'

/**
 * Renders a PDF with pdf.js. Used where the browser has no built-in PDF viewer
 * that works inside a page (Chrome on Android shows "This content is blocked").
 * Pages render lazily as they scroll into view; the file is fetched in ranges.
 */
export function PdfView({ url, name }: { url: string; name: string }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState('')
  const [zoom, setZoom] = useState(1)
  const [width, setWidth] = useState(0)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    let task: { destroy: () => Promise<void> } | null = null
    ;(async () => {
      const pdfjs = await import('pdfjs-dist')
      const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default
      const auth = loadAuth()
      const t = pdfjs.getDocument({
        url,
        httpHeaders: auth ? { Authorization: basic(auth) } : undefined,
        withCredentials: false,
        cMapUrl: '/pdfjs/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: '/pdfjs/standard_fonts/',
        iccUrl: '/pdfjs/iccs/',
        wasmUrl: '/pdfjs/wasm/',
        disableAutoFetch: true,
      })
      task = t
      const loaded = await t.promise
      if (!cancelled) setDoc(loaded)
    })().catch((e) => !cancelled && setError(e?.message ?? String(e)))
    return () => {
      cancelled = true
      task?.destroy()
    }
  }, [url])

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div className="pdf" ref={box} aria-label={name}>
      {error && <div className="viewer-none">Couldn’t open this PDF: {error}</div>}
      {!doc && !error && <div className="spinner" style={{ margin: '40vh auto' }} />}
      {doc &&
        width > 0 &&
        Array.from({ length: doc.numPages }, (_, i) => (
          <Page key={i} doc={doc} number={i + 1} width={Math.min(width - 16, 1000) * zoom} />
        ))}
      {doc && (
        <div className="pdf-zoom">
          <button className="icon-btn state" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
            <Minus />
          </button>
          <button className="pdf-pct state" onClick={() => setZoom(1)} title="Fit width">
            {Math.round(zoom * 100)}%
          </button>
          <button className="icon-btn state" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(4, z + 0.25))}>
            <Plus />
          </button>
          <span className="pdf-pages">{doc.numPages} pages</span>
        </div>
      )}
    </div>
  )
}

function Page({ doc, number, width }: { doc: PDFDocumentProxy; number: number; width: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const holder = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(number <= 2)
  const [aspect, setAspect] = useState(1.414)

  useEffect(() => {
    const el = holder.current
    if (!el) return
    const io = new IntersectionObserver((e) => e[0].isIntersecting && setVisible(true), { rootMargin: '600px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    let task: { cancel: () => void } | null = null
    let cancelled = false
    doc.getPage(number).then((page) => {
      if (cancelled) return
      const base = page.getViewport({ scale: 1 })
      setAspect(base.height / base.width)
      const dpr = Math.min(window.devicePixelRatio || 1, 3)
      const viewport = page.getViewport({ scale: (width / base.width) * dpr })
      const c = canvas.current
      if (!c) return
      c.width = Math.floor(viewport.width)
      c.height = Math.floor(viewport.height)
      const t = page.render({ canvas: c, viewport })
      task = t
      t.promise.catch(() => {})
    })
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [doc, number, width, visible])

  return (
    <div ref={holder} className="pdf-page" style={{ width, height: width * aspect }}>
      <canvas ref={canvas} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}
