import { useEffect, useRef, useState } from 'react'
import { Cloud, ExternalLink } from 'lucide-react'
import { pollLogin, saveAuth, startLogin, type Auth } from '../api/auth'

export function LoginView({ onDone }: { onDone: (a: Auth) => void }) {
  const [flow, setFlow] = useState<{ loginUrl: string } | null>(null)
  const [error, setError] = useState('')
  const abort = useRef<AbortController | null>(null)

  useEffect(() => () => abort.current?.abort(), [])

  async function begin() {
    setError('')
    // Open the tab synchronously (inside the click) so popup blockers allow it.
    const win = window.open('about:blank', '_blank')
    if (win) win.opener = null
    try {
      const f = await startLogin()
      setFlow(f)
      if (win) win.location.href = f.loginUrl
      abort.current?.abort()
      abort.current = new AbortController()
      const auth = await pollLogin(f.token, abort.current.signal)
      if (!auth) return
      await saveAuth(auth)
      try {
        win?.close()
      } catch {
        /* cross-origin tab, leave it */
      }
      onDone(auth)
    } catch (e) {
      win?.close()
      setFlow(null)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="login">
      <div className="login-card">
        <div className="brand-mark">
          <Cloud />
        </div>
        <h1>Cloud</h1>
        <p>Your files, photos and downloads from Nextcloud.</p>
        {flow ? (
          <div className="login-wait">
            <div className="spinner" />
            <p>Finish signing in on the Nextcloud tab, then grant access. This page continues on its own.</p>
            <a className="btn btn-text state has-icon" href={flow.loginUrl} target="_blank" rel="noreferrer">
              <ExternalLink /> Open sign-in again
            </a>
            <button
              className="btn btn-text state"
              onClick={() => {
                abort.current?.abort()
                setFlow(null)
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button className="btn btn-filled state" onClick={begin}>
            Sign in with Nextcloud
          </button>
        )}
        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      </div>
    </div>
  )
}
