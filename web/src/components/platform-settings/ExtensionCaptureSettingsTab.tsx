import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { platformSettingsApi } from '../../platform-settings/api'
import type { ExtensionCapturePlatformSettings } from '../../platform-settings/types'
import Icon from '../Icon'
import { useToast } from '../toast'

export default function ExtensionCaptureSettingsTab() {
  const { t } = useTranslation(['platformSettings', 'common'])
  const toast = useToast()
  const [current, setCurrent] = useState<ExtensionCapturePlatformSettings | null>(null)
  const [duration, setDuration] = useState(1100)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    platformSettingsApi.extensionCapture().then(value => { setCurrent(value); setDuration(value.feedback_duration_ms) }).catch(reason => setError(reason.message))
  }, [])

  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const value = await platformSettingsApi.updateExtensionCapture({ feedback_duration_ms: duration })
      setCurrent(value); setDuration(value.feedback_duration_ms); toast.success(t('capture.saved'))
    } catch (reason) { setError((reason as Error).message) }
    finally { setBusy(false) }
  }

  if (!current && !error) return <div className="platform-settings-loading"><span className="action-spinner" />{t('common:status.loading')}</div>
  const minimum = current?.min_feedback_duration_ms || 500
  const maximum = current?.max_feedback_duration_ms || 3000
  const seconds = (duration / 1000).toFixed(duration % 1000 ? 1 : 0)
  return <form className="platform-settings-tab" onSubmit={save}>
    <section className="platform-settings-summary"><span><Icon name="record" size={22}/></span><div><strong>{t('capture.statusTitle')}</strong><p>{t('capture.statusHint')}</p></div><em className="active"><i />{t('capture.current', { value: seconds })}</em></section>
    {error && <div className="error">{error}</div>}
    <section className="platform-settings-card extension-capture-card">
      <header><div><h2>{t('capture.feedbackTitle')}</h2><p>{t('capture.feedbackHint')}</p></div><span className="platform-card-icon"><Icon name="clock" size={20}/></span></header>
      <div className="extension-capture-control">
        <label><span><strong>{t('capture.duration')}</strong><small>{t('capture.durationHint', { min: minimum, max: maximum })}</small></span><input type="number" min={minimum} max={maximum} step={100} value={duration} onChange={event => setDuration(Math.max(minimum, Math.min(maximum, Number(event.target.value) || minimum)))} /><em>ms</em></label>
        <input aria-label={t('capture.duration')} type="range" min={minimum} max={maximum} step={100} value={duration} onChange={event => setDuration(Number(event.target.value))} />
        <div className="extension-capture-preview"><span><i /></span><div><strong>{t('capture.previewTitle')}</strong><p>{t('capture.previewHint', { value: seconds })}</p></div><b>{seconds}s</b></div>
      </div>
      <div className="platform-settings-note"><Icon name="help"/><div><strong>{t('capture.runtimeTitle')}</strong><p>{t('capture.runtimeHint')}</p></div></div>
      <footer><span>{t('capture.footerHint')}</span><button className="primary icon-button" disabled={busy || duration < minimum || duration > maximum}><Icon name="check"/>{t(busy ? 'common:status.loading' : 'common:actions.save')}</button></footer>
    </section>
  </form>
}
