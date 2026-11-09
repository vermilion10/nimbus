import { RotateCcw, Trash2, X } from 'lucide-react'
import type { TrashItem } from '../api/dav'
import { useApp, useLoad } from '../ctx'
import { useUi } from '../components/ui'
import { formatBytes, formatRelative, iconFor } from '../util'
import { ErrorState, Loading } from './FilesView'

export function TrashView() {
  const app = useApp()
  const ui = useUi()
  const { data, error, loading } = useLoad(() => app.dav.trash(), [])

  async function restore(t: TrashItem) {
    try {
      await app.dav.restore(t)
      app.changed()
      ui.toast(`Restored ${t.name} to ${t.originalLocation.split('/').slice(0, -1).join('/') || 'Files'}`)
    } catch (e) {
      ui.error(e)
    }
  }

  async function destroy(t: TrashItem) {
    const ok = await ui.confirm({
      title: `Delete “${t.name}” forever?`,
      body: 'This can’t be undone.',
      confirmLabel: 'Delete forever',
      danger: true,
    })
    if (!ok) return
    try {
      await app.dav.deleteForever(t)
      app.changed()
    } catch (e) {
      ui.error(e)
    }
  }

  async function empty() {
    const ok = await ui.confirm({
      title: 'Empty trash?',
      body: `All ${data?.length ?? ''} items are deleted forever. This can’t be undone.`,
      confirmLabel: 'Empty trash',
      danger: true,
    })
    if (!ok) return
    try {
      await app.dav.emptyTrash()
      app.changed()
    } catch (e) {
      ui.error(e)
    }
  }

  return (
    <div className="page">
      {loading && <Loading />}
      <div className="page-head">
        <h1 className="page-title">Trash</h1>
        <div className="toolbar">
          {!!data?.length && (
            <button className="btn btn-text state has-icon" onClick={empty}>
              <X /> Empty trash
            </button>
          )}
        </div>
      </div>
      {error ? (
        <ErrorState error={error} />
      ) : data && data.length === 0 ? (
        <div className="empty">
          <Trash2 />
          <h2>Trash is empty</h2>
          <p>Deleted files stay here until you remove them or Nextcloud clears old ones.</p>
        </div>
      ) : (
        <div className="list">
          {data?.map((t) => {
            const Icon = iconFor(t.mime, t.name)
            return (
              <div key={t.id} className="row trash">
                <div className="name">
                  <div className={'thumb' + (t.isDir ? ' folder' : '')}>
                    <Icon />
                  </div>
                  <span title={t.originalLocation}>{t.name}</span>
                  <span className="sub">
                    Deleted {formatRelative(t.deletedAt)} · from /{t.originalLocation.split('/').slice(0, -1).join('/')}
                  </span>
                </div>
                <span className="meta" title={t.originalLocation}>
                  /{t.originalLocation.split('/').slice(0, -1).join('/')}
                </span>
                <span className="meta">
                  {formatRelative(t.deletedAt)}
                  {!t.isDir && ` · ${formatBytes(t.size)}`}
                </span>
                <div className="row-actions">
                  <button className="icon-btn state" title="Restore" aria-label={`Restore ${t.name}`} onClick={() => restore(t)}>
                    <RotateCcw />
                  </button>
                  <button className="icon-btn state" title="Delete forever" aria-label={`Delete ${t.name} forever`} onClick={() => destroy(t)}>
                    <Trash2 />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
