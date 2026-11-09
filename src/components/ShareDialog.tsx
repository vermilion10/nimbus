import { Copy, ExternalLink, Globe } from 'lucide-react'
import type { Node } from '../api/dav'
import { PUBLIC_BASE, PUBLIC_DIR, publicUrl } from '../config'
import { copyText } from '../util'
import { Dialog, useUi } from './ui'

/** Shows the public address of an item inside the public folder. */
export function PublicLinkDialog({ node, onClose }: { node: Node; onClose: () => void }) {
  const ui = useUi()
  const url = publicUrl(node.path, node.isDir)!
  return (
    <Dialog
      wide
      title={`Public link for “${node.name}”`}
      description={
        <>
          Anyone with this link can {node.isDir ? 'browse and download this folder' : 'view and download this file'} on{' '}
          {new URL(PUBLIC_BASE).host}. To unpublish, move it out of {PUBLIC_DIR.slice(1)} or delete it. If the site sits
          behind a cache, it may keep serving a copy for a while.
        </>
      }
      onClose={onClose}
      actions={
        <>
          <a className="btn btn-text state has-icon" href={url} target="_blank" rel="noreferrer">
            <ExternalLink /> Open
          </a>
          <button
            className="btn btn-filled state has-icon"
            onClick={async () => {
              if (await copyText(url)) ui.toast('Link copied')
              onClose()
            }}
          >
            <Copy /> Copy link
          </button>
        </>
      }
    >
      <div className="share-row">
        <Globe size={20} />
        <div className="grow">
          <div className="url" style={{ fontSize: 14, color: 'var(--fg)', whiteSpace: 'normal', wordBreak: 'break-all' }}>
            {url}
          </div>
        </div>
      </div>
    </Dialog>
  )
}
