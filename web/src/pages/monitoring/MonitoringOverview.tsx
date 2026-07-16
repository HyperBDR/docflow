import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import HealthCard from '../../components/monitoring/HealthCard'
import MetricChart from '../../components/monitoring/MetricChart'
import MonitoringNav from '../../components/monitoring/MonitoringNav'
import Icon from '../../components/Icon'
import { useToast } from '../../components/toast'
import { formatDate, formatNumber, normalizeLocale } from '../../i18n'
import { monitoringApi } from '../../monitoring/api'
import type { MonitoringOverview as Overview } from '../../monitoring/types'

function bytes(value: number) {
  if (!value) return '0 B'
  const units = ['B','KB','MB','GB','TB'], index = Math.min(4, Math.floor(Math.log(value)/Math.log(1024)))
  return `${(value/1024**index).toFixed(index ? 1 : 0)} ${units[index]}`
}

export default function MonitoringOverview() {
  const { t, i18n } = useTranslation('monitoring'); const locale = normalizeLocale(i18n.language)
  const toast = useToast()
  const [value, setValue] = useState<Overview | null>(null), [error, setError] = useState(''), [collecting, setCollecting] = useState(false)
  const load = useCallback(() => monitoringApi.overview().then(setValue).catch(reason => setError(reason.message)), [])
  useEffect(() => { load(); const timer = window.setInterval(load, 30000); return () => window.clearInterval(timer) }, [load])
  async function collect() { setCollecting(true); try { await monitoringApi.collect(); await load(); toast.success(t('overview.collected')) } catch (reason) { toast.error((reason as Error).message) } finally { setCollecting(false) } }
  const activeAlerts = Object.values(value?.active_alerts || {}).reduce((sum,item)=>sum+item,0)
  return <main className="admin-content-page monitoring-page"><div className="admin-page-intro"><div><h1>{t('title')}</h1><p>{t('subtitle')}</p></div><button className="primary icon-button" disabled={collecting} onClick={collect}>{collecting ? <span className="action-spinner"/> : <Icon name="analytics"/>}{t(collecting ? 'overview.collecting' : 'overview.collect')}</button></div><MonitoringNav />
    {error && <div className="error">{error}</div>}
    {value?.collector_stale && <div className="monitor-stale"><Icon name="warning"/><div><strong>{t('overview.stale')}</strong><p>{t('overview.staleHint')}</p></div></div>}
    <section className="monitor-status-strip"><article className={value?.overall_status || 'unknown'}><span><Icon name="shield"/></span><div><small>{t('overview.platformStatus')}</small><strong>{t(`status.${value?.overall_status || 'unknown'}`)}</strong></div></article><article><span><Icon name="message"/></span><div><small>{t('overview.activeAlerts')}</small><strong>{activeAlerts}</strong></div><Link to="/admin/monitoring/alerts">{t('overview.viewAlerts')}</Link></article><article><span><Icon name="clock"/></span><div><small>{t('overview.lastCollected')}</small><strong>{value?.updated_at ? formatDate(value.updated_at, locale) : t('never')}</strong></div></article></section>
    <section className="monitor-section"><header><div><strong>{t('overview.services')}</strong><small>{t('overview.servicesHint')}</small></div></header><div className="monitor-health-grid">{value?.services.map(item=><HealthCard key={item.key} value={item}/>) || <div className="monitor-loading">{t('loading')}</div>}</div></section>
    <section className="monitor-kpi-grid"><article><span><Icon name="analytics"/></span><small>{t('metrics.requests')}</small><strong>{formatNumber(value?.api.requests || 0,locale)}</strong><p>{t('metrics.lastFiveMinutes')}</p></article><article><span><Icon name="clock"/></span><small>{t('metrics.p95')}</small><strong>{value?.api.p95_latency_ms || 0} ms</strong><p>{t('metrics.avg', { value: value?.api.avg_latency_ms || 0 })}</p></article><article className={(value?.api.error_rate || 0)>=5?'danger':''}><span><Icon name="warning"/></span><small>{t('metrics.errorRate')}</small><strong>{value?.api.error_rate || 0}%</strong><p>{t('metrics.serverErrors', { count: value?.api.status_5xx || 0 })}</p></article><article><span><Icon name="list"/></span><small>{t('metrics.queue')}</small><strong>{value?.jobs.queued || 0}</strong><p>{t('metrics.running', { count: value?.jobs.running || 0 })}</p></article><article><span><Icon name="database"/></span><small>{t('metrics.storageFree')}</small><strong>{value?.storage.free_percent || 0}%</strong><p>{bytes(Number(value?.storage.free_bytes || 0))}</p></article><article><span><Icon name="ai"/></span><small>{t('metrics.aiFailure')}</small><strong>{value?.ai.failure_rate_10m || 0}%</strong><p>{t('metrics.aiRequests', { count: value?.ai.requests_10m || 0 })}</p></article></section>
    <div className="monitor-chart-grid"><section className="monitor-panel"><header><div><strong>{t('charts.requests')}</strong><small>{t('charts.requestsHint')}</small></div></header><MetricChart points={value?.trend || []} metric="requests"/></section><section className="monitor-panel"><header><div><strong>{t('charts.errors')}</strong><small>{t('charts.errorsHint')}</small></div></header><MetricChart points={value?.trend || []} metric="error_rate"/></section></div>
  </main>
}
