import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import Icon, { type IconName } from '../components/Icon'
import QuotaDistribution from '../components/quota/QuotaDistribution'
import QuotaGrowthRanking from '../components/quota/QuotaGrowthRanking'
import PlatformQuotaLimitsPanel from '../components/quota/PlatformQuotaLimitsPanel'
import QuotaPlansPanel from '../components/quota/QuotaPlansPanel'
import QuotaSpacesPanel from '../components/quota/QuotaSpacesPanel'
import QuotaTrendChart from '../components/quota/QuotaTrendChart'
import { useToast } from '../components/toast'
import { formatDate, normalizeLocale } from '../i18n'
import { QUOTA_METRICS, formatQuotaValue, quotaMetric } from '../quota/catalog'
import type { QuotaMetricKey, QuotaOverview, QuotaPlanStatistics } from '../quota/types'
import '../styles/quotas.css'

type Tab = 'overview' | 'limits' | 'plans' | 'spaces' | 'analytics'

export default function AdminQuotas() {
  const { t, i18n } = useTranslation(['admin', 'platformSettings', 'common'])
  const locale = normalizeLocale(i18n.language), toast = useToast()
  const [tab, setTab] = useState<Tab>('overview'), [days, setDays] = useState(30), [metric, setMetric] = useState<QuotaMetricKey>('storage_bytes')
  const [kind, setKind] = useState(''), [planId, setPlanId] = useState(''), [health, setHealth] = useState('')
  const [value, setValue] = useState<QuotaOverview | null>(null), [plans, setPlans] = useState<QuotaPlanStatistics[]>([])
  const [error, setError] = useState(''), [loading, setLoading] = useState(true), [collecting, setCollecting] = useState(false), [refreshKey, setRefreshKey] = useState(0)
  const load = useCallback(() => {
    setLoading(true)
    return Promise.all([api.quotaOperations({ days, metric, kind, plan_id: planId, health }), api.quotaPlanStatistics()]).then(([overview, planValues]) => { setValue(overview); setPlans(planValues); setError('') }).catch(reason => setError(reason.message)).finally(() => setLoading(false))
  }, [days, metric, kind, planId, health, refreshKey])
  useEffect(() => { void load() }, [load])
  async function collect() {
    setCollecting(true)
    try { const result = await api.collectQuotaUsage(); toast.success(t('admin:quotas.collected', { spaces: result.spaces })); await load() }
    catch (reason) { toast.error((reason as Error).message) } finally { setCollecting(false) }
  }
  const summaryCards = useMemo<{ key: string; icon: IconName; value: string; hint: string; tone: string }[]>(() => !value ? [] : [
    { key: 'totalSpaces', icon: 'users', value: String(value.summary.total_spaces || 0), hint: t('admin:quotas.summary.spaceMix', { team: value.summary.team_spaces || 0, personal: value.summary.personal_spaces || 0 }), tone: 'violet' },
    { key: 'defaultPlan', icon: 'shield', value: String(value.summary.default_plan_spaces || 0), hint: t('admin:quotas.summary.customCount', { count: value.summary.assigned_spaces || 0 }), tone: 'blue' },
    { key: 'overrides', icon: 'settings', value: String(value.summary.override_spaces || 0), hint: t('admin:quotas.summary.overrideHint'), tone: 'cyan' },
    { key: 'warnings', icon: 'warning', value: String(value.summary.warning_spaces || 0), hint: t('admin:quotas.summary.exceededCount', { count: value.summary.exceeded_spaces || 0 }), tone: 'orange' },
    { key: 'storage', icon: 'database', value: formatQuotaValue('storage_bytes', value.summary.storage_bytes, locale), hint: t('admin:quotas.summary.allSpaces'), tone: 'purple' },
    { key: 'aiTokens', icon: 'ai', value: formatQuotaValue('monthly_ai_tokens', value.summary.monthly_ai_tokens, locale), hint: t('admin:quotas.summary.currentMonth'), tone: 'pink' },
    { key: 'exports', icon: 'publish', value: formatQuotaValue('monthly_exports', value.summary.monthly_exports, locale), hint: t('admin:quotas.summary.currentMonth'), tone: 'green' },
    { key: 'traffic', icon: 'eye', value: formatQuotaValue('monthly_public_views', value.summary.monthly_public_views, locale), hint: formatQuotaValue('monthly_download_bytes', value.summary.monthly_download_bytes, locale), tone: 'teal' },
  ], [value, locale, t])
  const selectedCatalog = quotaMetric(metric)
  const distributionLabels = { team: t('admin:quotas.types.team'), personal: t('admin:quotas.types.personal'), normal: t('admin:quotas.health.normal'), warning: t('admin:quotas.health.warning'), exceeded: t('admin:quotas.health.exceeded') }
  return <main className="admin-content-page quota-operations-page"><div className="admin-page-intro"><div><h1>{t('admin:quotas.title')}</h1><p>{t('admin:quotas.subtitle')}</p></div><div className="quota-collection-state"><span><i />{t('admin:quotas.automatic')}</span>{value?.collected_at && <small>{t('admin:quotas.lastCollected', { date: formatDate(value.collected_at, locale) })}</small>}<button className="icon-button" disabled={collecting} onClick={collect}>{collecting ? <span className="action-spinner" /> : <Icon name="analytics" />}{t(`admin:quotas.${collecting ? 'collecting' : 'collect'}`)}</button></div></div>
    <nav className="quota-page-tabs">{([['overview', 'grid'], ['limits', 'shield'], ['plans', 'list'], ['spaces', 'users'], ['analytics', 'analytics']] as [Tab, IconName][]).map(([key, icon]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}><Icon name={icon} />{t(`admin:quotas.tabs.${key}`)}</button>)}</nav>
    {error && <div className="error">{error}</div>}
    {loading && !value && <div className="quota-loading"><span className="action-spinner" />{t('admin:loading')}</div>}
    {tab === 'overview' && value && <><section className="quota-summary-grid">{summaryCards.map(item => <article key={item.key}><span className={item.tone}><Icon name={item.icon} /></span><div><small>{t(`admin:quotas.summary.${item.key}`)}</small><strong>{item.value}</strong><p>{item.hint}</p></div></article>)}</section><div className="quota-overview-charts"><section className="quota-chart-card"><header><div><strong>{t('admin:quotas.charts.platformGrowth')}</strong><small>{t('admin:quotas.charts.platformGrowthHint', { metric: t(`platformSettings:quota.metrics.${metric}`) })}</small></div><select value={metric} onChange={event => setMetric(event.target.value as QuotaMetricKey)}>{QUOTA_METRICS.map(item => <option key={item.key} value={item.key}>{t(`platformSettings:quota.metrics.${item.key}`)}</option>)}</select></header>{value.trend.length ? <QuotaTrendChart points={value.trend} formatValue={number => formatQuotaValue(metric, number, locale)} usedLabel={t('admin:quotas.used')} limitLabel={t('admin:quotas.limit')} /> : <div className="quota-empty"><Icon name="analytics" />{t('admin:quotas.noHistory')}</div>}</section><div className="quota-distribution-grid"><QuotaDistribution title={t('admin:quotas.charts.planDistribution')} center={t('admin:quotas.spacesUnit')} items={value.by_plan} /><QuotaDistribution title={t('admin:quotas.charts.healthDistribution')} center={t('admin:quotas.spacesUnit')} items={value.by_health} labels={distributionLabels} /></div></div><section className="quota-ranking-card"><header><div><strong>{t('admin:quotas.charts.growthRanking')}</strong><small>{t('admin:quotas.charts.growthRankingHint', { metric: t(`platformSettings:quota.metrics.${metric}`) })}</small></div></header><QuotaGrowthRanking spaces={value.ranking} metric={metric} /></section></>}
    {tab === 'plans' && <QuotaPlansPanel refreshKey={refreshKey} onChanged={() => setRefreshKey(value => value + 1)} />}
    {tab === 'limits' && <PlatformQuotaLimitsPanel />}
    {tab === 'spaces' && value && <QuotaSpacesPanel spaces={value.spaces} />}
    {tab === 'analytics' && value && <><section className="quota-analysis-filters"><select value={days} onChange={event => setDays(Number(event.target.value))}>{[7, 30, 90, 365].map(item => <option key={item} value={item}>{t('admin:quotas.days', { count: item })}</option>)}</select><select value={metric} onChange={event => setMetric(event.target.value as QuotaMetricKey)}>{QUOTA_METRICS.map(item => <option key={item.key} value={item.key}>{t(`platformSettings:quota.metrics.${item.key}`)}</option>)}</select><select value={kind} onChange={event => setKind(event.target.value)}><option value="">{t('admin:quotas.types.all')}</option><option value="team">{t('admin:quotas.types.team')}</option><option value="personal">{t('admin:quotas.types.personal')}</option></select><select value={planId} onChange={event => setPlanId(event.target.value)}><option value="">{t('admin:quotas.allPlans')}</option>{plans.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select value={health} onChange={event => setHealth(event.target.value)}><option value="">{t('admin:quotas.health.all')}</option><option value="normal">{t('admin:quotas.health.normal')}</option><option value="warning">{t('admin:quotas.health.warning')}</option><option value="exceeded">{t('admin:quotas.health.exceeded')}</option></select></section><section className="quota-analysis-current"><header><div><strong>{t('admin:quotas.analysis.current')}</strong><small>{t('admin:quotas.analysis.currentHint')}</small></div></header><div>{QUOTA_METRICS.map(item => <article key={item.key} className={metric === item.key ? 'active' : ''} onClick={() => setMetric(item.key)}><span className={`quota-metric-icon ${item.tone}`}><Icon name={item.icon} /></span><div><small>{t(`platformSettings:quota.metrics.${item.key}`)}</small><strong>{formatQuotaValue(item.key, value.summary[item.key], locale)}</strong></div></article>)}</div></section><div className="quota-analysis-grid"><section className="quota-chart-card"><header><div><strong>{t('admin:quotas.analysis.trend')}</strong><small>{t(`platformSettings:quota.metrics.${metric}`)}</small></div><span className={`quota-metric-icon ${selectedCatalog.tone}`}><Icon name={selectedCatalog.icon} /></span></header>{value.trend.length ? <QuotaTrendChart points={value.trend} formatValue={number => formatQuotaValue(metric, number, locale)} usedLabel={t('admin:quotas.used')} limitLabel={t('admin:quotas.limit')} /> : <div className="quota-empty"><Icon name="analytics" />{t('admin:quotas.noHistory')}</div>}</section><div className="quota-distribution-grid"><QuotaDistribution title={t('admin:quotas.charts.spaceDistribution')} center={t('admin:quotas.spacesUnit')} items={value.by_kind} labels={distributionLabels} /><QuotaDistribution title={t('admin:quotas.charts.planDistribution')} center={t('admin:quotas.spacesUnit')} items={value.by_plan} /><QuotaDistribution title={t('admin:quotas.charts.healthDistribution')} center={t('admin:quotas.spacesUnit')} items={value.by_health} labels={distributionLabels} /></div></div><QuotaSpacesPanel spaces={value.ranking} /></>}
  </main>
}
