import { createContext, useContext, useEffect, useState } from 'react'
import type { Dav, Node } from './api/dav'
import type { Ocs, User } from './api/ocs'
import type { UploadInput } from './components/Uploads'

export interface App {
  dav: Dav
  ocs: Ocs
  user: User | null
  /** Bumped after any change, so views reload. */
  version: number
  changed: () => void
  openViewer: (items: Node[], index: number) => void
  upload: (dir: string, files: UploadInput[]) => void
  share: (node: Node) => void
  signOut: () => void
}

export const AppCtx = createContext<App>(null!)
export const useApp = () => useContext(AppCtx)

/** Loads data with cancellation; reloads when deps or app.version change. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: unknown; loading: boolean } {
  const { version } = useApp()
  const [state, setState] = useState<{ data: T | null; error: unknown; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  })
  useEffect(() => {
    let alive = true
    setState((s) => ({ ...s, loading: true, error: null }))
    fn().then(
      (data) => alive && setState({ data, error: null, loading: false }),
      (error) => alive && setState({ data: null, error, loading: false }),
    )
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version])
  return state
}
