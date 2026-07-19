import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Icon from '../Icon'
import { useToast } from '../toast'
import { platformSettingsApi } from '../../platform-settings/api'
import type { MonitoringPlatformSettings, MonitoringPlatformSettingsInput } from '../../platform-settings/types'

type IntervalUnit = 'seconds' | 'minutes' | 'hours'
type IntervalDraft = { amount: number; unit: IntervalUnit }

function intervalDraft(seconds: number): IntervalDraft {
  if (seconds % 3600 === 0) return { amount: seconds / 3600, unit: 'hours' }
  if (seconds % 60 === 0) return { amount: seconds / 60, unit: 'minutes' }
  return { amount: seconds, unit: 'seconds' }
}

function intervalSeconds(value: IntervalDraft) {
  return Math.round(value.amount * (value.unit === 'hours' ? 3600 : value.unit === 'minutes' ? 60 : 1))
}

function changeIntervalUnit(value: IntervalDraft, unit: IntervalUnit): IntervalDraft {
  const divisor = unit === 'hours' ? 3600 : unit === 'minutes' ? 60 : 1
  return { amount: Number((intervalSeconds(value) / divisor).toFixed(4)), unit }
}

function inputFrom(value: MonitoringPlatformSettings): MonitoringPlatformSettingsInput {
  return {
    automatic_collection: value.automatic_collection,
    interval_seconds: value.interval_seconds,
    quota_automatic_collection: value.quota_automatic_collection,
    quota_interval_seconds: value.quota_interval_seconds,
    retention_days: value.retention_days,
    raw_ranges: [...value.raw_ranges],
  }
}

export default function MonitoringSettingsTab() {
  const { t } = useTranslation(['platformSettings', 'common'])
  const toast = useToast()
  const [current, setCurrent] = useState<MonitoringPlatformSettings | null>(null)
  const [draft, setDraft] = useState<MonitoringPlatformSettingsInput | null>(null)
  const [monitorInterval, setMonitorInterval] = useState<IntervalDraft>({ amount: 1, unit: 'minutes' })
  const [quotaInterval, setQuotaInterval] = useState<IntervalDraft>({ amount: 5, unit: 'minutes' })
  const [busy, setBusy] = useState(false), [error, setError] = useState('')

  function hydrate(value: MonitoringPlatformSettings) {
    setCurrent(value)
    setDraft(inputFrom(value))
    setMonitorInterval(intervalDraft(value.interval_seconds))
    setQuotaInterval(intervalDraft(value.quota_interval_seconds))
  }

  useEffect(() => { platformSettingsApi.monitoring().then(hydrate).catch(reason => setError(reason.message)) }, [])
  const monitorSeconds = intervalSeconds(monitorInterval), quotaSeconds = intervalSeconds(quotaInterval)
  const invalidInterval = !Number.isFinite(monitorSeconds) || !Number.isFinite(quotaSeconds) || monitorSeconds < 30 || quotaSeconds < 30 || monitorSeconds > 86400 || quotaSeconds > 86400
  const nextInput = useMemo<MonitoringPlatformSettingsInput | null>(() => draft ? { ...draft, interval_seconds: monitorSeconds, quota_interval_seconds: quotaSeconds } : null, [draft, monitorSeconds, quotaSeconds])
  const dirty = !!current && !!nextInput && JSON.stringify(inputFrom(current)) !== JSON.stringify(nextInput)
  const invalidRetention = !Number.isInteger(draft?.retention_days) || (draft?.retention_days || 0) < 1 || (draft?.retention_days || 0) > 365
  const highFrequency = draft?.automatic_collection && monitorSeconds < 60 || draft?.quota_automatic_collection && quotaSeconds < 300

  function toggleRange(key: string) {
    setDraft(value => {
      if (!value) return value
      const selected = value.raw_ranges.includes(key)
      if (selected && value.raw_ranges.length === 1) return value
      const raw_ranges = selected ? value.raw_ranges.filter(item => item !== key) : [...value.raw_ranges, key]
      return { ...value, raw_ranges: current?.supported_ranges.filter(item => raw_ranges.includes(item)) || raw_ranges }
    })
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!nextInput || invalidInterval || !dirty) return
    setBusy(true); setError('')
    try {
      const value = await platformSettingsApi.updateMonitoring(nextInput)
      hydrate(value)
      toast.success(t('monitoring.saved'))
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : t('common:errors.requestFailed')
      setError(message)
      toast.error(t('common:errors.operationFailed'), { description: message, dedupeKey: 'monitoring-settings-error' })
    } finally { setBusy(false) }
  }

  function reset() { if (current) hydrate(current); setError('') }
  if (!current || !draft) return error ? <div className="error">{error}</div> : <div className="platform-settings-loading"><span className="action-spinner" />{t('common:status.loading')}</div>

  const intervalControl = (value: IntervalDraft, setValue: (next: IntervalDraft) => void, labelKey: string) => <div className="monitoring-interval-control">
    <input aria-label={t(labelKey)} type="number" min={value.unit === 'seconds' ? 30 : value.unit === 'minutes' ? .5 : .0083} max={value.unit === 'hours' ? 24 : value.unit === 'minutes' ? 1440 : 86400} step={value.unit === 'seconds' ? 1 : 'any'} value={value.amount} onChange={event => setValue({ ...value, amount: Number(event.target.value) })} />
    <select aria-label={t('monitoring.intervalUnit')} value={value.unit} onChange={event => setValue(changeIntervalUnit(value, event.target.value as IntervalUnit))}><option value="seconds">{t('monitoring.units.seconds')}</option><option value="minutes">{t('monitoring.units.minutes')}</option><option value="hours">{t('monitoring.units.hours')}</option></select>
  </div>

  return <form className="platform-settings-tab" onSubmit={save}>
    <section className="platform-settings-summary"><span><Icon name="analytics" size={22} /></span><div><strong>{t('monitoring.statusTitle')}</strong><p>{t('monitoring.statusHint')}</p></div><em className={draft.automatic_collection || draft.quota_automatic_collection ? 'active' : ''}><i />{t(draft.automatic_collection || draft.quota_automatic_collection ? 'status.running' : 'status.inactive')}</em></section>
    {error && <div className="error">{error}</div>}
    <section className="platform-settings-card monitoring-policy-card">
      <header><div><h2>{t('monitoring.policyTitle')}</h2><p>{t('monitoring.policyHint')}</p></div><span className="platform-card-icon"><Icon name="clock" size={20} /></span></header>
      <div className="monitoring-policy-grid">
        <article><header><span><Icon name="analytics" /></span><div><strong>{t('monitoring.systemCollection')}</strong><small>{t('monitoring.systemCollectionHint')}</small></div><label className="platform-switch monitoring-enable-switch"><input type="checkbox" checked={draft.automatic_collection} onChange={event => setDraft({ ...draft, automatic_collection: event.target.checked })} /><span /><b>{t(draft.automatic_collection ? 'monitoring.enabled' : 'monitoring.disabled')}</b></label></header><label>{t('monitoring.interval')}{intervalControl(monitorInterval, setMonitorInterval, 'monitoring.monitoringInterval')}</label></article>
        <article><header><span><Icon name="database" /></span><div><strong>{t('monitoring.quotaCollection')}</strong><small>{t('monitoring.quotaCollectionHint')}</small></div><label className="platform-switch monitoring-enable-switch"><input type="checkbox" checked={draft.quota_automatic_collection} onChange={event => setDraft({ ...draft, quota_automatic_collection: event.target.checked })} /><span /><b>{t(draft.quota_automatic_collection ? 'monitoring.enabled' : 'monitoring.disabled')}</b></label></header><label>{t('monitoring.interval')}{intervalControl(quotaInterval, setQuotaInterval, 'monitoring.quotaInterval')}</label></article>
      </div>
      {(invalidInterval || highFrequency) && <div className={`monitoring-frequency-note ${invalidInterval ? 'error-note' : ''}`}><Icon name="warning" /><div><strong>{t(invalidInterval ? 'monitoring.invalidInterval' : 'monitoring.highFrequency')}</strong><p>{t(invalidInterval ? 'monitoring.invalidIntervalHint' : 'monitoring.highFrequencyHint')}</p></div></div>}
    </section>
    <section className="platform-settings-card monitoring-data-card">
      <header><div><h2>{t('monitoring.dataTitle')}</h2><p>{t('monitoring.dataHint')}</p></div><span className="platform-card-icon"><Icon name="database" size={20} /></span></header>
      <div className="platform-settings-form monitoring-data-form"><label>{t('monitoring.retention')}<input required type="number" min="1" max="365" step="1" value={draft.retention_days} onChange={event => setDraft({ ...draft, retention_days: Number(event.target.value) })} /><small>{t('monitoring.retentionEditHint')}</small></label><fieldset><legend>{t('monitoring.ranges')}</legend><div>{current.supported_ranges.map(key => <label key={key} className={draft.raw_ranges.includes(key) ? 'active' : ''}><input type="checkbox" checked={draft.raw_ranges.includes(key)} onChange={() => toggleRange(key)} /><span><Icon name="check" />{t(`monitoring.rangeLabels.${key}`)}</span></label>)}</div><small>{t('monitoring.rangesEditHint')}</small></fieldset></div>
      <footer><span>{t('monitoring.footerHint')}</span><div><button type="button" className="secondary" disabled={busy || !dirty} onClick={reset}>{t('common:actions.cancel')}</button><button className="primary icon-button" disabled={busy || !dirty || invalidInterval || invalidRetention}>{busy ? <span className="action-spinner" /> : <Icon name="check" />}{t('common:actions.save')}</button></div></footer>
    </section>
    <section className="platform-settings-note"><Icon name="shield" /><div><strong>{t('monitoring.privacy')}</strong><p>{t('monitoring.privacyHint')}</p></div></section>
  </form>
}
