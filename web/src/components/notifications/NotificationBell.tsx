import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { notificationsApi } from '../../notifications/api'
import type { InAppNotification, NotificationPage, NotificationScope } from '../../notifications/types'
import Icon from '../Icon'
import NotificationItem from './NotificationItem'
import '../../styles/notifications.css'

const empty: NotificationPage = { items: [], total: 0, unread: 0, page: 1, page_size: 8 }

export default function NotificationBell({ scope, refreshKey = '' }: { scope: NotificationScope; refreshKey?: string }) {
  const { t } = useTranslation('notifications')
  const navigate = useNavigate()
  const root = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false), [value, setValue] = useState<NotificationPage>(empty)
  const load = useCallback(() => notificationsApi.list(scope, { page_size: 8 }).then(setValue).catch(() => undefined), [scope])

  useEffect(() => {
    void load()
    const interval = window.setInterval(() => { if (!document.hidden) void load() }, 30000)
    const visible = () => { if (!document.hidden) void load() }
    document.addEventListener('visibilitychange', visible)
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', visible) }
  }, [load, refreshKey])
  useEffect(() => {
    if (!open) return
    void load()
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', outside); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape) }
  }, [open, load])

  async function openItem(item: InAppNotification) {
    if (!item.read_at) {
      setValue(current => ({ ...current, unread: Math.max(0, current.unread - 1), items: current.items.map(value => value.id === item.id ? { ...value, read_at: new Date().toISOString() } : value) }))
      await notificationsApi.read(item.id).catch(() => undefined)
    }
    setOpen(false)
    if (item.action_url) navigate(item.action_url)
  }
  async function readAll() {
    await notificationsApi.readAll(scope)
    setValue(current => ({ ...current, unread: 0, items: current.items.map(item => ({ ...item, read_at: item.read_at || new Date().toISOString() })) }))
  }

  return <div className="notification-bell" ref={root}>
    <button type="button" className="header-icon-button notification-bell-trigger" title={t('bell')} aria-label={t('bell')} aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <Icon name="bell" size={18} />{value.unread > 0 && <b>{value.unread > 99 ? '99+' : value.unread}</b>}
    </button>
    {open && <section className="notification-popover">
      <header><div><strong>{t(scope === 'admin' ? 'adminTitle' : 'title')}</strong><small>{t('unread', { count: value.unread })}</small></div>{value.unread > 0 && <button type="button" onClick={readAll}>{t('markAll')}</button>}</header>
      <div className="notification-popover-list">{value.items.map(item => <NotificationItem key={item.id} compact item={item} onOpen={openItem} />)}{!value.items.length && <div className="notification-empty"><Icon name="bell" /><strong>{t('empty')}</strong><small>{t('emptyHint')}</small></div>}</div>
      <footer><button type="button" onClick={() => { setOpen(false); navigate(scope === 'admin' ? '/admin/notifications' : '/notifications') }}>{t('viewAll')}<Icon name="arrowRight" /></button></footer>
    </section>}
  </div>
}
