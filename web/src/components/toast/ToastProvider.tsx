import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import Icon, { type IconName } from '../Icon'
import './toast.css'

export type ToastKind = 'success' | 'info' | 'warning' | 'error' | 'task'
export type ToastOptions = {
  description?: string
  duration?: number
  persistent?: boolean
  dedupeKey?: string
  action?: { label: string; href?: string; onClick?: () => void }
}
type ToastEntry = ToastOptions & { id: string; kind: ToastKind; title: string; revision: number }
type ToastApi = Record<ToastKind, (title: string, options?: ToastOptions) => string> & { dismiss: (id: string) => void }

const ToastContext = createContext<ToastApi | null>(null)
const DEFAULT_DURATION: Record<ToastKind, number> = { success: 3500, info: 4500, warning: 7000, error: 9000, task: 6000 }
const ICON: Record<ToastKind, IconName> = { success: 'check', info: 'message', warning: 'warning', error: 'warning', task: 'clock' }

function ToastCard({ item, dismiss }: { item: ToastEntry; dismiss: (id: string) => void }) {
  const { t } = useTranslation('common')
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    if (paused || item.persistent) return
    const timer = window.setTimeout(() => dismiss(item.id), item.duration ?? DEFAULT_DURATION[item.kind])
    return () => window.clearTimeout(timer)
  }, [dismiss, item.duration, item.id, item.kind, item.persistent, item.revision, paused])
  const action = item.action
  const actionContent = action && (action.href
    ? <a href={action.href} onClick={() => dismiss(item.id)}>{action.label}<Icon name="chevronRight" size={13} /></a>
    : <button type="button" onClick={() => { action.onClick?.(); dismiss(item.id) }}>{action.label}<Icon name="chevronRight" size={13} /></button>)
  return <article
    className={`global-toast ${item.kind} ${item.description || actionContent ? 'expanded' : 'compact'}`}
    role={item.kind === 'error' || item.kind === 'warning' ? 'alert' : 'status'}
    aria-live={item.kind === 'error' ? 'assertive' : 'polite'}
    aria-atomic="true"
    onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
  >
    <header className="global-toast-header">
      <span className="global-toast-icon"><Icon name={ICON[item.kind]} size={14} /></span>
      <strong>{item.title}</strong>
      <button type="button" className="global-toast-close" aria-label={t('actions.close')} onClick={() => dismiss(item.id)}><Icon name="close" size={16} /></button>
    </header>
    {(item.description || actionContent) && <div className="global-toast-body">{item.description && <p>{item.description}</p>}{actionContent && <footer>{actionContent}</footer>}</div>}
    {!item.persistent && <i key={item.revision} className="global-toast-timer" style={{ animationDuration: `${item.duration ?? DEFAULT_DURATION[item.kind]}ms`, animationPlayState: paused ? 'paused' : 'running' }} />}
  </article>
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastEntry[]>([])
  const dismiss = useCallback((id: string) => setItems(current => current.filter(item => item.id !== id)), [])
  const push = useCallback((kind: ToastKind, title: string, options: ToastOptions = {}) => {
    const id = options.dedupeKey || (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)
    setItems(current => {
      const previous = current.find(item => item.id === id)
      const entry = { ...options, id, kind, title, revision: (previous?.revision ?? 0) + 1 }
      const next = previous ? current.map(item => item.id === id ? entry : item) : [entry, ...current]
      return next.slice(0, 3)
    })
    return id
  }, [])
  const value = useMemo<ToastApi>(() => ({
    success: (title, options) => push('success', title, options),
    info: (title, options) => push('info', title, options),
    warning: (title, options) => push('warning', title, options),
    error: (title, options) => push('error', title, options),
    task: (title, options) => push('task', title, options),
    dismiss,
  }), [dismiss, push])
  return <ToastContext.Provider value={value}>{children}{createPortal(<div className="toast-stack" aria-label="Notifications">{items.map(item => <ToastCard key={item.id} item={item} dismiss={dismiss} />)}</div>, document.body)}</ToastContext.Provider>
}

export function useToast() {
  const value = useContext(ToastContext)
  if (!value) throw new Error('useToast must be used inside ToastProvider')
  return value
}
