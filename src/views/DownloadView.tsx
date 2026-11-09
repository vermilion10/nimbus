import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Clipboard,
  Cookie,
  Download,
  FolderOpen,
  Loader2,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react'
import { Dl, extractUrls, type DlJob } from '../api/dl'
import { loadAuth } from '../api/auth'
import { parentOf } from '../api/dav'
import { useApp } from '../ctx'
import { useUi } from '../components/ui'
import { filesHref, formatRelative, go } from '../util'

const SITE_LABEL: Record<string, string> = {
  twitter: 'X',
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  reddit: 'Reddit',
  pixiv: 'Pixiv',
  bluesky: 'Bluesky',
  threads: 'Threads',
}

export function DownloadView({ shared }: { shared: string }) {
  const app = useApp()
  const ui = useUi()
  const dl = useMemo(() => new Dl(loadAuth()!), [])
  const [text, setText] = useState('')
  const [jobs, setJobs] = useState<DlJob[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const autoStarted = useRef('')

  const refresh = () =>
    dl.jobs().then(
      (j) => {
        setJobs(j)
        setError('')
      },
      (e) => setError(e.message),
    )

  // Poll while anything is in progress.
  useEffect(() => {
    refresh()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const active = jobs?.some((j) => j.status === 'queued' || j.status === 'running' || j.status === 'uploading')
  useEffect(() => {
    if (!active) return
    const t = setInterval(refresh, 2000)
    return () => clearInterval(t)
  }, [active]) // eslint-disable-line react-hooks/exhaustive-deps

  // Finished jobs add files: refresh other views once.
  const doneCount = jobs?.filter((j) => j.status === 'done').length ?? 0
  const lastDone = useRef(doneCount)
  useEffect(() => {
    if (doneCount > lastDone.current) app.changed()
    lastDone.current = doneCount
  }, [doneCount]) // eslint-disable-line react-hooks/exhaustive-deps

  async function start(urls: string[]) {
    if (!urls.length) {
      ui.toast('No link found. Paste a post link.', { error: true })
      return
    }
    setBusy(true)
    try {
      const created = await dl.start(urls)
      const fresh = created.filter((c) => !c.duplicate)
      if (fresh.length < created.length) ui.toast(fresh.length ? 'Some links were already downloading' : 'Already downloaded just now')
      setJobs((j) => [...fresh, ...(j ?? [])])
      setText('')
    } catch (e) {
      ui.error(e)
    } finally {
      setBusy(false)
    }
  }

  // Opened from the phone's Share menu: start right away.
  useEffect(() => {
    if (!shared || autoStarted.current === shared) return
    autoStarted.current = shared
    // Drop the link from the address first, so reopening the app can't start it again.
    history.replaceState(null, '', '#/download')
    start(extractUrls(shared))
  }, [shared]) // eslint-disable-line react-hooks/exhaustive-deps

  async function paste() {
    try {
      const t = await navigator.clipboard.readText()
      setText((cur) => (cur ? cur + '\n' : '') + t)
    } catch {
      ui.toast('Clipboard not available; long-press the box and paste')
    }
  }

  const urls = extractUrls(text)

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Download</h1>
        <div className="toolbar">
          <button
            className="btn btn-text state has-icon"
            onClick={() => ui.show((close) => <CookiesDialog dl={dl} onClose={close} />)}
          >
            <Cookie /> Logins
          </button>
        </div>
      </div>

      <form
        className="dl-form"
        onSubmit={(e) => {
          e.preventDefault()
          start(urls)
        }}
      >
        <textarea
          className="input dl-input"
          placeholder="Paste links to posts on X, Instagram, Facebook, TikTok, YouTube, Reddit…"
          value={text}
          rows={3}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) start(urls)
          }}
        />
        <div className="dl-actions">
          <button type="button" className="btn btn-text state has-icon" onClick={paste}>
            <Clipboard /> Paste
          </button>
          <span className="dl-hint">{urls.length > 1 ? `${urls.length} links` : 'Saves to Downloads'}</span>
          <button className="btn btn-filled state has-icon" disabled={busy || !urls.length}>
            <Download /> Download
          </button>
        </div>
      </form>

      {error && (
        <div className="empty">
          <AlertCircle />
          <h2>Download service unavailable</h2>
          <p>{error}</p>
        </div>
      )}

      {jobs && jobs.length === 0 && !error && (
        <div className="empty">
          <Download />
          <h2>Nothing downloaded yet</h2>
          <p>On your phone, open a post and use Share → Cloud. On a computer, paste the link above.</p>
        </div>
      )}

      {!!jobs?.length && (
        <div className="list" style={{ marginTop: 8 }}>
          {jobs.map((j) => (
            <JobRow key={j.id} job={j} dl={dl} onChange={refresh} />
          ))}
        </div>
      )}
    </div>
  )
}

function JobRow({ job: j, dl, onChange }: { job: DlJob; dl: Dl; onChange: () => void }) {
  const ui = useUi()
  const app = useApp()
  const running = j.status === 'queued' || j.status === 'running' || j.status === 'uploading'
  const Icon = running ? Loader2 : j.status === 'done' ? CheckCircle2 : AlertCircle
  const state =
    j.status === 'queued'
      ? 'Waiting'
      : j.status === 'running'
        ? `Downloading${j.progress ? ` · ${j.progress}` : ''}`
        : j.status === 'uploading'
          ? `Saving · ${j.progress}`
          : j.message

  async function openResult() {
    if (j.files.length === 1) {
      try {
        const { children } = await app.dav.list(parentOf(j.files[0]))
        const files = children.filter((n) => !n.isDir)
        const i = files.findIndex((n) => n.path === j.files[0])
        if (i >= 0) return app.openViewer(files, i)
      } catch {
        /* fall back to the folder */
      }
    }
    go(filesHref(j.folder))
  }

  return (
    <div className={'row dl-row' + (j.status === 'done' ? ' state' : '')} onClick={j.status === 'done' ? openResult : undefined}>
      <div className={'dl-icon ' + j.status}>
        <Icon className={running ? 'spin' : ''} />
      </div>
      <div className="name" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', rowGap: 2 }}>
        <span title={j.url}>
          <strong style={{ fontWeight: 'var(--label-weight)' as any }}>{SITE_LABEL[j.site] ?? j.site}</strong>{' '}
          <span style={{ color: 'var(--fg-muted)' }}>{j.url.replace(/^https?:\/\/(www\.)?/, '')}</span>
        </span>
        <span className={'dl-state ' + j.status}>
          {state} · {formatRelative(new Date((j.updated || j.created) * 1000))}
        </span>
      </div>
      <div className="row-actions" onClick={(e) => e.stopPropagation()}>
        {j.status === 'done' && (
          <button className="icon-btn state" title="Show in folder" aria-label="Show in folder" onClick={() => go(filesHref(j.folder))}>
            <FolderOpen />
          </button>
        )}
        {j.status === 'error' && (
          <button
            className="icon-btn state"
            title="Retry"
            aria-label="Retry"
            onClick={() => dl.retry(j.id).then(onChange, ui.error)}
          >
            <RotateCcw />
          </button>
        )}
        {!running && (
          <button
            className="icon-btn state"
            title="Remove from list"
            aria-label="Remove from list"
            onClick={() => dl.remove(j.id).then(onChange, ui.error)}
          >
            <X />
          </button>
        )}
      </div>
    </div>
  )
}

function CookiesDialog({ dl, onClose }: { dl: Dl; onClose: () => void }) {
  const ui = useUi()
  const [info, setInfo] = useState<{ domains: string[]; updated: number | null } | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const load = () => dl.cookies().then(setInfo, ui.error)
  useEffect(() => {
    load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const sites = (info?.domains ?? []).filter((d) =>
    /(^|\.)(x|twitter|instagram|facebook|tiktok|youtube|reddit|pixiv|bsky|threads|pinterest)\./.test(d + '.'),
  )

  return (
    <div className="scrim" onMouseDown={onClose}>
      <div className="dialog wide" role="dialog" aria-modal="true" aria-label="Site logins" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2>Site logins</h2>
          <p>
            Instagram, Facebook, Reddit and some X posts only download when logged in. Export cookies for those sites from a
            browser where you're signed in (for example with the “Get cookies.txt LOCALLY” extension) and upload the file
            here. It stays on the server and is used only for your downloads.
          </p>
        </div>
        <div className="dialog-body">
          {info === null ? (
            <div className="skeleton" style={{ height: 56 }} />
          ) : info.domains.length ? (
            <div className="share-row">
              <Cookie size={20} />
              <div className="grow">
                <div>{(sites.length ? sites : info.domains).slice(0, 8).join(', ')}</div>
                <div className="url">
                  {info.domains.length} sites · updated {info.updated ? formatRelative(new Date(info.updated * 1000)) : ''}
                </div>
              </div>
              <button
                className="icon-btn state"
                title="Remove cookies"
                aria-label="Remove cookies"
                onClick={() => dl.clearCookies().then(load, ui.error)}
              >
                <Trash2 />
              </button>
            </div>
          ) : (
            <p style={{ margin: 0, color: 'var(--fg-muted)' }}>No cookies uploaded.</p>
          )}
          <input
            ref={file}
            type="file"
            accept=".txt,text/plain"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (!f) return
              try {
                const r = await dl.setCookies(await f.text())
                ui.toast(`Saved ${r.rows} cookies`)
                load()
              } catch (err) {
                ui.error(err)
              }
            }}
          />
        </div>
        <div className="dialog-actions">
          <button className="btn btn-text state" onClick={onClose}>
            Done
          </button>
          <button className="btn btn-filled state" onClick={() => file.current?.click()}>
            {info?.domains.length ? 'Replace cookies.txt' : 'Upload cookies.txt'}
          </button>
        </div>
      </div>
    </div>
  )
}
