import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Check, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

// ---------- menu ----------

export type MenuEntry =
  | { label: string; icon?: LucideIcon; onClick: () => void; danger?: boolean; checked?: boolean }
  | { header: string }
  | 'sep'

interface MenuState {
  x: number
  y: number
  alignRight: boolean
  items: MenuEntry[]
}

function Menu({ state, onClose }: { state: MenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: state.x, top: state.y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    let left = state.alignRight ? state.x - r.width : state.x
    let top = state.y
    if (left + r.width > innerWidth - 8) left = innerWidth - r.width - 8
    if (left < 8) left = 8
    if (top + r.height > innerHeight - 8) top = Math.max(8, state.y - r.height - 8)
    setPos({ left, top })
    el.querySelector('button')?.focus()
  }, [state])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const btns = Array.from(ref.current?.querySelectorAll('button') ?? [])
        const i = btns.indexOf(document.activeElement as HTMLButtonElement)
        const n = e.key === 'ArrowDown' ? i + 1 : i - 1
        btns[(n + btns.length) % btns.length]?.focus()
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="menu-layer" onMouseDown={onClose} onContextMenu={(e) => (e.preventDefault(), onClose())}>
      <div
        ref={ref}
        className="menu"
        role="menu"
        style={pos}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {state.items.map((it, i) => {
          if (it === 'sep') return <hr key={i} />
          if ('header' in it)
            return (
              <div key={i} className="menu-label">
                {it.header}
              </div>
            )
          const Icon = it.icon
          return (
            <button
              key={i}
              role="menuitem"
              className={'state' + (it.danger ? ' danger' : '')}
              onClick={() => {
                onClose()
                it.onClick()
              }}
            >
              {Icon && <Icon />}
              <span>{it.label}</span>
              {it.checked && <Check className="check-mark" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---------- dialogs ----------

export function Dialog({
  title,
  description,
  children,
  actions,
  onClose,
  wide,
}: {
  title: string
  description?: ReactNode
  children?: ReactNode
  actions: ReactNode
  onClose: () => void
  wide?: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="scrim" onMouseDown={onClose}>
      <div
        className={'dialog' + (wide ? ' wide' : '')}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="dialog-head">
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {children && <div className="dialog-body">{children}</div>}
        <div className="dialog-actions">{actions}</div>
      </div>
    </div>
  )
}

interface ConfirmOpts {
  title: string
  body?: ReactNode
  confirmLabel?: string
  danger?: boolean
}

interface PromptOpts {
  title: string
  label: string
  value?: string
  confirmLabel?: string
  /** Select only the name part (before the extension) on open. */
  selectStem?: boolean
}

function PromptDialog({ opts, done }: { opts: PromptOpts; done: (v: string | null) => void }) {
  const [value, setValue] = useState(opts.value ?? '')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    const dot = opts.selectStem ? (opts.value ?? '').lastIndexOf('.') : -1
    el.setSelectionRange(0, dot > 0 ? dot : el.value.length)
  }, [opts])
  const ok = value.trim() !== '' && !/[/\\]/.test(value)
  return (
    <Dialog
      title={opts.title}
      onClose={() => done(null)}
      actions={
        <>
          <button className="btn btn-text state" onClick={() => done(null)}>
            Cancel
          </button>
          <button className="btn btn-filled state" disabled={!ok} onClick={() => done(value.trim())}>
            {opts.confirmLabel ?? 'OK'}
          </button>
        </>
      }
    >
      <form
        className="field"
        onSubmit={(e) => {
          e.preventDefault()
          if (ok) done(value.trim())
        }}
      >
        <label htmlFor="prompt-input">{opts.label}</label>
        <input id="prompt-input" ref={ref} className="input" value={value} onChange={(e) => setValue(e.target.value)} />
      </form>
    </Dialog>
  )
}

// ---------- snackbar ----------

interface Toast {
  id: number
  message: string
  error?: boolean
  action?: { label: string; run: () => void }
}

// ---------- context ----------

interface Ui {
  toast: (message: string, opts?: { error?: boolean; action?: Toast['action'] }) => void
  error: (e: unknown) => void
  confirm: (o: ConfirmOpts) => Promise<boolean>
  prompt: (o: PromptOpts) => Promise<string | null>
  menu: (anchor: HTMLElement | { x: number; y: number }, items: MenuEntry[]) => void
  /** Shows any custom dialog; the render function receives a close callback. */
  show: (render: (close: () => void) => ReactNode) => void
}

const UiCtx = createContext<Ui>(null!)
export const useUi = () => useContext(UiCtx)

export function UiProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [modal, setModal] = useState<ReactNode>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const timer = useRef<number>(0)

  const showToast = useCallback<Ui['toast']>((message, opts = {}) => {
    clearTimeout(timer.current)
    setToast({ id: Date.now(), message, ...opts })
    timer.current = window.setTimeout(() => setToast(null), opts.action ? 6000 : 4000)
  }, [])

  const ui: Ui = {
    toast: showToast,
    error: (e) => showToast(e instanceof Error ? e.message : String(e), { error: true }),
    confirm: (o) =>
      new Promise((resolve) => {
        const done = (v: boolean) => {
          setModal(null)
          resolve(v)
        }
        setModal(
          <Dialog
            title={o.title}
            description={o.body}
            onClose={() => done(false)}
            actions={
              <>
                <button className="btn btn-text state" onClick={() => done(false)}>
                  Cancel
                </button>
                <button
                  className={'btn state ' + (o.danger ? 'btn-danger' : 'btn-filled')}
                  onClick={() => done(true)}
                  autoFocus
                >
                  {o.confirmLabel ?? 'OK'}
                </button>
              </>
            }
          />,
        )
      }),
    prompt: (o) =>
      new Promise((resolve) => {
        setModal(
          <PromptDialog
            opts={o}
            done={(v) => {
              setModal(null)
              resolve(v)
            }}
          />,
        )
      }),
    menu: (anchor, items) => {
      if (anchor instanceof HTMLElement) {
        const r = anchor.getBoundingClientRect()
        const alignRight = r.left > innerWidth / 2
        setMenu({ x: alignRight ? r.right : r.left, y: r.bottom + 4, alignRight, items })
      } else {
        setMenu({ x: anchor.x, y: anchor.y, alignRight: false, items })
      }
    },
    show: (render) => setModal(render(() => setModal(null))),
  }

  const outlet = { menu, setMenu, modal, toast, setToast }
  return (
    <UiCtx.Provider value={ui}>
      <OutletCtx.Provider value={outlet}>{children}</OutletCtx.Provider>
    </UiCtx.Provider>
  )
}

interface Outlet {
  menu: MenuState | null
  setMenu: (m: MenuState | null) => void
  modal: ReactNode
  toast: Toast | null
  setToast: (t: Toast | null) => void
}

const OutletCtx = createContext<Outlet>(null!)

/**
 * Renders menus, dialogs and the snackbar. Place it inside every other context
 * provider, so dialog contents can use them (the app context, for example).
 */
export function UiOutlet() {
  const { menu, setMenu, modal, toast, setToast } = useContext(OutletCtx)
  return (
    <>
      {menu && <Menu state={menu} onClose={() => setMenu(null)} />}
      {modal}
      {toast && (
        <div key={toast.id} className={'snackbar' + (toast.error ? ' error' : '')} role="status">
          <span style={{ flex: 1 }}>{toast.message}</span>
          {toast.action && (
            <button
              className="btn btn-text state"
              onClick={() => {
                toast.action!.run()
                setToast(null)
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button className="icon-btn state" style={{ color: 'inherit' }} aria-label="Dismiss" onClick={() => setToast(null)}>
            <X />
          </button>
        </div>
      )}
    </>
  )
}
