import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { platformSettingsApi } from '../../platform-settings/api'
import type { GeneralPlatformSettings } from '../../platform-settings/types'
import { usePlatformConfig } from '../platform-config/PlatformConfigContext'
import { useToast } from '../toast'
import Icon from '../Icon'

export default function GeneralSettingsTab() {
  const { t } = useTranslation(['platformSettings', 'common'])
  const toast = useToast()
  const { refresh } = usePlatformConfig()
  const [current, setCurrent] = useState<GeneralPlatformSettings | null>(null)
  const [helpUrl, setHelpUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const previewUrl = /^https?:\/\/[^\s]+$/i.test(helpUrl.trim()) ? helpUrl.trim() : ''

  useEffect(() => {
    platformSettingsApi.general().then(value => { setCurrent(value); setHelpUrl(value.help_url) }).catch(reason => setError(reason.message))
  }, [])

  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const value = await platformSettingsApi.updateGeneral({ help_url: helpUrl })
      setCurrent(value); setHelpUrl(value.help_url)
      await refresh()
      toast.success(t('general.saved'))
    } catch (reason) {
      setError((reason as Error).message)
    } finally { setBusy(false) }
  }

  if (!current && !error) return <div className="platform-settings-loading"><span className="action-spinner" />{t('common:status.loading')}</div>
  return <div className="platform-settings-tab">
    <section className="platform-settings-summary"><span><Icon name="settings" size={22}/></span><div><strong>{t('general.statusTitle')}</strong><p>{t(current?.help_url ? 'general.configured' : 'general.notConfigured')}</p></div><em className={current?.help_url ? 'active' : ''}><i />{t(current?.help_url ? 'status.ready' : 'status.inactive')}</em></section>
    {error && <div className="error">{error}</div>}
    <form className="platform-settings-card" onSubmit={save}>
      <header><div><h2>{t('general.helpTitle')}</h2><p>{t('general.helpHint')}</p></div><span className="platform-card-icon"><Icon name="help" size={20}/></span></header>
      <div className="platform-settings-form platform-general-form"><label className="platform-settings-wide">{t('general.helpUrl')}<input type="url" maxLength={1000} value={helpUrl} onChange={event => setHelpUrl(event.target.value)} placeholder="https://docs.example.com"/><small>{t('general.helpUrlHint')}</small></label></div>
      <div className="platform-help-preview"><span><Icon name="help"/></span><div><strong>{t('general.previewTitle')}</strong><p>{t(previewUrl ? 'general.previewEnabled' : 'general.previewDisabled')}</p></div>{previewUrl && <a href={previewUrl} target="_blank" rel="noopener noreferrer"><Icon name="book"/>{t('general.openPreview')}</a>}</div>
      <footer><span>{t('general.footerHint')}</span><button className="primary icon-button" disabled={busy}><Icon name="check"/>{t(busy ? 'common:status.loading' : 'common:actions.save')}</button></footer>
    </form>
  </div>
}
