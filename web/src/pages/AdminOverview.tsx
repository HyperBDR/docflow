import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import Icon, { type IconName } from '../components/Icon'
import ProductDonut from '../components/charts/InteractiveDonut'
import ProductLineChart from '../components/charts/InteractiveLineChart'
import { formatDate, formatNumber, normalizeLocale } from '../i18n'
import type { AdminOverview as Overview, Locale } from '../types'

const EMPTY: Overview = {
  users: 0, active_users: 0, admins: 0, organizations: 0, demos: 0, draft_demos: 0,
  published_demos: 0, steps: 0, views: 0, unique_viewers: 0, exports: 0, ai_requests: 0,
  ai_tokens: 0, failed_jobs: 0, storage_bytes: 0, trend: [], demo_status: [],
  content_locales: [], top_organizations: [], recent_failed_jobs: [], recent_exports: [], top_resources: [],
}

function bytes(value: number, locale: string) {
  if (!value) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB'], index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 4)
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1024 ** index)} ${units[index]}`
}

function compact(value: number, locale: string) {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

type TrendKey = 'demos' | 'views' | 'ai_tokens' | 'users'
function OverviewTrend({ value, metric, label, locale }: { value: Overview; metric: TrendKey; label: string; locale: Locale }) {
  const points = Array.isArray(value.trend) ? value.trend : []
  const axisDate=(date:string)=>{const parts=date.split('-');return parts.length===3?`${parts[1]}/${parts[2]}`:date}
  return <ProductLineChart className="overview-standard-chart" ariaLabel={label} points={points.map(point=>({key:point.date,label:axisDate(point.date),values:{[metric]:Number(point[metric])||0}}))} series={[{key:metric,label,color:'#635bff'}]} formatValue={number=>compact(number,locale)} />
}

function OrganizationRanking({ title, items, viewsLabel }: { title: string; items: Overview['top_organizations']; viewsLabel: string }) {
  const safeItems = Array.isArray(items) ? items : [], max = Math.max(1, ...safeItems.map(item => item.value))
  return <section className="overview-insight-card overview-organization-card"><header><strong>{title}</strong><small>{safeItems.length}</small></header><div>{safeItems.slice(0, 5).map(item => <article key={item.key}><label><span>{item.label}</span><b>{item.value.toLocaleString()}</b></label><i><em style={{ width: `${item.value/max*100}%` }} /></i><small>{viewsLabel}: {item.secondary.toLocaleString()}</small></article>)}{!safeItems.length && <p className="overview-empty">—</p>}</div></section>
}

function StatusDonut({ title, items, labelFor, unit }: { title: string; items: Overview['demo_status']; labelFor: (key: string, fallback: string) => string; unit: string }) {
  const safeItems = Array.isArray(items) ? items : []
  const colors = ['#635bff', '#22a660', '#ef8b3b', '#e05294']
  return <section className="overview-insight-card overview-status-card"><header><strong>{title}</strong></header><ProductDonut ariaLabel={title} centerLabel={unit} items={safeItems.map((item,index)=>({key:item.key,label:labelFor(item.key,item.label),value:item.value,color:colors[index%colors.length]}))}/></section>
}

function LocaleDistribution({ title, items, labelFor }: { title: string; items: Overview['content_locales']; labelFor: (key: string) => string }) {
  const safeItems = Array.isArray(items) ? items : [], total = safeItems.reduce((sum,item)=>sum+item.value,0), colors=['#3a91d8','#8b83ff','#22a660','#ef8b3b']
  return <section className="overview-insight-card overview-locale-card"><header><strong>{title}</strong><small>{total}</small></header><div className="overview-locale-track">{safeItems.map((item,index)=><i key={item.key} style={{width:`${total ? item.value/total*100 : 0}%`,background:colors[index%colors.length]}} />)}</div><ul>{safeItems.map((item,index)=><li key={item.key}><i style={{background:colors[index%colors.length]}}/><span>{labelFor(item.key)}</span><b>{item.value}</b><small>{total ? Math.round(item.value/total*100) : 0}%</small></li>)}</ul>{!safeItems.length&&<p className="overview-empty">—</p>}</section>
}

export default function AdminOverview() {
  const { t, i18n } = useTranslation(['admin', 'common']); const locale = normalizeLocale(i18n.language)
  const [value, setValue] = useState(EMPTY), [loading, setLoading] = useState(true), [error, setError] = useState(''), [trendMetric, setTrendMetric] = useState<TrendKey>('demos')
  useEffect(() => { api.adminOverview().then(result => setValue({
    ...EMPTY, ...result,
    trend: Array.isArray(result.trend) ? result.trend : [], demo_status: Array.isArray(result.demo_status) ? result.demo_status : [],
    content_locales: Array.isArray(result.content_locales) ? result.content_locales : [], top_organizations: Array.isArray(result.top_organizations) ? result.top_organizations : [],
    recent_failed_jobs: Array.isArray(result.recent_failed_jobs) ? result.recent_failed_jobs : [], recent_exports: Array.isArray(result.recent_exports) ? result.recent_exports : [],
    top_resources: Array.isArray(result.top_resources) ? result.top_resources : [],
  })).catch(error => setError(error.message)).finally(() => setLoading(false)) }, [])
  const metrics = useMemo(() => [
    ['users', 'users', value.users, `${value.active_users} ${t('overview.activeSuffix')}`],
    ['folder', 'demos', value.demos, `${value.published_demos} ${t('overview.publishedSuffix')}`],
    ['database', 'storage', value.storage_bytes, ''],
    ['ai', 'aiTokens', value.ai_tokens, `${value.ai_requests} ${t('overview.requestsSuffix')}`],
  ] as [IconName, string, number, string][], [value, t])
  const trafficMax = Math.max(1, ...value.top_resources.map(item=>item.views))
  return <div className="admin-content-page admin-overview-page">{error && <div className="error">{error}</div>}
    <div className={`admin-metrics overview-core-metrics ${loading ? 'loading' : ''}`}>{metrics.map(([icon, label, metric, note]) => <article key={label}><span><Icon name={icon} size={22} /></span><div><small>{t(`overview.${label}`)}</small><strong>{label === 'storage' ? bytes(metric, locale) : formatNumber(metric, locale)}</strong>{note && <p>{note}</p>}</div></article>)}</div>
    <section className="overview-chart-card"><header><div><strong>{t('overview.trendTitle')}</strong><small>{t('overview.trendHint')}</small></div><nav>{(['demos','views','ai_tokens','users'] as TrendKey[]).map(metric => <button className={trendMetric === metric ? 'active' : ''} key={metric} onClick={() => setTrendMetric(metric)}>{t(`overview.trends.${metric}`)}</button>)}</nav></header><OverviewTrend value={value} metric={trendMetric} label={t(`overview.trends.${trendMetric}`)} locale={locale} /></section>
    <div className="overview-insights-grid"><StatusDonut title={t('overview.statusDistribution')} items={value.demo_status} unit={t('overview.resourceUnit')} labelFor={(key,fallback)=>t(`common:status.${key}`,{defaultValue:fallback})}/><LocaleDistribution title={t('overview.localeDistribution')} items={value.content_locales} labelFor={key=>t(`overview.locales.${key}`,{defaultValue:key})}/><OrganizationRanking title={t('overview.topOrganizations')} items={value.top_organizations} viewsLabel={t('overview.views')} /></div>
    <section className="overview-activity-card overview-traffic-card"><header><div><strong>{t('overview.trafficTitle')}</strong><small>{t('overview.trafficHint')}</small></div><span>{formatNumber(value.views,locale)} {t('overview.views')}</span></header><div>{value.top_resources.map(item=><article key={item.id}><div className="overview-resource-rank"><Link to={`/admin/resources/${item.id}`}>{item.title||t('overview.untitled')}</Link><small>{item.owner_name||item.owner_email||'—'}{item.last_viewed_at&&<> · {formatDate(item.last_viewed_at,locale)}</>}</small></div><div className="overview-traffic-bar"><i><em style={{width:`${item.views/trafficMax*100}%`}}/></i></div><div className="overview-traffic-values"><strong>{formatNumber(item.views,locale)}</strong><small>{t('overview.views')}</small><b>{formatNumber(item.unique_viewers,locale)}</b><small>{t('overview.viewers')}</small></div></article>)}{!value.top_resources.length&&<p className="overview-empty">{t('overview.noTraffic')}</p>}</div></section>
    <div className="overview-operations-grid"><section className="overview-activity-card"><header><div><Link className="overview-section-link" to="/admin/jobs?type=export"><strong>{t('overview.recentExports')}</strong><Icon name="chevronRight"/></Link><small>{t('overview.exportsHint')}</small></div><span>{value.exports}</span></header><div className="overview-job-list">{value.recent_exports.map(item=><article key={item.id}><span className="overview-job-icon"><Icon name="download"/></span><div><div><b>{t(`overview.exportKinds.${item.kind}`,{defaultValue:item.kind.toUpperCase()})}</b><span className={`overview-job-status ${item.status}`}>{t(`common:status.${item.status}`,{defaultValue:item.status})}</span></div><Link to={`/admin/jobs?type=export&job=${item.id}`}>{item.resource_title||t('overview.untitled')}</Link><small>{item.user_name||item.user_email||'—'} · {formatDate(item.created_at,locale)}</small></div></article>)}{!value.recent_exports.length&&<p className="overview-empty">{t('overview.noExports')}</p>}</div></section>
      <section className="overview-activity-card overview-failed-card"><header><div><Link className="overview-section-link" to="/admin/jobs?status=failed"><strong>{t('overview.recentFailures')}</strong><Icon name="chevronRight"/></Link><small>{t('overview.failuresHint')}</small></div><span>{value.failed_jobs}</span></header><div className="overview-job-list">{value.recent_failed_jobs.map(item=><article key={`${item.job_type}-${item.id}`}><span className="overview-job-icon"><Icon name="warning"/></span><div><div><b>{t(`overview.jobTypes.${item.job_type}`,{defaultValue:item.kind})}</b><span className="overview-job-status failed">{t('common:status.failed')}</span></div><Link to={`/admin/jobs?type=${item.job_type}&job=${item.id}`}>{item.resource_title||t('overview.untitled')}</Link><small>{item.user_name||item.user_email||'—'} · {formatDate(item.created_at,locale)}</small>{item.error&&<p title={item.error}>{item.error}</p>}</div></article>)}{!value.recent_failed_jobs.length&&<p className="overview-empty success">{t('overview.noFailures')}</p>}</div></section></div>
  </div>
}
