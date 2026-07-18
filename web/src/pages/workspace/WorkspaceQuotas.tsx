import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { workspaceApi } from '../../workspace/api'
import type { WorkspaceQuota, WorkspaceQuotaHistory, WorkspaceQuotaItem } from '../../workspace/types'
import { formatDate, normalizeLocale, type Locale } from '../../i18n'
import { formatQuotaValue } from '../../quota/catalog'
import QuotaHealthRanking from '../../components/quota/QuotaHealthRanking'
import QuotaMetricDetailDrawer from '../../components/quota/QuotaMetricDetailDrawer'
import { usePlatformConfig } from '../../components/platform-config/PlatformConfigContext'
import Icon from '../../components/Icon'
import '../../styles/usage-plan.css'

function display(item: WorkspaceQuotaItem, locale: Locale) {
  return `${formatQuotaValue(item.key, item.used, locale)} / ${item.limit == null ? '∞' : formatQuotaValue(item.key, item.limit, locale)}`
}

export default function WorkspaceQuotas() {
  const { t, i18n } = useTranslation(['workspace', 'common']), locale = normalizeLocale(i18n.language)
  const { upgradeUrl } = usePlatformConfig()
  const [value, setValue] = useState<WorkspaceQuota | null>(null), [history, setHistory] = useState<WorkspaceQuotaHistory | null>(null)
  const [selectedMetric, setSelectedMetric] = useState<WorkspaceQuotaItem | null>(null), [error, setError] = useState('')
  useEffect(() => {
    Promise.all([workspaceApi.quotas(), workspaceApi.quotaHistory(30)]).then(([quota, trend]) => {
      setValue(quota); setHistory(trend)
    }).catch(reason => setError(reason.message))
  }, [])
  const highest = useMemo(() => value?.items.filter(item => item.limit != null).sort((a, b) => b.percent - a.percent)[0], [value])
  const tone = !highest ? 'normal' : highest.percent >= 100 ? 'critical' : highest.percent >= 85 ? 'warning' : highest.percent >= 70 ? 'notice' : 'normal'
  return <main className="workspace-page workspace-quotas usage-plan-page">
    <header className="workspace-page-heading"><div><h1>{t('quotas.title')}</h1><p>{t('quotas.subtitle')}</p></div>{value && <span className="quota-plan-badge"><Icon name="shield" />{value.plan.name}</span>}</header>
    {error ? <div className="workspace-state error">{error}</div> : !value || !highest ? <div className="workspace-state">{t('loading')}</div> : <>
      <section className="usage-plan-hero">
        <div className="usage-plan-identity"><span><Icon name="shield" size={23} /></span><div><small>{t('quotas.currentPlan')}</small><strong>{value.plan.name}</strong><p>{value.plan.description || t('quotas.defaultDescription')}</p></div></div>
        <div className="usage-plan-stat"><small>{t('quotas.highestUsage')}</small><strong>{t(`quotas.metrics.${highest.key}`)} · {highest.percent.toFixed(1)}%</strong><p>{display(highest, locale)}</p></div>
        <div className="usage-plan-stat"><small>{t('quotas.reset')}</small><strong>{formatDate(value.period.resets_at, locale)}</strong><p>{t(value.has_overrides ? 'quotas.overridden' : 'quotas.standard')}</p></div>
        {upgradeUrl && value.can_manage_plan && highest.percent >= 70 && <a href={upgradeUrl} target="_blank" rel="noopener noreferrer"><Icon name="arrowUp" />{t('quotas.upgrade')}</a>}
      </section>
      {highest.percent >= 70 && <section className={`usage-plan-alert ${tone}`}><Icon name={tone === 'critical' ? 'warning' : 'analytics'} /><div><strong>{t(`quotas.prompts.${tone}.title`)}</strong><p>{t(value.can_manage_plan ? `quotas.prompts.${tone}.owner` : 'quotas.prompts.member')}</p></div>{upgradeUrl && value.can_manage_plan && <a href={upgradeUrl} target="_blank" rel="noopener noreferrer"><span>{t('quotas.upgrade')}</span></a>}</section>}
      {history && <QuotaHealthRanking history={history} items={value.items} onSelect={setSelectedMetric} />}
      <section className="workspace-panel quota-note"><Icon name="help" /><div><strong>{t('quotas.noteTitle')}</strong><p>{t('quotas.note')}</p></div></section>
      {history && selectedMetric && <QuotaMetricDetailDrawer history={history} item={selectedMetric} onClose={() => setSelectedMetric(null)} />}
    </>}
  </main>
}
