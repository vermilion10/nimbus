import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Cloud,
  FileUp,
  Files,
  Download,
  Globe,
  FolderPlus,
  FolderUp,
  Image as ImageIcon,
  LogOut,
  Monitor,
  Moon,
  Palette,
  Plus,
  Search,
  Star,
  Sun,
  Trash2,
  X,
} from 'lucide-react'
import { logout, saveAuth, type Auth } from './api/auth'
import { Dav, joinPath, type Node } from './api/dav'
import { Ocs, type User } from './api/ocs'
import { AppCtx, type App as AppApi } from './ctx'
import { PublicLinkDialog } from './components/ShareDialog'
import { NEXTCLOUD_URL, PUBLIC_DIR, SHARING, publicUrl } from './config'
import { UploadPanel, useUploads, type UploadInput } from './components/Uploads'
import { Viewer } from './components/Viewer'
import { UiOutlet, useUi, type MenuEntry } from './components/ui'
import { formatBytes, go, STYLES, useRoute, useTheme, type Mode } from './util'
import { FavoritesView, FilesView, SearchView } from './views/FilesView'
import { PhotosView } from './views/PhotosView'
import { DownloadView } from './views/DownloadView'
import { SharesView } from './views/SharesView'
import { TrashView } from './views/TrashView'

// `bottom: false` items live in the account menu on phones (the bar fits five).
const NAV = [
  { view: 'files', href: '#/files/', label: 'Files', icon: Files, bottom: true },
  { view: 'photos', href: '#/photos', label: 'Photos', icon: ImageIcon, bottom: true },
  { view: 'download', href: '#/download', label: 'Download', icon: Download, bottom: true },
  { view: 'favorites', href: '#/favorites', label: 'Favorites', icon: Star, bottom: false },
  { view: 'shares', href: '#/shares', label: 'Public', icon: Globe, bottom: true },
  { view: 'trash', href: '#/trash', label: 'Trash', icon: Trash2, bottom: true },
] as const

export function Shell({ auth, onSignedOut }: { auth: Auth; onSignedOut: () => void }) {
  const ui = useUi()
  const route = useRoute()
  const [theme, setTheme] = useTheme()
  const dav = useMemo(() => new Dav(auth), [auth])
  const ocs = useMemo(() => new Ocs(auth), [auth])
  const [user, setUser] = useState<User | null>(null)
  const [version, setVersion] = useState(0)
  const [viewer, setViewer] = useState<{ items: Node[]; index: number } | null>(null)
  const changed = useCallback(() => setVersion((v) => v + 1), [])
  const uploads = useUploads(dav, changed)
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ocs.user().then(setUser, (e) => {
      // 401: the app password was revoked in Nextcloud (Security settings)
      if (String(e?.message).match(/401|Unauthori[sz]ed|Current user is not logged in/i)) signOut(false)
    })
  }, [ocs, version]) // eslint-disable-line react-hooks/exhaustive-deps

  async function signOut(revoke = true) {
    if (revoke) await logout(auth).catch(() => {})
    else await saveAuth(null)
    onSignedOut()
  }

  const currentDir = route.view === 'files' ? route.path : '/'

  const app: AppApi = {
    dav,
    ocs,
    user,
    version,
    changed,
    openViewer: (items, index) => setViewer({ items, index }),
    upload: (dir, files) => uploads.add(dir, files).catch(ui.error),
    share: (node) => {
      if (publicUrl(node.path, node.isDir)) ui.show((close) => <PublicLinkDialog node={node} onClose={close} />)
      else if (SHARING)
        ui.toast(`Only items in the ${PUBLIC_DIR.slice(1)} folder can be shared`, { action: { label: `Open ${PUBLIC_DIR.slice(1)}`, run: () => go('#/files' + PUBLIC_DIR) } })
    },
    signOut,
  }

  function newMenu(anchor: HTMLElement) {
    ui.menu(anchor, [
      { label: 'Upload files', icon: FileUp, onClick: () => fileInput.current?.click() },
      { label: 'Upload folder', icon: FolderUp, onClick: () => folderInput.current?.click() },
      'sep',
      {
        label: 'New folder',
        icon: FolderPlus,
        onClick: async () => {
          const name = await ui.prompt({ title: 'New folder', label: 'Folder name', confirmLabel: 'Create' })
          if (!name) return
          try {
            await dav.mkdir(joinPath(currentDir, name))
            changed()
          } catch (e) {
            ui.error(e)
          }
        },
      },
    ])
  }

  function appearanceMenu(anchor: HTMLElement) {
    const modes: { id: Mode; label: string; icon: typeof Sun }[] = [
      { id: 'system', label: 'System', icon: Monitor },
      { id: 'light', label: 'Light', icon: Sun },
      { id: 'dark', label: 'Dark', icon: Moon },
    ]
    const items: MenuEntry[] = [
      { header: 'Style' },
      ...STYLES.map((s) => ({ label: s.label, icon: Palette, checked: theme.style === s.id, onClick: () => setTheme({ style: s.id }) })),
      'sep',
      { header: 'Mode' },
      ...modes.map((m) => ({ label: m.label, icon: m.icon, checked: theme.mode === m.id, onClick: () => setTheme({ mode: m.id }) })),
    ]
    ui.menu(anchor, items)
  }

  function accountMenu(anchor: HTMLElement) {
    ui.menu(anchor, [
      { header: user ? `${user.displayName} · ${formatBytes(user.quota.used)} used` : auth.loginName },
      { label: 'Favorites', icon: Star, onClick: () => go('#/favorites') },
      ...(NEXTCLOUD_URL ? [{ label: 'Open Nextcloud', icon: Cloud, onClick: () => window.open(NEXTCLOUD_URL + '/', '_blank', 'noopener') }] : []),
      { label: 'Sign out', icon: LogOut, onClick: () => signOut() },
    ])
  }

  const ModeIcon = theme.mode === 'dark' ? Moon : theme.mode === 'light' ? Sun : Monitor
  const canUploadHere = route.view === 'files'

  let page
  if (route.view === 'photos') page = <PhotosView />
  else if (route.view === 'favorites') page = <FavoritesView />
  else if (route.view === 'shares') page = <SharesView />
  else if (route.view === 'trash') page = <TrashView />
  else if (route.view === 'search') page = <SearchView query={route.query} />
  else if (route.view === 'download') page = <DownloadView shared={route.shared} />
  else page = <FilesView path={route.path} />

  const quotaPct = user && user.quota.total > 0 ? Math.min(100, (user.quota.used / user.quota.total) * 100) : null

  return (
    <AppCtx.Provider value={app}>
      <div className="shell">
        <aside className="nav" aria-label="Main">
          <div className="brand">
            <span className="brand-mark">
              <Cloud />
            </span>
            Cloud
          </div>
          <button className="fab state" onClick={(e) => (canUploadHere ? newMenu(e.currentTarget) : (go('#/files/'), undefined))}>
            <Plus /> New
          </button>
          {NAV.filter((n) => SHARING || n.view !== 'shares').map((n) => (
            <a key={n.view} href={n.href} className={'nav-item state' + (route.view === n.view ? ' active' : '')}>
              <n.icon />
              {n.label}
            </a>
          ))}
          <div className="nav-spacer" />
          {user && (
            <div className="quota">
              {formatBytes(user.quota.used)} used
              {quotaPct !== null && ` of ${formatBytes(user.quota.total)}`}
              {quotaPct !== null && (
                <div className="meter">
                  <span style={{ width: `${quotaPct}%` }} />
                </div>
              )}
            </div>
          )}
        </aside>

        <header className="bar">
          <SearchBox initial={route.view === 'search' ? route.query : ''} />
          <div className="bar-actions">
            <button className="icon-btn state" aria-label="Appearance" title="Appearance" onClick={(e) => appearanceMenu(e.currentTarget)}>
              <ModeIcon />
            </button>
            <button className="avatar" aria-label="Account" title={user?.displayName ?? auth.loginName} onClick={(e) => accountMenu(e.currentTarget)}>
              {(user?.displayName ?? auth.loginName).slice(0, 1).toUpperCase()}
            </button>
          </div>
        </header>

        <main className="main">{page}</main>

        <nav className="bottom-nav" aria-label="Main">
          {NAV.filter((n) => n.bottom && (SHARING || n.view !== 'shares')).map((n) => (
            <a key={n.view} href={n.href} className={route.view === n.view ? 'active' : ''}>
              <span className="pill state">
                <n.icon />
              </span>
              {n.label}
            </a>
          ))}
        </nav>

        {canUploadHere && (
          <button className="fab state mobile-only fab-float" aria-label="New" onClick={(e) => newMenu(e.currentTarget)}>
            <Plus />
          </button>
        )}
      </div>

      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          if (files.length) app.upload(currentDir, files.map((file) => ({ file })))
          e.target.value = ''
        }}
      />
      <input
        ref={folderInput}
        type="file"
        hidden
        // @ts-expect-error non-standard but supported by all current browsers
        webkitdirectory=""
        onChange={(e) => {
          const inputs: UploadInput[] = Array.from(e.target.files ?? []).map((file) => ({
            file,
            rel: (file as File & { webkitRelativePath: string }).webkitRelativePath || file.name,
          }))
          if (inputs.length) app.upload(currentDir, inputs)
          e.target.value = ''
        }}
      />

      <UploadPanel uploads={uploads} />
      {viewer && <Viewer items={viewer.items} start={viewer.index} onClose={() => setViewer(null)} />}
      <UiOutlet />
    </AppCtx.Provider>
  )
}

function SearchBox({ initial }: { initial: string }) {
  const [q, setQ] = useState(initial)
  const timer = useRef(0)
  useEffect(() => setQ(initial), [initial])
  const submit = (v: string) => {
    clearTimeout(timer.current)
    if (v.trim()) go('#/search?q=' + encodeURIComponent(v.trim()))
  }
  return (
    <form
      className="search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        submit(q)
      }}
    >
      <Search />
      <input
        type="search"
        placeholder="Search files"
        aria-label="Search files"
        value={q}
        onChange={(e) => {
          const v = e.target.value
          setQ(v)
          clearTimeout(timer.current)
          if (v.trim().length >= 2) timer.current = window.setTimeout(() => submit(v), 350)
        }}
      />
      {q && (
        <button
          type="button"
          className="icon-btn state"
          aria-label="Clear search"
          onClick={() => {
            setQ('')
            if (location.hash.startsWith('#/search')) history.back()
          }}
        >
          <X />
        </button>
      )}
    </form>
  )
}
