import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { notificationsApi } from '../notifications/api'
import type { InAppNotification, NotificationPage, NotificationScope } from '../notifications/types'
import NotificationItem from '../components/notifications/NotificationItem'
import Icon from '../components/Icon'
import '../styles/notifications.css'

const empty: NotificationPage = { items: [], total: 0, unread: 0, page: 1, page_size: 20 }
const categories = ['all', 'unread', 'task', 'quota', 'alert', 'security', 'team', 'system'] as const

export default function NotificationCenter({ scope }: { scope: NotificationScope }) {
  const { t } = useTranslation('notifications'), navigate = useNavigate()
  const [filter, setFilter] = useState<(typeof categories)[number]>('all'), [page, setPage] = useState(1)
  const [value, setValue] = useState<NotificationPage>(empty), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const load = useCallback(() => {
    setLoading(true); setError('')
    return notificationsApi.list(scope, { category: ['all', 'unread'].includes(filter) ? '' : filter, unread_only: filter === 'unread', page, page_size: 20 })
      .then(setValue).catch(reason => setError(reason.message)).finally(() => setLoading(false))
  }, [scope, filter, page])
  useEffect(() => { void load() }, [load])

  async function openItem(item: InAppNotification) {
    if (!item.read_at) await notificationsApi.read(item.id).catch(() => undefined)
    if (item.action_url) navigate(item.action_url); else void load()
  }
  async function readAll() { await notificationsApi.readAll(scope); await load() }
  const pages = Math.max(1, Math.ceil(value.total / value.page_size))
  return <main className={`${scope === 'admin' ? 'admin-content-page' : 'workspace-page'} notification-center-page`}>
    <header className={scope === 'admin' ? 'admin-page-intro' : 'workspace-page-heading'}><div><h1>{t(scope === 'admin' ? 'adminTitle' : 'title')}</h1><p>{t(scope === 'admin' ? 'adminSubtitle' : 'subtitle')}</p></div>{value.unread > 0 && <button className="icon-button" onClick={readAll}><Icon name="check" />{t('markAll')}</button>}</header>
    <nav className="notification-filters">{categories.map(item => <button key={item} className={filter === item ? 'active' : ''} onClick={() => { setFilter(item); setPage(1) }}>{t(`filters.${item}`)}{item === 'unread' && value.unread > 0 && <b>{value.unread}</b>}</button>)}</nav>
    {error && <div className="error">{error}</div>}
    <section className="notification-list-card">{loading ? <div className="notification-loading"><span className="action-spinner" /></div> : value.items.length ? value.items.map(item => <NotificationItem key={item.id} item={item} onOpen={openItem} />) : <div className="notification-empty"><Icon name="bell" size={24} /><strong>{t('empty')}</strong><small>{t('emptyHint')}</small></div>}</section>
    {pages > 1 && <footer className="notification-pagination"><button disabled={page <= 1} onClick={() => setPage(value => value - 1)}><Icon name="chevronLeft" /></button><span>{page} / {pages}</span><button disabled={page >= pages} onClick={() => setPage(value => value + 1)}><Icon name="chevronRight" /></button></footer>}
  </main>
}
