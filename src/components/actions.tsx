import { useState } from 'react'
import {
  ChevronRight,
  Copy,
  Download,
  Folder,
  FolderInput,
  FolderOpen,
  Home,
  Link2,
  Pencil,
  Star,
  StarOff,
  Trash2,
} from 'lucide-react'
import { joinPath, parentOf, type Node } from '../api/dav'
import { swActive } from '../api/auth'
import { useApp, useLoad } from '../ctx'
import { publicUrl } from '../config'
import { filesHref, go } from '../util'
import { Dialog, useUi, type MenuEntry } from './ui'

export function useNodeActions() {
  const app = useApp()
  const ui = useUi()
  const { dav } = app

  async function download(n: Node) {
    const href = dav.fileUrl(n.path, { zip: n.isDir })
    const name = n.isDir ? n.name + '.zip' : n.name
    if (swActive()) {
      const a = document.createElement('a')
      a.href = href
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
      return
    }
    // No service worker (first visit, private window): load into memory instead.
    try {
      ui.toast(`Preparing ${name}…`)
      const blob = await dav.blob(n.path, n.isDir)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e) {
      ui.error(e)
    }
  }

  async function rename(n: Node) {
    const name = await ui.prompt({ title: 'Rename', label: 'Name', value: n.name, confirmLabel: 'Rename', selectStem: !n.isDir })
    if (!name || name === n.name) return
    try {
      await dav.move(n.path, joinPath(parentOf(n.path), name))
      app.changed()
    } catch (e) {
      ui.error(e)
    }
  }

  async function moveOrCopy(nodes: Node[], mode: 'move' | 'copy') {
    ui.show((close) => (
      <FolderPicker
        title={`${mode === 'move' ? 'Move' : 'Copy'} ${nodes.length === 1 ? `“${nodes[0].name}”` : `${nodes.length} items`}`}
        confirmLabel={mode === 'move' ? 'Move here' : 'Copy here'}
        start={parentOf(nodes[0].path)}
        exclude={nodes.filter((n) => n.isDir).map((n) => n.path)}
        onCancel={close}
        onPick={async (dir) => {
          close()
          let failed = 0
          for (const n of nodes) {
            try {
              const to = joinPath(dir, n.name)
              if (mode === 'move') await dav.move(n.path, to)
              else await dav.copy(n.path, to)
            } catch (e) {
              failed++
              ui.error(e)
            }
          }
          app.changed()
          if (!failed) ui.toast(`${mode === 'move' ? 'Moved' : 'Copied'} ${nodes.length === 1 ? nodes[0].name : nodes.length + ' items'}`)
        }}
      />
    ))
  }

  async function remove(nodes: Node[]) {
    const label = nodes.length === 1 ? `“${nodes[0].name}”` : `${nodes.length} items`
    const ok = await ui.confirm({
      title: `Delete ${label}?`,
      body: 'It moves to Trash, where you can restore it.',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    for (const n of nodes) {
      try {
        await dav.remove(n.path)
      } catch (e) {
        ui.error(e)
      }
    }
    app.changed()
    ui.toast(`Deleted ${nodes.length === 1 ? nodes[0].name : nodes.length + ' items'}`, {
      action: { label: 'Trash', run: () => go('#/trash') },
    })
  }

  async function toggleFavorite(n: Node) {
    try {
      await dav.setFavorite(n.path, !n.favorite)
      app.changed()
    } catch (e) {
      ui.error(e)
    }
  }

  function menuFor(n: Node, opts: { open?: () => void; showLocation?: boolean } = {}): MenuEntry[] {
    const items: MenuEntry[] = []
    if (opts.open) items.push({ label: n.isDir ? 'Open' : 'Preview', icon: FolderOpen, onClick: opts.open })
    if (opts.showLocation)
      items.push({ label: 'Show in folder', icon: Folder, onClick: () => go(filesHref(parentOf(n.path))) })
    if (publicUrl(n.path, n.isDir)) items.push({ label: 'Public link', icon: Link2, onClick: () => app.share(n) })
    items.push(
      { label: n.isDir ? 'Download as ZIP' : 'Download', icon: Download, onClick: () => download(n) },
      { label: n.favorite ? 'Remove from favorites' : 'Add to favorites', icon: n.favorite ? StarOff : Star, onClick: () => toggleFavorite(n) },
      'sep',
      { label: 'Rename', icon: Pencil, onClick: () => rename(n) },
      { label: 'Move', icon: FolderInput, onClick: () => moveOrCopy([n], 'move') },
      { label: 'Copy', icon: Copy, onClick: () => moveOrCopy([n], 'copy') },
      'sep',
      { label: 'Delete', icon: Trash2, onClick: () => remove([n]), danger: true },
    )
    return items
  }

  return { download, rename, moveOrCopy, remove, toggleFavorite, menuFor }
}

function FolderPicker({
  title,
  confirmLabel,
  start,
  exclude,
  onPick,
  onCancel,
}: {
  title: string
  confirmLabel: string
  start: string
  exclude: string[]
  onPick: (dir: string) => void
  onCancel: () => void
}) {
  const { dav } = useApp()
  const ui = useUi()
  const [dir, setDir] = useState(start)
  const [bump, setBump] = useState(0)
  const { data, loading } = useLoad(() => dav.list(dir), [dir, bump])
  const folders = (data?.children ?? []).filter((n) => n.isDir).sort((a, b) => a.name.localeCompare(b.name))
  const segs = dir.split('/').filter(Boolean)
  const blocked = exclude.some((p) => dir === p || dir.startsWith(p + '/'))

  return (
    <Dialog
      title={title}
      onClose={onCancel}
      actions={
        <>
          <button
            className="btn btn-text state"
            style={{ marginRight: 'auto' }}
            onClick={async () => {
              const name = await ui.prompt({ title: 'New folder', label: 'Folder name', confirmLabel: 'Create' })
              if (!name) return
              try {
                await dav.mkdir(joinPath(dir, name))
                setBump((b) => b + 1)
              } catch (e) {
                ui.error(e)
              }
            }}
          >
            New folder
          </button>
          <button className="btn btn-text state" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-filled state" disabled={blocked} onClick={() => onPick(dir)}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="picker-path">
        <button className="icon-btn state" aria-label="All files" onClick={() => setDir('/')}>
          <Home />
        </button>
        {segs.map((s, i) => (
          <span key={i} style={{ display: 'contents' }}>
            <ChevronRight size={14} />
            <button className="btn btn-text state" style={{ padding: '0 8px', height: 32 }} onClick={() => setDir('/' + segs.slice(0, i + 1).join('/'))}>
              {s}
            </button>
          </span>
        ))}
      </div>
      <div className="picker">
        {loading && !data && <div style={{ padding: 16, color: 'var(--fg-muted)' }}>Loading…</div>}
        {data && folders.length === 0 && <div style={{ padding: 16, color: 'var(--fg-muted)' }}>No folders here</div>}
        {folders.map((f) => (
          <button
            key={f.path}
            className="state"
            disabled={exclude.includes(f.path)}
            style={exclude.includes(f.path) ? { opacity: 0.4 } : undefined}
            onClick={() => setDir(f.path)}
          >
            <Folder />
            <span>{f.name}</span>
          </button>
        ))}
      </div>
    </Dialog>
  )
}
