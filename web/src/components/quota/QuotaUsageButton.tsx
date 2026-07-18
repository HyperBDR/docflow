import { useEffect, useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { workspaceApi } from '../../workspace/api'
import type { WorkspaceQuota } from '../../workspace/types'
import { formatQuotaValue, quotaMetric } from '../../quota/catalog'
import { normalizeLocale } from '../../i18n'
import Icon from '../Icon'
import '../../styles/usage-plan.css'

function usageTone(percent: number) {
  return percent >= 100 ? 'critical' : percent >= 85 ? 'warning' : percent >= 70 ? 'notice' : 'normal'
}

export default function QuotaUsageButton({ organizationKey }: { organizationKey: string }) {
  const { t, i18n } = useTranslation('workspace')
  const locale = normalizeLocale(i18n.language)
  const [value, setValue] = useState<WorkspaceQuota | null>(null)

  useEffect(() => {
    let active = true
    const load = () => workspaceApi.quotas().then(result => { if (active) setValue(result) }).catch(() => undefined)
    void load(); const interval = window.setInterval(load, 60000)
    return () => { active = false; window.clearInterval(interval) }
  }, [organizationKey])

  const highestUsage = useMemo(() => value?.items
    .filter(item => item.limit != null)
    .sort((a, b) => b.percent - a.percent)
    .slice(0, 3) || [], [value])
  const highest = highestUsage[0]
  const tone = highest ? usageTone(highest.percent) : 'normal'
  const catalog = highest ? quotaMetric(highest.key) : quotaMetric('storage_bytes')

  return <NavLink
    to="/quotas"
    className={({ isActive }) => `sidebar-quota-card ${tone}${isActive ? ' active' : ''}`}
    aria-label={t('quotas.viewUsage')}
  >
    <header>
      <span className={`quota-metric-icon ${catalog.tone}`}><Icon name={catalog.icon} /></span>
      <div><small>{t('quotas.currentPlan')}</small><strong>{value?.plan.name || t('nav.quotas')}</strong></div>
      <Icon name="chevronRight" />
    </header>
    {highestUsage.length > 0 && <section className="sidebar-quota-items">
      {highestUsage.map(item => {
        const definition = quotaMetric(item.key)
        const itemTone = usageTone(item.percent)
        return <article className={itemTone} key={item.key}>
          <span className={`quota-metric-icon ${definition.tone}`}><Icon name={definition.icon} /></span>
          <div>
            <header><strong>{t(`quotas.metrics.${item.key}`)}</strong><b>{Math.round(item.percent)}%</b></header>
            <small>{formatQuotaValue(item.key, item.used, locale)} / {formatQuotaValue(item.key, item.limit, locale)}</small>
            <i><b style={{ width: `${Math.min(100, item.percent)}%` }} /></i>
          </div>
        </article>
      })}
    </section>}
    <footer><span>{t('quotas.viewUsage')}</span><Icon name="arrowRight" /></footer>
  </NavLink>
}
