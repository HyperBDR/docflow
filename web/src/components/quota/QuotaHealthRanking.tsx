import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { normalizeLocale } from '../../i18n'
import { formatQuotaValue, quotaMetric } from '../../quota/catalog'
import type { WorkspaceQuotaHistory, WorkspaceQuotaItem, WorkspaceQuotaMetricKey } from '../../workspace/types'
import Icon from '../Icon'
import MiniSparkline from '../charts/MiniSparkline'

function growthFor(key: WorkspaceQuotaMetricKey, history: WorkspaceQuotaHistory) {
  const values = history.points.map(point => point.metrics[key]?.percent).filter((value): value is number => value != null)
  return values.length > 1 ? values.at(-1)! - values[0] : 0
}

function healthFor(item: WorkspaceQuotaItem, growth: number) {
  if (item.limit == null) return 'unlimited'
  if (item.percent >= 100) return 'exceeded'
  if (item.percent >= 85) return 'warning'
  if (item.percent >= 70) return 'notice'
  if (growth >= 10) return 'rising'
  return 'healthy'
}

const healthWeight: Record<string, number> = { exceeded: 5, warning: 4, notice: 3, rising: 2, healthy: 1, unlimited: 0 }

export default function QuotaHealthRanking({ history, items, onSelect }: {
  history: WorkspaceQuotaHistory
  items: WorkspaceQuotaItem[]
  onSelect: (item: WorkspaceQuotaItem) => void
}) {
  const { t, i18n } = useTranslation('workspace')
  const locale = normalizeLocale(i18n.language)
  const ranked = useMemo(() => [...items].sort((a, b) => {
    const aGrowth = growthFor(a.key, history), bGrowth = growthFor(b.key, history)
    const risk = healthWeight[healthFor(b, bGrowth)] - healthWeight[healthFor(a, aGrowth)]
    return risk || b.percent - a.percent || bGrowth - aGrowth
  }), [history, items])

  return <section className="quota-health-ranking">
    <header><div><strong>{t('quotaTrends.title')}</strong><small>{t('quotaTrends.hint')}</small></div></header>
    <div className="quota-health-list">{ranked.map(item => {
      const definition = quotaMetric(item.key)
      const growth = growthFor(item.key, history)
      const health = healthFor(item, growth)
      const points = history.points.map(point => ({
        key: point.date,
        label: point.date.slice(5).replace('-', '/'),
        value: point.metrics[item.key]?.percent || 0,
      }))
      return <button type="button" className={`quota-health-row ${health}`} key={item.key} onClick={() => onSelect(item)}>
        <span className={`quota-metric-icon ${definition.tone}`}><Icon name={definition.icon} /></span>
        <span className="quota-health-identity"><strong>{t(`quotas.metrics.${item.key}`)}</strong><small>{formatQuotaValue(item.key, item.used, locale)} / {item.limit == null ? '∞' : formatQuotaValue(item.key, item.limit, locale)}</small></span>
        <span className="quota-health-capacity"><span><small>{t('quotaTrends.utilization')}</small><b>{item.limit == null ? '∞' : `${item.percent.toFixed(1)}%`}</b></span><i className={item.limit == null ? 'unlimited' : ''}><b style={{ width: `${Math.min(100, item.percent)}%` }} />{item.limit != null && <><em className="threshold threshold-70" /><em className="threshold threshold-85" /><em className="threshold threshold-100" /></>}</i>{item.limit != null && <span className="quota-threshold-labels"><small>70%</small><small>85%</small><small>100%</small></span>}</span>
        <span className="quota-health-growth"><small>{t('quotaTrends.growth')}</small><strong className={growth > 0 ? 'up' : growth < 0 ? 'down' : ''}>{growth > 0 ? '+' : ''}{growth.toFixed(1)}%</strong></span>
        <MiniSparkline ariaLabel={t(`quotas.metrics.${item.key}`)} color={health === 'exceeded' ? '#d4485e' : health === 'warning' || health === 'notice' ? '#d88a1d' : '#635bff'} points={points} formatValue={value => `${value.toFixed(1)}%`} />
        <span className={`quota-health-status ${health}`}><i />{t(`quotaTrends.status.${health}`)}</span>
        <Icon name="chevronRight" />
      </button>
    })}</div>
  </section>
}
