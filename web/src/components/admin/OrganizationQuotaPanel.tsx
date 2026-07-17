import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../api'
import { normalizeLocale } from '../../i18n'
import { QUOTA_METRICS, formatQuotaValue } from '../../quota/catalog'
import type { QuotaPlan, QuotaSummary } from '../../types'
import Icon from '../Icon'
import { useToast } from '../toast'

export default function OrganizationQuotaPanel({ id }: { id: string }) {
  const { t, i18n } = useTranslation(['admin', 'platformSettings', 'common'])
  const locale = normalizeLocale(i18n.language), toast = useToast()
  const [plans, setPlans] = useState<QuotaPlan[]>([]), [value, setValue] = useState<QuotaSummary | null>(null)
  const [plan, setPlan] = useState(''), [overrides, setOverrides] = useState<Record<string, number | null>>({})
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    setError('')
    Promise.all([api.quotaPlans(), api.organizationQuota(id)]).then(([planValues, quota]) => {
      setPlans(planValues); setValue(quota); setPlan(quota.assignment?.plan_id || quota.plan.id); setOverrides(quota.assignment?.overrides || {})
    }).catch(reason => setError(reason.message))
  }, [id])
  async function save() {
    setBusy(true); setError('')
    try { const quota = await api.updateOrganizationQuota(id, plan, overrides); setValue(quota); toast.success(t('admin:spaces.quotaSaved')) }
    catch (reason) { setError((reason as Error).message) } finally { setBusy(false) }
  }
  return <div className="organization-quota-panel"><header><div><h3>{t('admin:spaces.quotaTitle')}</h3><p>{t('admin:spaces.quotaHint')}</p></div><select value={plan} onChange={event => setPlan(event.target.value)}>{plans.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></header>{error && <div className="error">{error}</div>}<div className="organization-quota-grid">{QUOTA_METRICS.map(metric => { const current = value?.items.find(item => item.key === metric.key); return <label key={metric.key}><span className={`quota-metric-icon ${metric.tone}`}><Icon name={metric.icon} /></span><span><strong>{t(`platformSettings:quota.metrics.${metric.key}`)}</strong><small>{current ? `${formatQuotaValue(metric.key, current.used, locale)} / ${formatQuotaValue(metric.key, current.limit, locale)}` : '—'}</small></span><input type="number" min="0" value={overrides[metric.key] ?? ''} placeholder={t('admin:spaces.usePlan')} onChange={event => setOverrides({ ...overrides, [metric.key]: event.target.value === '' ? null : Number(event.target.value) })} /></label> })}</div><footer><button className="primary icon-button" disabled={busy} onClick={save}>{busy ? <span className="action-spinner" /> : <Icon name="check" />}{t('common:actions.save')}</button></footer></div>
}
