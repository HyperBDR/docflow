import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDate, normalizeLocale } from '../../i18n'
import { monitoringApi } from '../../monitoring/api'
import { monitoringCatalog, type MonitoringDetailKey } from '../../monitoring/catalog'
import type { MonitoringMetricDetail } from '../../monitoring/types'
import Icon from '../Icon'
import InteractiveMetricChart from './InteractiveMetricChart'
import SeverityBadge from './SeverityBadge'

const ranges = ['1h', '6h', '24h', '7d']

function displayValue(key: string, value: unknown, locale: string) {
  if (value == null || value === '') return '—'
  if (key.endsWith('_bytes') && typeof value === 'number') {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'], index = Math.min(4, Math.floor(Math.log(Math.max(1, value)) / Math.log(1024)))
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1024 ** index)} ${units[index]}`
  }
  if (key === 'collected_at' && typeof value === 'string') return formatDate(value, normalizeLocale(locale))
  if (typeof value === 'number') return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)
  return String(value)
}

function OverflowValue({ children, className = '' }: { children: string; className?: string }) {
  const text = useRef<HTMLSpanElement>(null), [overflow, setOverflow] = useState(false)
  const measure = () => setOverflow(!!text.current && text.current.scrollWidth > text.current.clientWidth)
  return <span className={`monitor-overflow-value ${className}`.trim()} data-full-value={children} data-overflow={overflow} title={children} tabIndex={0} onMouseEnter={measure} onFocus={measure}><span ref={text}>{children}</span></span>
}

export default function MonitoringDetailDrawer({ metricKey, onClose }: { metricKey: MonitoringDetailKey; onClose: () => void }) {
  const { t, i18n } = useTranslation(['monitoring', 'common'])
  const locale = normalizeLocale(i18n.language)
  const item = monitoringCatalog[metricKey]
  const [range, setRange] = useState('24h'), [value, setValue] = useState<MonitoringMetricDetail | null>(null), [error, setError] = useState('')
  useEffect(() => { setValue(null); setError(''); monitoringApi.detail(metricKey, range).then(setValue).catch(reason => setError(reason.message)) }, [metricKey, range])
  const chartPoints = value?.points.map(point => ({ collected_at: point.collected_at, values: point.values })) || []
  const threshold = metricKey === 'api.error_rate' ? 5 : metricKey === 'storage.capacity' ? 15 : undefined
  return <><button className="admin-user-drawer-scrim" aria-label={t('common:actions.close')} onClick={onClose} /><aside className="admin-user-drawer monitor-detail-drawer" role="dialog" aria-modal="true">
    <header className="admin-user-drawer-header"><div className="monitor-detail-identity"><span className={value?.status || 'unknown'}><Icon name={item.icon} size={23} /></span><div><small>{t('details.eyebrow')}</small><h2>{t(item.title)}</h2><p><i className={value?.status || 'unknown'} />{t(`status.${value?.status || 'unknown'}`)}</p></div></div><button className="admin-user-drawer-close" aria-label={t('common:actions.close')} onClick={onClose}>×</button></header>
    <nav className="monitor-detail-ranges">{ranges.map(key => <button key={key} className={range === key ? 'active' : ''} onClick={() => setRange(key)}>{t(`details.ranges.${key}`)}</button>)}</nav>
    <div className="admin-user-drawer-body monitor-detail-body">{error && <div className="error">{error}</div>}{!value && !error && <div className="monitor-detail-loading"><span className="action-spinner" />{t('loading')}</div>}{value && <>
      <section className="monitor-detail-summary">{item.fields.map(key => { const formatted = displayValue(key, value.summary[key], locale); return <article key={key}><small>{t(`details.fields.${key}`, { defaultValue: key })}</small><strong><OverflowValue>{formatted}</OverflowValue></strong></article> })}</section>
      <section className="monitor-detail-card monitor-history-card"><header><div><strong>{t('details.history')}</strong><small>{t('details.historyHint')}</small></div></header><InteractiveMetricChart points={chartPoints} series={item.series.map(series => ({ ...series, label: t(series.label) }))} unit={item.unit} threshold={threshold} /></section>
      {!!value.breakdown.length && <section className="monitor-detail-card monitor-endpoint-card"><header><div><strong>{t('details.endpoints')}</strong><small>{t('details.endpointsHint')}</small></div></header><div className="monitor-endpoint-list">{value.breakdown.slice(0, 10).map((row, index) => { const endpoint = `${String(row.method)} ${String(row.route)}`; return <article key={`${row.method}-${row.route}-${index}`}><OverflowValue className="monitor-endpoint-value">{endpoint}</OverflowValue><span><b>{Number(row.requests || 0).toLocaleString(locale)}</b>{t('details.requests')}</span><span><b>{Number(row.avg_latency_ms || 0).toLocaleString(locale)} ms</b>{t('details.averageLatency')}</span><span className={Number(row.error_rate || 0) >= 5 ? 'danger' : ''}><b>{Number(row.error_rate || 0)}%</b>{t('details.errorRate')}</span></article> })}</div></section>}
      <section className="monitor-detail-card"><header><div><strong>{t('details.relatedAlerts')}</strong><small>{t('details.relatedAlertsHint')}</small></div></header>{value.alerts.length ? <div className="monitor-detail-alerts">{value.alerts.map(alert => <article key={alert.id}><SeverityBadge value={alert.severity} /><div><strong>{alert.title}</strong><small>{formatDate(alert.started_at, locale)}</small></div><span>{t(`alertStatus.${alert.status}`)}</span></article>)}</div> : <div className="monitor-detail-empty">{t('details.noAlerts')}</div>}</section>
    </>}</div>
  </aside></>
}
