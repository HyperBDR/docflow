import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import JobList from '../../components/workspace/JobList'
import MetricCard from '../../components/workspace/MetricCard'
import ResourceSummary from '../../components/workspace/ResourceSummary'
import TrendChart, { type WorkspaceTrendMetric } from '../../components/workspace/TrendChart'
import Icon, { type IconName } from '../../components/Icon'
import { formatNumber, normalizeLocale } from '../../i18n'
import { workspaceApi } from '../../workspace/api'
import type { WorkspaceOverview as Overview } from '../../workspace/types'

function formatBytes(value: number, locale: string) {
  if (!value) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB'], index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 4)
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1024 ** index)} ${units[index]}`
}

export default function WorkspaceOverview() {
  const { t, i18n } = useTranslation('workspace')
  const locale = normalizeLocale(i18n.language)
  const [value, setValue] = useState<Overview | null>(null)
  const [error, setError] = useState('')
  const [metric, setMetric] = useState<WorkspaceTrendMetric>('views')
  useEffect(() => { workspaceApi.overview().then(setValue).catch(reason => setError(reason.message)) }, [])
  const metrics = useMemo(() => value ? [
    ['folder', 'resources', formatNumber(value.resources, locale), t('metrics.resourceDetail', { draft: value.draft_resources, published: value.published_resources }), ''],
    ['layout', 'steps', formatNumber(value.steps, locale), t('metrics.stepDetail'), ''],
    ['database', 'storage', formatBytes(value.storage_bytes, locale), t('metrics.storageDetail'), ''],
    ['ai', 'tokens', formatNumber(value.ai_tokens, locale), t('metrics.tokenDetail', { count: value.ai_requests }), ''],
    ['eye', 'views', formatNumber(value.views, locale), t('metrics.viewDetail', { count: value.unique_viewers }), 'success'],
    ['clock', 'tasks', formatNumber(value.active_jobs, locale), t('metrics.taskDetail', { failed: value.failed_jobs }), value.failed_jobs ? 'danger' : ''],
  ] as [IconName, string, string, string, 'success' | 'danger' | ''][] : [], [value, locale, t])
  if (error) return <div className="workspace-state error">{error}</div>
  if (!value) return <div className="workspace-state">{t('loading')}</div>
  return <main className="workspace-page workspace-overview">
    <header className="workspace-page-heading"><div><h1>{t('overview.title')}</h1><p>{t('overview.subtitle', { name: value.organization_name })}</p></div><span><Icon name={value.organization_kind === 'team' ? 'users' : 'user'} />{value.organization_kind === 'team' ? t('overview.team', { count: value.member_count }) : t('overview.personal')}</span></header>
    <section className="workspace-metrics">{metrics.map(([icon, key, metricValue, detail, tone]) => <MetricCard key={key} icon={icon} label={t(`metrics.${key}`)} value={metricValue} detail={detail} tone={tone} />)}</section>
    <section className="workspace-panel workspace-trend-panel"><header><div><strong>{t('trend.title')}</strong><small>{t('trend.subtitle')}</small></div><nav>{(['views', 'resources', 'ai_tokens', 'jobs'] as WorkspaceTrendMetric[]).map(key => <button className={metric === key ? 'active' : ''} key={key} onClick={() => setMetric(key)}>{t(`trend.${key}`)}</button>)}</nav></header><TrendChart points={value.trend} metric={metric} label={t(`trend.${metric}`)} locale={locale} /></section>
    <div className="workspace-overview-grid"><section className="workspace-panel"><header><div><strong>{t('resources.recent')}</strong><small>{t('resources.recentHint')}</small></div><Link to="/"><span>{t('actions.allResources')}</span><Icon name="chevronRight" /></Link></header><ResourceSummary items={value.recent_resources} /></section>
      <section className="workspace-panel"><header><div><strong>{t('jobs.recent')}</strong><small>{t('jobs.recentHint')}</small></div><Link to="/tasks"><span>{t('actions.allTasks')}</span><Icon name="chevronRight" /></Link></header><JobList compact items={value.recent_jobs} /></section></div>
  </main>
}
