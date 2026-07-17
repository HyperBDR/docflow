import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../api'
import Icon from '../Icon'
import { useToast } from '../toast'
import { QUOTA_METRICS, formatQuotaValue } from '../../quota/catalog'
import type { QuotaPlanStatistics } from '../../quota/types'
import { normalizeLocale } from '../../i18n'

export default function QuotaPlansPanel({ refreshKey = 0, onChanged }: { refreshKey?: number; onChanged: () => void }) {
  const { t, i18n } = useTranslation(['admin', 'platformSettings', 'common'])
  const toast = useToast(), locale = normalizeLocale(i18n.language)
  const [items, setItems] = useState<QuotaPlanStatistics[]>([]), [selected, setSelected] = useState('')
  const [draft, setDraft] = useState<QuotaPlanStatistics | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const load = () => api.quotaPlanStatistics().then(value => { setItems(value); setSelected(current => current || value[0]?.id || '') }).catch(reason => setError(reason.message))
  useEffect(() => { void load() }, [refreshKey])
  useEffect(() => { const item = items.find(value => value.id === selected); setDraft(item ? { ...item, limits: { ...item.limits } } : null) }, [items, selected])
  async function create() {
    setBusy(true); setError('')
    try { const value = await api.createQuotaPlan({ name: `${t('admin:quotas.plans.newName')} ${items.length + 1}`, description: '', limits: items[0]?.limits || {} }); await load(); setSelected(value.id); onChanged() }
    catch (reason) { setError((reason as Error).message) } finally { setBusy(false) }
  }
  async function save() {
    if (!draft) return
    setBusy(true); setError('')
    try { await api.updateQuotaPlan(draft.id, { name: draft.name, description: draft.description, is_default: draft.is_default, limits: draft.limits }); toast.success(t('admin:quotas.plans.saved')); await load(); onChanged() }
    catch (reason) { setError((reason as Error).message) } finally { setBusy(false) }
  }
  return <div className="quota-plan-layout">
    {error && <div className="error quota-wide">{error}</div>}
    <aside className="quota-plan-sidebar"><header><div><strong>{t('admin:quotas.plans.title')}</strong><small>{t('admin:quotas.plans.hint')}</small></div><button disabled={busy} onClick={create}><Icon name="plus" />{t('admin:quotas.plans.add')}</button></header><div>{items.map(item => <button key={item.id} className={selected === item.id ? 'active' : ''} onClick={() => setSelected(item.id)}><span><strong>{item.name}</strong>{item.is_default && <em>{t('admin:quotas.default')}</em>}</span><small>{t('admin:quotas.plans.applied', { count: item.statistics.spaces })}</small><div><i className="normal" />{item.statistics.normal}<i className="warning" />{item.statistics.warning}<i className="exceeded" />{item.statistics.exceeded}</div></button>)}</div></aside>
    {draft && <section className="quota-plan-editor"><header><div><strong>{t('admin:quotas.plans.edit')}</strong><small>{t('admin:quotas.plans.editHint')}</small></div><div className="quota-plan-stats"><span>{t('admin:quotas.types.team')} <b>{draft.statistics.team_spaces}</b></span><span>{t('admin:quotas.types.personal')} <b>{draft.statistics.personal_spaces}</b></span><span>{t('admin:quotas.overrides')} <b>{draft.statistics.overrides}</b></span></div></header><div className="quota-plan-basics"><label>{t('platformSettings:quota.name')}<input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label><label>{t('platformSettings:quota.description')}<input value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label><label className="quota-default-switch"><span><strong>{t('platformSettings:quota.setDefault')}</strong><small>{t('admin:quotas.plans.defaultHint')}</small></span><input type="checkbox" checked={draft.is_default} onChange={event => setDraft({ ...draft, is_default: event.target.checked })} /><i /></label></div><div className="quota-plan-metrics">{QUOTA_METRICS.map(metric => <label key={metric.key}><span className={`quota-metric-icon ${metric.tone}`}><Icon name={metric.icon} /></span><span><strong>{t(`platformSettings:quota.metrics.${metric.key}`)}</strong><small>{t(`admin:quotas.enforcement.${['monthly_public_views', 'monthly_download_bytes'].includes(metric.key) ? 'soft' : 'hard'}`)} · {formatQuotaValue(metric.key, draft.limits[metric.key], locale)}</small></span><input type="number" min="0" value={draft.limits[metric.key] ?? ''} onChange={event => setDraft({ ...draft, limits: { ...draft.limits, [metric.key]: event.target.value === '' ? null : Number(event.target.value) } })} /></label>)}</div><footer><button className="primary icon-button" disabled={busy || !draft.name.trim()} onClick={save}>{busy ? <span className="action-spinner" /> : <Icon name="check" />}{t('common:actions.save')}</button></footer></section>}
  </div>
}
