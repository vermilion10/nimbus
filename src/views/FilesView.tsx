import { useState } from 'react'
import { ChevronRight, FolderOpen, Grid2x2, List, Search, Star } from 'lucide-react'
import type { Node } from '../api/dav'
import { useApp, useLoad } from '../ctx'
import { FileList, useOpenNode, type Sort } from '../components/FileList'
import { filesFromDrop } from '../components/Uploads'
import { filesHref, go, usePersisted } from '../util'

export function useListPrefs() {
  const [layout, setLayout] = usePersisted<'list' | 'grid'>('layout', 'list')
  const [sort, setSort] = usePersisted<Sort>('sort', { key: 'name', asc: true })
  const toggle = (
    <button
      className="icon-btn state"
      title={layout === 'list' ? 'Grid view' : 'List view'}
      aria-label={layout === 'list' ? 'Grid view' : 'List view'}
      onClick={() => setLayout(layout === 'list' ? 'grid' : 'list')}
    >
      {layout === 'list' ? <Grid2x2 /> : <List />}
    </button>
  )
  return { layout, sort, setSort, toggle }
}

export function Loading() {
  return <div className="progress-linear" aria-label="Loading" />
}

export function ErrorState({ error }: { error: unknown }) {
  return (
    <div className="empty">
      <FolderOpen />
      <h2>Couldn’t load this</h2>
      <p>{error instanceof Error ? error.message : String(error)}</p>
    </div>
  )
}

export function FilesView({ path }: { path: string }) {
  const app = useApp()
  const { dav } = app
  const { data, error, loading } = useLoad(() => dav.list(path), [path])
  const prefs = useListPrefs()
  const open = useOpenNode((p) => go(filesHref(p)))
  const [drag, setDrag] = useState(0)

  const segs = path.split('/').filter(Boolean)
  const crumbs = (
    <nav className="crumbs" aria-label="Folder path">
      <button className="state" onClick={() => go('#/files/')}>
        Files
      </button>
      {segs.map((s, i) => (
        <span key={i} style={{ display: 'contents' }}>
          <ChevronRight className="sep" />
          <button className="state" onClick={() => go(filesHref('/' + segs.slice(0, i + 1).join('/')))}>
            {s}
          </button>
        </span>
      ))}
    </nav>
  )

  return (
    <div
      className="page"
      style={{ position: 'relative', minHeight: '100%' }}
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDrag((d) => d + 1)
        }
      }}
      onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
      onDragLeave={() => setDrag((d) => Math.max(0, d - 1))}
      onDrop={async (e) => {
        e.preventDefault()
        setDrag(0)
        const inputs = await filesFromDrop(e.dataTransfer)
        if (inputs.length) app.upload(path, inputs)
      }}
    >
      {loading && <Loading />}
      {drag > 0 && <div className="dropzone">Drop to upload to {segs.at(-1) ?? 'Files'}</div>}
      {error ? (
        <>
          <div className="page-head">{crumbs}</div>
          <ErrorState error={error} />
        </>
      ) : data ? (
        <FileList
          nodes={data.children}
          layout={prefs.layout}
          sort={prefs.sort}
          onSort={prefs.setSort}
          onOpen={open}
          header={
            <div className="page-head">
              {crumbs}
              <div className="toolbar">{prefs.toggle}</div>
            </div>
          }
          emptyState={
            <div className="empty">
              <FolderOpen />
              <h2>This folder is empty</h2>
              <p>Drop files here, or use New to upload or create a folder.</p>
            </div>
          }
        />
      ) : (
        <div className="page-head">{crumbs}</div>
      )}
    </div>
  )
}

export function FavoritesView() {
  const { dav } = useApp()
  const { data, error, loading } = useLoad(() => dav.favorites(), [])
  const prefs = useListPrefs()
  const open = useOpenNode((p) => go(filesHref(p)))
  return (
    <div className="page">
      {loading && <Loading />}
      {error ? (
        <ErrorState error={error} />
      ) : (
        data && (
          <FileList
            nodes={data}
            layout={prefs.layout}
            sort={prefs.sort}
            onSort={prefs.setSort}
            onOpen={open}
            showLocation
            header={
              <div className="page-head">
                <h1 className="page-title">Favorites</h1>
                <div className="toolbar">{prefs.toggle}</div>
              </div>
            }
            emptyState={
              <div className="empty">
                <Star />
                <h2>No favorites yet</h2>
                <p>Star files and folders from their menu to find them here.</p>
              </div>
            }
          />
        )
      )}
    </div>
  )
}

export function SearchView({ query }: { query: string }) {
  const { dav } = useApp()
  const { data, error, loading } = useLoad<Node[]>(
    () => (query.trim().length >= 2 ? dav.searchByName(query.trim()) : Promise.resolve([])),
    [query],
  )
  const prefs = useListPrefs()
  const open = useOpenNode((p) => go(filesHref(p)))
  return (
    <div className="page">
      {loading && <Loading />}
      {error ? (
        <ErrorState error={error} />
      ) : (
        <FileList
          nodes={data ?? []}
          layout={prefs.layout}
          sort={prefs.sort}
          onSort={prefs.setSort}
          onOpen={open}
          showLocation
          header={
            <div className="page-head">
              <h1 className="page-title">{query ? `Results for “${query}”` : 'Search'}</h1>
              <div className="toolbar">{prefs.toggle}</div>
            </div>
          }
          emptyState={
            !loading && (
              <div className="empty">
                <Search />
                <h2>{query.trim().length < 2 ? 'Type at least two letters' : 'Nothing found'}</h2>
                <p>Search looks at file and folder names in all your files.</p>
              </div>
            )
          }
        />
      )}
    </div>
  )
}
