import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../api'
import { normalizeLocale } from '../../i18n'
import { QUOTA_METRICS, formatQuotaValue, quotaMetric } from '../../quota/catalog'
import type { QuotaMetricKey, QuotaSpace, QuotaSpaceHistory } from '../../quota/types'
import Icon from '../Icon'
import OrganizationQuotaPanel from '../admin/OrganizationQuotaPanel'
import QuotaTrendChart from './QuotaTrendChart'

export default function QuotaSpaceDrawer({ space, onClose }: { space: QuotaSpace; onClose: () => void }) {
  const { t, i18n } = useTranslation(['admin', 'platformSettings', 'common'])
  const locale = normalizeLocale(i18n.language)
  const [tab, setTab] = useState<'overview' | 'quota' | 'history'>('overview'), [metric, setMetric] = useState<QuotaMetricKey>('storage_bytes')
  const [history, setHistory] = useState<QuotaSpaceHistory | null>(null)
  useEffect(() => { api.quotaSpaceHistory(space.id, 365).then(setHistory).catch(() => setHistory(null)) }, [space.id])
  const points = useMemo(() => (history?.points || []).map(point => ({ date: point.date, used: point.metrics[metric]?.used || 0, limit: point.metrics[metric]?.limit || 0, percent: point.metrics[metric]?.percent || 0 })), [history, metric])
  return <div className="quota-drawer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><aside className="quota-space-drawer"><header><div><span><Icon name={space.kind === 'personal' ? 'user' : 'users'} /></span><div><small>{t(`admin:quotas.types.${space.kind}`)}</small><h2>{space.name}</h2><p>{space.owner_name || space.owner_email} · {space.plan.name}</p></div></div><button onClick={onClose} aria-label={t('common:actions.close')}><Icon name="close" /></button></header><nav>{(['overview', 'quota', 'history'] as const).map(value => <button key={value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}><Icon name={value === 'overview' ? 'grid' : value === 'quota' ? 'database' : 'analytics'} />{t(`admin:quotas.drawer.tabs.${value}`)}</button>)}</nav><div className="quota-drawer-body">
    {tab === 'overview' && <><section className="quota-space-summary"><article><small>{t('admin:quotas.plan')}</small><strong>{space.plan.name}</strong></article><article><small>{t('admin:quotas.health.title')}</small><strong className={space.health}>{t(`admin:quotas.health.${space.health}`)}</strong></article><article><small>{t('admin:quotas.highestUsage')}</small><strong>{space.highest_percent.toFixed(1)}%</strong></article><article><small>{t('admin:quotas.growth')}</small><strong>{space.growth_percent > 0 ? '+' : ''}{space.growth_percent}%</strong></article></section><div className="quota-drawer-metrics">{space.items.map(item => { const catalog = quotaMetric(item.key); return <article key={item.key}><span className={`quota-metric-icon ${catalog.tone}`}><Icon name={catalog.icon} /></span><div><strong>{t(`platformSettings:quota.metrics.${item.key}`)}</strong><small>{formatQuotaValue(item.key, item.used, locale)} / {formatQuotaValue(item.key, item.limit, locale)}</small><i><b className={item.status} style={{ width: `${Math.min(100, item.percent)}%` }} /></i></div><em className={item.status}>{item.percent.toFixed(1)}%</em></article> })}</div></>}
    {tab === 'quota' && <OrganizationQuotaPanel id={space.id} />}
    {tab === 'history' && <section className="quota-space-history"><header><div><strong>{t('admin:quotas.drawer.historyTitle')}</strong><small>{t('admin:quotas.drawer.historyHint')}</small></div><select value={metric} onChange={event => setMetric(event.target.value as QuotaMetricKey)}>{QUOTA_METRICS.map(item => <option key={item.key} value={item.key}>{t(`platformSettings:quota.metrics.${item.key}`)}</option>)}</select></header>{points.length ? <QuotaTrendChart points={points} usedLabel={t('admin:quotas.used')} limitLabel={t('admin:quotas.limit')} formatValue={value => formatQuotaValue(metric, value, locale)} /> : <div className="quota-empty"><Icon name="analytics" />{t('admin:quotas.noHistory')}</div>}</section>}
  </div></aside></div>
}
