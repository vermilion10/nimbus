import { Copy, ExternalLink, FolderOpen, Globe, Link2, Trash2 } from 'lucide-react'
import type { Share } from '../api/ocs'
import { PUBLIC_BASE, PUBLIC_DIR, publicUrl } from '../config'
import { useApp, useLoad } from '../ctx'
import { Thumb } from '../components/FileList'
import { useUi } from '../components/ui'
import { copyText, filesHref, formatBytes, formatRelative, go } from '../util'
import { ErrorState, Loading } from './FilesView'

/** Everything published through the public folder, with its public address. */
export function SharesView() {
  const app = useApp()
  const ui = useUi()
  const pub = useLoad(() => app.dav.list(PUBLIC_DIR), [])
  // Links made in Nextcloud itself (they only open on the tailnet); listed so
  // they can be found and removed.
  const legacy = useLoad(() => app.ocs.shares().then((s) => s.filter((x) => x.shareType === 3)), [])

  async function removeLegacy(s: Share) {
    const ok = await ui.confirm({
      title: 'Remove this Nextcloud link?',
      body: 'Anyone using it loses access right away.',
      confirmLabel: 'Remove',
      danger: true,
    })
    if (!ok) return
    try {
      await app.ocs.deleteShare(s.id)
      app.changed()
    } catch (e) {
      ui.error(e)
    }
  }

  const items = [...(pub.data?.children ?? [])].sort((a, b) => b.modified.getTime() - a.modified.getTime())

  return (
    <div className="page">
      {(pub.loading || legacy.loading) && <Loading />}
      <div className="page-head">
        <h1 className="page-title">Public</h1>
        <div className="toolbar">
          <button className="btn btn-text state has-icon" onClick={() => go(filesHref(PUBLIC_DIR))}>
            <FolderOpen /> Open folder
          </button>
        </div>
      </div>
      <p style={{ margin: '0 0 16px', color: 'var(--fg-muted)', maxWidth: 680 }}>
        Files and folders in <strong>{PUBLIC_DIR.slice(1)}</strong> are published read-only at {new URL(PUBLIC_BASE).host}.
        Put something there to share it, move it out to unpublish.
      </p>
      {pub.error ? (
        <ErrorState error={pub.error} />
      ) : pub.data && items.length === 0 ? (
        <div className="empty">
          <Globe />
          <h2>Nothing published yet</h2>
          <p>Upload or move files into the {PUBLIC_DIR.slice(1)} folder to get a link.</p>
        </div>
      ) : (
        <div className="list">
          {items.map((n) => {
            const url = publicUrl(n.path, n.isDir)!
            return (
              <div
                key={n.path}
                className="row share state"
                onClick={() => (n.isDir ? go(filesHref(n.path)) : app.openViewer([n], 0))}
              >
                <div className="name">
                  <Thumb node={n} />
                  <span title={n.name}>{n.name}</span>
                  <span className="sub">{url.replace(/^https:\/\//, '')}</span>
                </div>
                <span className="meta">{formatBytes(n.size)}</span>
                <span className="meta">{formatRelative(n.modified)}</span>
                <div className="row-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="icon-btn state"
                    title="Copy link"
                    aria-label={`Copy link to ${n.name}`}
                    onClick={async () => (await copyText(url)) && ui.toast('Link copied')}
                  >
                    <Copy />
                  </button>
                  <a className="icon-btn state" title="Open link" aria-label={`Open ${n.name} on the public site`} href={url} target="_blank" rel="noreferrer">
                    <ExternalLink />
                  </a>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!!legacy.data?.length && (
        <>
          <h2 className="month" style={{ marginTop: 32 }}>
            Nextcloud links
          </h2>
          <p style={{ margin: '0 0 8px', color: 'var(--fg-muted)', maxWidth: 680 }}>
            Made in Nextcloud. They point at the private server, so they only open on your tailnet or home network.
          </p>
          <div className="list">
            {legacy.data.map((s) => (
              <div key={s.id} className="row share">
                <div className="name">
                  <div className="thumb">
                    <Link2 />
                  </div>
                  <span title={s.path}>{s.name}</span>
                  <span className="sub">{s.path}</span>
                </div>
                <span className="meta">{s.path}</span>
                <span className="meta">{formatRelative(s.created)}</span>
                <div className="row-actions">
                  <button className="icon-btn state" title="Remove" aria-label={`Remove link to ${s.name}`} onClick={() => removeLegacy(s)}>
                    <Trash2 />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
