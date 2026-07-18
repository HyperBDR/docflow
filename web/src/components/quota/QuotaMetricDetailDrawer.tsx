import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { normalizeLocale } from '../../i18n'
import { formatQuotaValue, quotaMetric } from '../../quota/catalog'
import type { WorkspaceQuotaHistory, WorkspaceQuotaItem } from '../../workspace/types'
import Icon from '../Icon'
import QuotaTrendChart from './QuotaTrendChart'

export default function QuotaMetricDetailDrawer({ history, item, onClose }: {
  history: WorkspaceQuotaHistory
  item: WorkspaceQuotaItem
  onClose: () => void
}) {
  const { t, i18n } = useTranslation(['workspace', 'common'])
  const locale = normalizeLocale(i18n.language)
  const definition = quotaMetric(item.key)
  const points = useMemo(() => history.points.map(point => ({
    date: point.date,
    used: point.metrics[item.key]?.used || 0,
    limit: point.metrics[item.key]?.limit || 0,
    percent: point.metrics[item.key]?.percent || 0,
  })), [history.points, item.key])

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [onClose])

  return <div className="workspace-quota-drawer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <aside className="workspace-quota-drawer" aria-label={t(`quotas.metrics.${item.key}`)}>
      <header>
        <div><span className={`quota-metric-icon ${definition.tone}`}><Icon name={definition.icon} /></span><div><small>{t('quotaTrends.details')}</small><h2>{t(`quotas.metrics.${item.key}`)}</h2><p>{t('quotaTrends.drawerHint')}</p></div></div>
        <button type="button" onClick={onClose} aria-label={t('common:actions.close')}><Icon name="close" /></button>
      </header>
      <div className="workspace-quota-drawer-body">
        <section className="workspace-quota-detail-summary">
          <article><small>{t('quotas.used')}</small><strong>{formatQuotaValue(item.key, item.used, locale)}</strong></article>
          <article><small>{t('quotas.capacity')}</small><strong>{formatQuotaValue(item.key, item.limit, locale)}</strong></article>
          <article><small>{t('quotaTrends.utilization')}</small><strong>{item.percent.toFixed(1)}%</strong></article>
        </section>
        <section className="workspace-quota-detail-chart">
          {points.length > 1 ? <QuotaTrendChart points={points} usedLabel={t('quotas.used')} limitLabel={t('quotas.capacity')} formatValue={value => formatQuotaValue(item.key, value, locale)} /> : <div className="usage-plan-chart-empty">{t('quotaTrends.noHistory')}</div>}
        </section>
        <section className="workspace-quota-history-table">
          <header><strong>{t('quotaTrends.daily')}</strong></header>
          <div><table><thead><tr><th>{t('quotaTrends.date')}</th><th>{t('quotas.used')}</th><th>{t('quotas.capacity')}</th><th>{t('quotaTrends.utilization')}</th></tr></thead><tbody>{[...points].reverse().map(point => <tr key={point.date}><td>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(`${point.date}T00:00:00`))}</td><td>{formatQuotaValue(item.key, point.used, locale)}</td><td>{formatQuotaValue(item.key, point.limit, locale)}</td><td><b>{point.percent.toFixed(1)}%</b></td></tr>)}</tbody></table></div>
        </section>
      </div>
    </aside>
  </div>
}
