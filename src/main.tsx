import { Component, StrictMode, useEffect, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/roboto-flex/standard.css'
import '@fontsource-variable/inter'
import './styles/tokens.css'
import './styles/app.css'
import { loadAuth, registerServiceWorker, saveAuth, type Auth } from './api/auth'
import { UiOutlet, UiProvider } from './components/ui'
import { Shell } from './App'
import { LoginView } from './views/LoginView'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="login">
        <div className="login-card">
          <h1>Something went wrong</h1>
          <p>{this.state.error.message}</p>
          <button className="btn btn-filled state" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      </div>
    )
  }
}

// Opened from the phone's Share menu (manifest share_target → /share?url=&text=):
// turn it into a download request inside the app.
if (location.pathname === '/share') {
  const p = new URLSearchParams(location.search)
  const shared = [p.get('url'), p.get('text'), p.get('title')].filter(Boolean).join(' ')
  history.replaceState(null, '', '/#/download?url=' + encodeURIComponent(shared))
}

function Root() {
  const [auth, setAuth] = useState<Auth | null>(loadAuth)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Make sure the service worker has the credentials before media loads.
    registerServiceWorker()
      .then(() => saveAuth(loadAuth()))
      .finally(() => setReady(true))
  }, [])

  if (!ready) return null
  return (
    <UiProvider>
      {auth ? <Shell key={auth.loginName} auth={auth} onSignedOut={() => setAuth(null)} /> : (
        <>
          <LoginView onDone={setAuth} />
          <UiOutlet />
        </>
      )}
    </UiProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </StrictMode>,
)
