import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import Icon, { type IconName } from '../components/Icon'
import { formatNumber, normalizeLocale } from '../i18n'
import type { AdminOverview as Overview } from '../types'

const EMPTY: Overview = { users: 0, active_users: 0, admins: 0, organizations: 0, demos: 0, draft_demos: 0, published_demos: 0, steps: 0, views: 0, unique_viewers: 0, exports: 0, ai_requests: 0, ai_tokens: 0, failed_jobs: 0, storage_bytes: 0, trend: [], demo_status: [], content_locales: [], top_organizations: [] }

function bytes(value: number, locale: string) {
  if (!value) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB'], index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 4)
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1024 ** index)} ${units[index]}`
}

type TrendKey = 'demos' | 'views' | 'ai_tokens' | 'users'
function OverviewTrend({ value, metric, label }: { value: Overview; metric: TrendKey; label: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const points = Array.isArray(value.trend) ? value.trend : [], width = 900, height = 230, pad = 30
  const max = Math.max(1, ...points.map(item => item[metric]))
  const coordinate = (item: Overview['trend'][number], index: number) => ({ x: pad + index * (width - pad * 2) / Math.max(1, points.length - 1), y: height - pad - item[metric] / max * (height - pad * 2) })
  const polyline = points.map((item, index) => { const point = coordinate(item, index); return `${point.x},${point.y}` }).join(' ')
  return <div className="overview-trend"><svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={label}>
    {[0, .25, .5, .75, 1].map(line => <line key={line} x1={pad} x2={width-pad} y1={pad + line * (height-pad*2)} y2={pad + line * (height-pad*2)} />)}
    <defs><linearGradient id="overview-area" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#635bff" stopOpacity=".3"/><stop offset="1" stopColor="#635bff" stopOpacity="0"/></linearGradient></defs>
    {points.length > 1 && <path d={`M ${pad} ${height-pad} L ${polyline.replaceAll(' ', ' L ')} L ${width-pad} ${height-pad} Z`} fill="url(#overview-area)" />}
    <polyline points={polyline} fill="none" stroke="#635bff" strokeWidth="3" vectorEffect="non-scaling-stroke" />
    {points.map((item, index) => { const point = coordinate(item, index); return <circle key={item.date} cx={point.x} cy={point.y} r={hover === index ? 7 : 4} onMouseEnter={() => setHover(index)} onMouseLeave={() => setHover(null)} /> })}
  </svg>{hover !== null && points[hover] && <div className="chart-tooltip"><strong>{points[hover].date}</strong><span>{label}: {points[hover][metric].toLocaleString()}</span></div>}<div className="chart-axis"><span>{points[0]?.date || '—'}</span><span>{points.at(-1)?.date || '—'}</span></div></div>
}

function Distribution({ title, items, secondaryLabel }: { title: string; items: Overview['top_organizations']; secondaryLabel?: string }) {
  const safeItems = Array.isArray(items) ? items : []
  const max = Math.max(1, ...safeItems.map(item => item.value))
  return <section className="overview-distribution"><header><strong>{title}</strong><small>{safeItems.length}</small></header><div>{safeItems.map(item => <article key={item.key}><label><span>{item.label}</span><b>{item.value.toLocaleString()}</b></label><i><em style={{ width: `${item.value/max*100}%` }} /></i>{secondaryLabel && <small>{secondaryLabel}: {item.secondary.toLocaleString()}</small>}</article>)}{!safeItems.length && <p>—</p>}</div></section>
}

export default function AdminOverview() {
  const { t, i18n } = useTranslation(['admin', 'common']); const locale = normalizeLocale(i18n.language)
  const [value, setValue] = useState(EMPTY), [loading, setLoading] = useState(true), [error, setError] = useState(''), [trendMetric, setTrendMetric] = useState<TrendKey>('demos')
  useEffect(() => { api.adminOverview().then(result => setValue({
    ...EMPTY,
    ...result,
    trend: Array.isArray(result.trend) ? result.trend : [],
    demo_status: Array.isArray(result.demo_status) ? result.demo_status : [],
    content_locales: Array.isArray(result.content_locales) ? result.content_locales : [],
    top_organizations: Array.isArray(result.top_organizations) ? result.top_organizations : [],
  })).catch(error => setError(error.message)).finally(() => setLoading(false)) }, [])
  const metrics = useMemo(() => [
    ['users', 'users', value.users, `${value.active_users} ${t('overview.activeSuffix')}`],
    ['users', 'organizations', value.organizations, ''], ['folder', 'demos', value.demos, `${value.published_demos} ${t('overview.publishedSuffix')}`],
    ['list', 'steps', value.steps, ''], ['eye', 'views', value.views, `${value.unique_viewers} ${t('overview.viewersSuffix')}`],
    ['download', 'exports', value.exports, ''], ['ai', 'aiTokens', value.ai_tokens, `${value.ai_requests} ${t('overview.requestsSuffix')}`],
    ['warning', 'failedJobs', value.failed_jobs, ''], ['database', 'storage', value.storage_bytes, ''],
  ] as [IconName, string, number, string][], [value, t])
  return <div className="admin-content-page admin-overview-page">{error && <div className="error">{error}</div>}
    <div className={`admin-metrics admin-metrics-expanded ${loading ? 'loading' : ''}`}>{metrics.map(([icon, label, metric, note]) => <article key={label}><span><Icon name={icon} size={22} /></span><div><small>{t(`overview.${label}`)}</small><strong>{label === 'storage' ? bytes(metric, locale) : formatNumber(metric, locale)}</strong>{note && <p>{note}</p>}</div></article>)}</div>
    <section className="overview-chart-card"><header><div><strong>{t('overview.trendTitle')}</strong><small>{t('overview.trendHint')}</small></div><nav>{(['demos','views','ai_tokens','users'] as TrendKey[]).map(metric => <button className={trendMetric === metric ? 'active' : ''} key={metric} onClick={() => setTrendMetric(metric)}>{t(`overview.trends.${metric}`)}</button>)}</nav></header><OverviewTrend value={value} metric={trendMetric} label={t(`overview.trends.${trendMetric}`)} /></section>
    <div className="overview-dimension-grid"><Distribution title={t('overview.topOrganizations')} items={value.top_organizations} secondaryLabel={t('overview.views')} /><Distribution title={t('overview.statusDistribution')} items={value.demo_status} /><Distribution title={t('overview.localeDistribution')} items={value.content_locales} /></div>
    <div className="admin-overview-grid"><Link to="/admin/users"><span><Icon name="users" size={22} /></span><div><strong>{t('nav.users')}</strong><p>{t('overviewCards.users')}</p></div><Icon name="chevronRight" /></Link><Link to="/admin/resources"><span><Icon name="folder" size={22} /></span><div><strong>{t('nav.resources')}</strong><p>{t('overviewCards.resources')}</p></div><Icon name="chevronRight" /></Link></div>
  </div>
}
