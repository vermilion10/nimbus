import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckSquare,
  Copy,
  Download,
  FolderInput,
  MoreVertical,
  Share2,
  Star,
  Trash2,
  X,
} from 'lucide-react'
import type { Node } from '../api/dav'
import { publicUrl } from '../config'
import { useApp } from '../ctx'
import { formatBytes, formatRelative, iconFor, kindOf } from '../util'
import { useNodeActions } from './actions'
import { useAuthedSrc } from './media'
import { useUi } from './ui'

export type SortKey = 'name' | 'size' | 'modified'
export interface Sort {
  key: SortKey
  asc: boolean
}

export function sortNodes(nodes: Node[], sort: Sort): Node[] {
  const dir = sort.asc ? 1 : -1
  const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  return [...nodes].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    if (sort.key === 'size') return (a.size - b.size) * dir
    if (sort.key === 'modified') return (a.modified.getTime() - b.modified.getTime()) * dir
    return coll.compare(a.name, b.name) * dir
  })
}

export function Thumb({ node, size = 96, className = 'thumb' }: { node: Node; size?: number; className?: string }) {
  const { dav } = useApp()
  const [failed, setFailed] = useState(false)
  const want = node.hasPreview && !node.isDir && !failed
  const src = useAuthedSrc(want ? dav.previewUrl(node.fileId, size, true, node.etag) : null)
  const Icon = iconFor(node.mime, node.name)
  return (
    <div className={className + (node.isDir ? ' folder' : '') + (src ? ' has-img' : '')}>
      {src ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} /> : <Icon />}
    </div>
  )
}

function CheckBox({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      className={'check state' + (on ? ' on' : '')}
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
    >
      <span className="box">{on && <Check strokeWidth={3} />}</span>
    </button>
  )
}

export function FileList({
  nodes,
  layout,
  sort,
  onSort,
  onOpen,
  header,
  showLocation,
  emptyState,
}: {
  nodes: Node[]
  layout: 'list' | 'grid'
  sort: Sort
  onSort: (s: Sort) => void
  onOpen: (node: Node, index: number, list: Node[]) => void
  header: ReactNode
  showLocation?: boolean
  emptyState?: ReactNode
}) {
  const ui = useUi()
  const app = useApp()
  const actions = useNodeActions()
  const sorted = useMemo(() => sortNodes(nodes, sort), [nodes, sort])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const lastClicked = useRef<number>(-1)

  // Drop selections that no longer exist (after delete/move or navigation).
  useEffect(() => {
    setSelected((s) => {
      const alive = new Set(nodes.map((n) => n.path))
      const next = new Set([...s].filter((p) => alive.has(p)))
      return next.size === s.size ? s : next
    })
  }, [nodes])

  const selNodes = sorted.filter((n) => selected.has(n.path))
  const selecting = selected.size > 0

  function toggle(i: number, range = false) {
    const n = sorted[i]
    setSelected((s) => {
      const next = new Set(s)
      if (range && lastClicked.current >= 0) {
        const [a, b] = [lastClicked.current, i].sort((x, y) => x - y)
        for (let k = a; k <= b; k++) next.add(sorted[k].path)
      } else if (next.has(n.path)) next.delete(n.path)
      else next.add(n.path)
      return next
    })
    lastClicked.current = i
  }

  function click(e: React.MouseEvent, i: number) {
    if (selecting || e.ctrlKey || e.metaKey || e.shiftKey) {
      toggle(i, e.shiftKey)
      return
    }
    onOpen(sorted[i], i, sorted)
  }

  function contextMenu(e: React.MouseEvent, i: number) {
    e.preventDefault()
    const n = sorted[i]
    ui.menu({ x: e.clientX, y: e.clientY }, menuItems(n, i))
  }

  function more(e: React.MouseEvent<HTMLButtonElement>, i: number) {
    e.stopPropagation()
    const n = sorted[i]
    ui.menu(e.currentTarget, menuItems(n, i))
  }

  function menuItems(n: Node, i: number) {
    return [
      { label: selected.has(n.path) ? 'Deselect' : 'Select', icon: CheckSquare, onClick: () => toggle(i) },
      ...actions.menuFor(n, { open: () => onOpen(n, i, sorted), showLocation }),
    ]
  }

  const sortBtn = (key: SortKey, label: string) => (
    <button onClick={() => onSort({ key, asc: sort.key === key ? !sort.asc : key === 'name' })}>
      {label}
      {sort.key === key && (sort.asc ? <ArrowUp /> : <ArrowDown />)}
    </button>
  )

  const selbar = (
    <div className="selbar">
      <button className="icon-btn state" aria-label="Clear selection" onClick={() => setSelected(new Set())}>
        <X />
      </button>
      <strong>{selected.size} selected</strong>
      <button
        className="icon-btn state"
        title="Select all"
        aria-label="Select all"
        onClick={() => setSelected(new Set(sorted.map((n) => n.path)))}
      >
        <Check />
      </button>
      <button className="icon-btn state" title="Download" aria-label="Download" onClick={() => selNodes.forEach((n) => actions.download(n))}>
        <Download />
      </button>
      {selNodes.length === 1 && publicUrl(selNodes[0].path, selNodes[0].isDir) && (
        <button className="icon-btn state" title="Public link" aria-label="Public link" onClick={() => app.share(selNodes[0])}>
          <Share2 />
        </button>
      )}
      <button className="icon-btn state" title="Move" aria-label="Move" onClick={() => actions.moveOrCopy(selNodes, 'move')}>
        <FolderInput />
      </button>
      <button className="icon-btn state" title="Copy" aria-label="Copy" onClick={() => actions.moveOrCopy(selNodes, 'copy')}>
        <Copy />
      </button>
      <button className="icon-btn state" title="Delete" aria-label="Delete" onClick={() => actions.remove(selNodes)}>
        <Trash2 />
      </button>
    </div>
  )

  return (
    <>
      {selecting ? selbar : header}
      {sorted.length === 0 ? (
        emptyState
      ) : layout === 'grid' ? (
        <div className={'grid' + (selecting ? ' selecting' : '')}>
          {sorted.map((n, i) => (
            <div
              key={n.path}
              className={'tile state' + (selected.has(n.path) ? ' selected' : '')}
              onClick={(e) => click(e, i)}
              onContextMenu={(e) => contextMenu(e, i)}
              onKeyDown={(e) => e.key === 'Enter' && onOpen(n, i, sorted)}
              tabIndex={0}
              title={n.name}
            >
              <Thumb node={n} size={320} className="art" />
              <div className="label">
                {n.favorite && <Star className="badge" size={14} fill="currentColor" />}
                <span>{n.name}</span>
                <button className="icon-btn state" aria-label={`Actions for ${n.name}`} onClick={(e) => more(e, i)}>
                  <MoreVertical />
                </button>
              </div>
              <div className="tile-check">
                <CheckBox on={selected.has(n.path)} onToggle={() => toggle(i)} label={`Select ${n.name}`} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={'list' + (selecting ? ' selecting' : '')}>
          <div className="list-head">
            <span />
            {sortBtn('name', 'Name')}
            {sortBtn('size', 'Size')}
            {sortBtn('modified', 'Modified')}
            <span />
          </div>
          {sorted.map((n, i) => (
            <div
              key={n.path}
              className={'row state' + (selected.has(n.path) ? ' selected' : '')}
              onClick={(e) => click(e, i)}
              onContextMenu={(e) => contextMenu(e, i)}
              onKeyDown={(e) => e.key === 'Enter' && onOpen(n, i, sorted)}
              tabIndex={0}
            >
              <CheckBox on={selected.has(n.path)} onToggle={() => toggle(i)} label={`Select ${n.name}`} />
              <div className="name">
                <Thumb node={n} />
                <span title={n.name}>{n.name}</span>
                <span className="sub">
                  {n.isDir ? formatRelative(n.modified) : `${formatBytes(n.size)} · ${formatRelative(n.modified)}`}
                  {showLocation && ` · ${n.path.split('/').slice(0, -1).join('/') || '/'}`}
                </span>
              </div>
              <span className="meta">{formatBytes(n.size)}</span>
              <span className="meta" title={n.modified.toLocaleString()}>
                {formatRelative(n.modified)}
              </span>
              <button className="icon-btn state" aria-label={`Actions for ${n.name}`} onClick={(e) => more(e, i)}>
                <MoreVertical />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

/** Opens a node: folders navigate, files open in the viewer with their siblings. */
export function useOpenNode(navigate: (path: string) => void) {
  const app = useApp()
  return (node: Node, _i: number, list: Node[]) => {
    if (node.isDir) return navigate(node.path)
    const files = list.filter((n) => !n.isDir)
    app.openViewer(files, files.indexOf(node))
  }
}

export const isPreviewable = (n: Node) => kindOf(n.mime, n.name) !== 'other'
