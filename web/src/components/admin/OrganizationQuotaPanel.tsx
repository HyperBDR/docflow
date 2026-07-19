import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, api } from '../../api'
import { normalizeLocale } from '../../i18n'
import { QUOTA_METRICS, formatQuotaValue } from '../../quota/catalog'
import type { QuotaMetricKey } from '../../quota/types'
import type { QuotaLimits, QuotaPlan, QuotaSummary } from '../../types'
import Icon from '../Icon'
import { useToast } from '../toast'
import QuotaLimitInput from '../quota/QuotaLimitInput'
import '../../styles/organization-quota.css'

type OverrideMode = 'keep' | 'clear'

function sameOverrides(left: QuotaLimits, right: QuotaLimits) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  return [...keys].every(key => left[key] === right[key])
}

function hasOverride(values: QuotaLimits, key: string) {
  return Object.prototype.hasOwnProperty.call(values, key)
}

export default function OrganizationQuotaPanel({ id }: { id: string }) {
  const { t, i18n } = useTranslation(['admin', 'platformSettings', 'common'])
  const locale = normalizeLocale(i18n.language), toast = useToast()
  const [plans, setPlans] = useState<QuotaPlan[]>([]), [value, setValue] = useState<QuotaSummary | null>(null)
  const [plan, setPlan] = useState(''), [overrides, setOverrides] = useState<QuotaLimits>({})
  const [overrideMode, setOverrideMode] = useState<OverrideMode>('keep')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')

  function hydrate(quota: QuotaSummary) {
    setValue(quota)
    setPlan(quota.assignment?.plan_id || quota.plan.id)
    setOverrides({ ...(quota.assignment?.overrides || {}) })
    setOverrideMode('keep')
  }

  useEffect(() => {
    setError('')
    Promise.all([api.quotaPlans(), api.organizationQuota(id)]).then(([planValues, quota]) => {
      setPlans(planValues)
      hydrate(quota)
    }).catch(reason => setError(reason instanceof Error ? reason.message : t('common:errors.requestFailed')))
  }, [id])

  const selectedPlan = useMemo(() => plans.find(item => item.id === plan), [plan, plans])
  const savedPlanId = value?.assignment?.plan_id || value?.plan.id || ''
  const savedOverrides = value?.assignment?.overrides || {}
  const effectiveOverrides = overrideMode === 'keep' ? overrides : {}
  const dirty = !!value && (plan !== savedPlanId || overrideMode === 'clear' && Object.keys(savedOverrides).length > 0 || overrideMode === 'keep' && !sameOverrides(overrides, savedOverrides))

  function updateOverride(key: QuotaMetricKey, next: number | null) {
    setOverrides(current => {
      const updated = { ...current }
      if (next == null) delete updated[key]
      else updated[key] = next
      return updated
    })
  }

  function describeError(reason: unknown) {
    if (reason instanceof ApiError && reason.code === 'quota.platform_limit_exceeded') {
      const keys = reason.payload?.quota?.metrics || []
      const metrics = keys.map(key => t(`platformSettings:quota.metrics.${key}`, { defaultValue: key })).join(t('admin:spaces.metricSeparator'))
      const title = t('admin:spaces.platformLimitExceeded')
      const description = metrics
        ? t('admin:spaces.platformLimitExceededMetrics', { metrics })
        : t('admin:spaces.platformLimitExceededHint')
      return { title, description, inline: `${title}：${description}` }
    }
    const message = reason instanceof Error ? reason.message : t('common:errors.requestFailed')
    return { title: t('common:errors.operationFailed'), description: message, inline: message }
  }

  async function save() {
    if (!dirty) return
    setBusy(true); setError('')
    try {
      const quota = await api.updateOrganizationQuota(id, plan, effectiveOverrides)
      hydrate(quota)
      toast.success(t('admin:spaces.quotaSaved'))
    } catch (reason) {
      const message = describeError(reason)
      setError(message.inline)
      toast.error(message.title, { description: message.description, dedupeKey: 'organization-quota-error' })
    } finally { setBusy(false) }
  }

  function reset() {
    if (!value) return
    setPlan(savedPlanId)
    setOverrides({ ...savedOverrides })
    setOverrideMode('keep')
    setError('')
  }

  return <div className="organization-quota-panel">
    <header>
      <div><h3>{t('admin:spaces.quotaTitle')}</h3><p>{t('admin:spaces.quotaHint')}</p></div>
      <label className="organization-quota-plan-select"><span>{t('admin:spaces.proposedPlan')}</span><select value={plan} onChange={event => { setPlan(event.target.value); setError('') }}>{plans.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    </header>
    {error && <div className="error organization-quota-error"><Icon name="warning" />{error}</div>}
    {value && selectedPlan && <>
      <section className="organization-quota-plan-preview" aria-label={t('admin:spaces.planChangeTitle')}>
        <article><small>{t('admin:spaces.currentPlan')}</small><strong>{value.plan.name}</strong><span>{t('admin:spaces.currentlyEffective')}</span></article>
        <Icon name="chevronRight" />
        <article className={plan !== savedPlanId ? 'changed' : ''}><small>{t('admin:spaces.proposedPlan')}</small><strong>{selectedPlan.name}</strong><span>{plan !== savedPlanId ? t('admin:spaces.pendingSave') : t('admin:spaces.noPlanChange')}</span></article>
      </section>
      <fieldset className="organization-quota-override-choice">
        <legend>{t('admin:spaces.overrideStrategy')}</legend>
        <label className={overrideMode === 'keep' ? 'active' : ''}><input type="radio" name={`quota-override-mode-${id}`} checked={overrideMode === 'keep'} onChange={() => setOverrideMode('keep')} /><span><strong>{t('admin:spaces.keepOverrides')}</strong><small>{t('admin:spaces.keepOverridesHint')}</small></span></label>
        <label className={overrideMode === 'clear' ? 'active' : ''}><input type="radio" name={`quota-override-mode-${id}`} checked={overrideMode === 'clear'} onChange={() => setOverrideMode('clear')} /><span><strong>{t('admin:spaces.clearOverrides')}</strong><small>{t('admin:spaces.clearOverridesHint')}</small></span></label>
      </fieldset>
    </>}
    <div className="organization-quota-grid">{QUOTA_METRICS.map(metric => {
      const current = value?.items.find(item => item.key === metric.key)
      const planLimit = selectedPlan?.limits[metric.key]
      const overridden = overrideMode === 'keep' && hasOverride(overrides, metric.key)
      const proposed = overridden ? overrides[metric.key] : planLimit
      const changed = current?.limit !== proposed
      return <label key={metric.key} className={changed ? 'quota-value-changed' : ''}>
        <span className={`quota-metric-icon ${metric.tone}`}><Icon name={metric.icon} /></span>
        <span><strong>{t(`platformSettings:quota.metrics.${metric.key}`)}</strong><small className="quota-used-value">{t('admin:spaces.usedValue', { value: current ? formatQuotaValue(metric.key, current.used, locale) : '—' })}</small><small className="quota-limit-preview"><span>{t('admin:spaces.currentLimit')} <b>{current ? formatQuotaValue(metric.key, current.limit, locale) : '—'}</b></span><Icon name="chevronRight" size={12} /><span>{t('admin:spaces.proposedLimit')} <b>{formatQuotaValue(metric.key, proposed, locale)}</b></span></small><em>{t(overridden ? 'admin:spaces.overrideValue' : 'admin:spaces.planValue')}</em></span>
        <QuotaLimitInput metric={metric.key} value={overrideMode === 'keep' ? overrides[metric.key] : undefined} disabled={overrideMode === 'clear'} placeholder={t('admin:spaces.usePlanValue', { value: formatQuotaValue(metric.key, planLimit, locale) })} onChange={next => updateOverride(metric.key, next)} />
      </label>
    })}</div>
    <footer><button className="secondary" disabled={busy || !dirty} onClick={reset}>{t('admin:spaces.resetDraft')}</button><button className="primary icon-button" disabled={busy || !dirty || !selectedPlan} onClick={save}>{busy ? <span className="action-spinner" /> : <Icon name="check" />}{t('common:actions.save')}</button></footer>
  </div>
}
