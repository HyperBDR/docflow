import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import Icon from '../components/Icon'
import { formatNumber, normalizeLocale } from '../i18n'
import type { AdminOverview as Overview } from '../types'

const EMPTY: Overview = { users: 0, active_users: 0, admins: 0, demos: 0, views: 0, storage_bytes: 0 }

function bytes(value: number, locale: string) {
  if (!value) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB'], index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 4)
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1024 ** index)} ${units[index]}`
}

export default function AdminOverview() {
  const { t, i18n } = useTranslation(['admin', 'common'])
  const locale = normalizeLocale(i18n.language)
  const [value, setValue] = useState(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => { api.adminOverview().then(setValue).catch(error => setError(error.message)).finally(() => setLoading(false)) }, [])
  const metrics = [
    ['users', 'users', formatNumber(value.users, locale), t('overview.admins', { count: value.admins })],
    ['check', 'activeUsers', formatNumber(value.active_users, locale), `${value.users ? Math.round(value.active_users / value.users * 100) : 0}%`],
    ['folder', 'demos', formatNumber(value.demos, locale), ''],
    ['eye', 'views', formatNumber(value.views, locale), ''],
    ['database', 'storage', bytes(value.storage_bytes, locale), ''],
  ] as const
  return <div className="admin-content-page">
    {error && <div className="error">{error}</div>}
    <div className={`admin-metrics ${loading ? 'loading' : ''}`}>{metrics.map(([icon, label, metric, note]) => <article key={label}><span><Icon name={icon} size={22} /></span><div><small>{t(`overview.${label}`)}</small><strong>{metric}</strong>{note && <p>{note}</p>}</div></article>)}</div>
    <div className="admin-overview-grid">
      <Link to="/admin/users"><span><Icon name="users" size={22} /></span><div><strong>{t('nav.users')}</strong><p>{t('overviewCards.users')}</p></div><Icon name="chevronRight" /></Link>
      <Link to="/admin/resources"><span><Icon name="folder" size={22} /></span><div><strong>{t('nav.resources')}</strong><p>{t('overviewCards.resources')}</p></div><Icon name="chevronRight" /></Link>
    </div>
  </div>
}
