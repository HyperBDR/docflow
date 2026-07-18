import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { api } from '../../api'
import { normalizeLocale } from '../../i18n'
import { QUOTA_METRICS, formatQuotaValue } from '../../quota/catalog'
import type { PlatformQuotaLimits, PlatformQuotaPreview, QuotaMetricKey } from '../../quota/types'
import { useToast } from '../toast'
import Icon from '../Icon'
import QuotaLimitInput from './QuotaLimitInput'
import '../../styles/platform-quota-limits.css'

export default function PlatformQuotaLimitsPanel() {
  const { t, i18n } = useTranslation(['admin', 'platformSettings', 'common'])
  const locale = normalizeLocale(i18n.language), toast = useToast()
  const [value, setValue] = useState<PlatformQuotaLimits | null>(null)
  const [maximums, setMaximums] = useState<Record<QuotaMetricKey, number> | null>(null)
  const [unlimited, setUnlimited] = useState<Record<QuotaMetricKey, boolean> | null>(null)
  const [preview, setPreview] = useState<PlatformQuotaPreview | null>(null)
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [confirmImpact, setConfirmImpact] = useState(false), [error, setError] = useState('')
  function hydrate(next: PlatformQuotaLimits) { setValue(next); setMaximums({ ...next.maximums }); setUnlimited({ ...next.allow_unlimited }); setPreview({ ...next.impact, maximums: next.maximums, allow_unlimited: next.allow_unlimited }); setConfirmImpact(false) }
  useEffect(() => { api.platformQuotaLimits().then(hydrate).catch(reason => setError(reason.message)).finally(() => setLoading(false)) }, [])
  const dirty = useMemo(() => !!value && !!maximums && !!unlimited && (JSON.stringify(maximums) !== JSON.stringify(value.maximums) || JSON.stringify(unlimited) !== JSON.stringify(value.allow_unlimited)), [value, maximums, unlimited])
  useEffect(() => {
    if (!dirty || !maximums || !unlimited) return
    setConfirmImpact(false)
    const timer = window.setTimeout(() => api.previewPlatformQuotaLimits(maximums, unlimited).then(setPreview).catch(reason => setError(reason.message)), 350)
    return () => window.clearTimeout(timer)
  }, [dirty, maximums, unlimited])
  async function save() {
    if (!maximums || !unlimited || !preview) return
    const affected = preview.affected_plan_count + preview.affected_space_count
    if (affected && !confirmImpact) return
    setSaving(true)
    try { const next = await api.updatePlatformQuotaLimits(maximums, unlimited, confirmImpact); hydrate(next); toast.success(t('admin:quotas.platformLimits.saved')) }
    catch (reason) { toast.error((reason as Error).message) } finally { setSaving(false) }
  }
  if (loading) return <div className="quota-loading"><span className="action-spinner" />{t('admin:loading')}</div>
  if (error && !value) return <div className="error">{error}</div>
  if (!value || !maximums || !unlimited) return null
  const affected = (preview?.affected_plan_count || 0) + (preview?.affected_space_count || 0)
  return <section className="platform-quota-limits">
    <header><div><span><Icon name="shield" size={20} /></span><div><strong>{t('admin:quotas.platformLimits.title')}</strong><small>{t('admin:quotas.platformLimits.hint')}</small></div></div><Link className="icon-button" to="/admin/monitoring/rules"><Icon name="warning" />{t('admin:quotas.platformLimits.alertRules')}</Link></header>
    {error && <div className="error">{error}</div>}
    <div className="platform-quota-notice"><Icon name="help" /><div><strong>{t('admin:quotas.platformLimits.boundaryTitle')}</strong><p>{t('admin:quotas.platformLimits.boundaryHint')}</p></div></div>
    <div className="platform-quota-grid">{QUOTA_METRICS.map(catalog => {
      const metric = value.metrics.find(item => item.key === catalog.key)!
      const metricAffectedPlans = preview?.metric_plan_counts[catalog.key] || 0, metricAffectedSpaces = preview?.metric_space_counts[catalog.key] || 0
      return <article key={catalog.key} className={metricAffectedPlans || metricAffectedSpaces ? 'affected' : ''}>
        <header><span className={`quota-metric-icon ${catalog.tone}`}><Icon name={catalog.icon} /></span><div><strong>{t(`platformSettings:quota.metrics.${catalog.key}`)}</strong><small>{t(`admin:quotas.enforcement.${['monthly_public_views', 'monthly_download_bytes'].includes(catalog.key) ? 'soft' : 'hard'}`)}</small></div><label className="platform-unlimited-toggle"><span>{t('admin:quotas.platformLimits.allowUnlimited')}</span><input type="checkbox" checked={unlimited[catalog.key]} onChange={event => setUnlimited({ ...unlimited, [catalog.key]: event.target.checked })} /><i /></label></header>
        <label className="platform-limit-field"><span>{t('admin:quotas.platformLimits.maximum')}</span><QuotaLimitInput metric={catalog.key} value={maximums[catalog.key]} onChange={next => setMaximums({ ...maximums, [catalog.key]: next ?? 0 })} /></label>
        <dl><div><dt>{t('admin:quotas.platformLimits.defaultPlan')}</dt><dd>{formatQuotaValue(catalog.key, metric.default_plan_value, locale)}</dd></div><div><dt>{t('admin:quotas.platformLimits.highestPlan')}</dt><dd>{formatQuotaValue(catalog.key, metric.highest_plan_value, locale)}</dd></div><div><dt>{t('admin:quotas.platformLimits.totalUsed')}</dt><dd>{formatQuotaValue(catalog.key, metric.total_used, locale)}</dd></div><div><dt>{t('admin:quotas.platformLimits.growth')}</dt><dd className={metric.growth_percent > 0 ? 'up' : ''}>{metric.growth_percent > 0 ? '+' : ''}{metric.growth_percent}%</dd></div></dl>
        <div className="platform-capacity"><span><i style={{ width: `${Math.min(100, metric.capacity_percent)}%` }} /></span><small>{t('admin:quotas.platformLimits.capacity', { value: metric.capacity_percent })}</small></div>
        <footer className={metricAffectedPlans || metricAffectedSpaces ? 'affected' : ''}><Icon name={metricAffectedPlans || metricAffectedSpaces ? 'warning' : 'check'} /><span>{t(metricAffectedPlans || metricAffectedSpaces ? 'admin:quotas.platformLimits.metricAffected' : 'admin:quotas.platformLimits.metricSafe', { plans: metricAffectedPlans, spaces: metricAffectedSpaces })}</span></footer>
      </article>
    })}</div>
    <aside className={`platform-impact-preview${affected ? ' danger' : ''}`}><div><span><Icon name={affected ? 'warning' : 'check'} /></span><div><strong>{t('admin:quotas.platformLimits.previewTitle')}</strong><p>{t(affected ? 'admin:quotas.platformLimits.previewAffected' : 'admin:quotas.platformLimits.previewSafe', { plans: preview?.affected_plan_count || 0, spaces: preview?.affected_space_count || 0 })}</p></div></div>{!!affected && <><div className="platform-impact-lists"><div><strong>{t('admin:quotas.platformLimits.affectedPlans')}</strong>{preview?.affected_plans.slice(0, 6).map(item => <span key={item.id} title={item.metrics.map(key => t(`platformSettings:quota.metrics.${key}`)).join('、')}>{item.name}<b>{item.metrics.length}</b></span>)}</div><div><strong>{t('admin:quotas.platformLimits.affectedSpaces')}</strong>{preview?.affected_spaces.slice(0, 6).map(item => <span key={item.id} title={item.metrics.map(key => t(`platformSettings:quota.metrics.${key}`)).join('、')}>{item.name}<b>{item.metrics.length}</b></span>)}</div></div><label className="platform-impact-confirm"><input type="checkbox" checked={confirmImpact} onChange={event => setConfirmImpact(event.target.checked)} /><span><strong>{t('admin:quotas.platformLimits.confirmTitle')}</strong><small>{t('admin:quotas.platformLimits.confirmHint')}</small></span></label></>}</aside>
    <footer className="platform-quota-actions"><button disabled={!dirty || saving} onClick={() => hydrate(value)}>{t('admin:quotas.platformLimits.reset')}</button><button className="primary icon-button" disabled={!dirty || saving || (!!affected && !confirmImpact)} onClick={save}>{saving ? <span className="action-spinner" /> : <Icon name="check" />}{t('common:actions.save')}</button></footer>
  </section>
}
