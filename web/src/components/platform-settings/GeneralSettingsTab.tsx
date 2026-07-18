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
  const [upgradeUrl, setUpgradeUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const previewUrl = /^https?:\/\/[^\s]+$/i.test(helpUrl.trim()) ? helpUrl.trim() : ''
  const previewUpgradeUrl = /^https?:\/\/[^\s]+$/i.test(upgradeUrl.trim()) ? upgradeUrl.trim() : ''

  useEffect(() => {
    platformSettingsApi.general().then(value => { setCurrent(value); setHelpUrl(value.help_url); setUpgradeUrl(value.upgrade_url) }).catch(reason => setError(reason.message))
  }, [])

  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const value = await platformSettingsApi.updateGeneral({ help_url: helpUrl, upgrade_url: upgradeUrl })
      setCurrent(value); setHelpUrl(value.help_url); setUpgradeUrl(value.upgrade_url)
      await refresh()
      toast.success(t('general.saved'))
    } catch (reason) {
      setError((reason as Error).message)
    } finally { setBusy(false) }
  }

  if (!current && !error) return <div className="platform-settings-loading"><span className="action-spinner" />{t('common:status.loading')}</div>
  const configured = !!(current?.help_url || current?.upgrade_url)
  return <form className="platform-settings-tab" onSubmit={save}>
    <section className="platform-settings-summary"><span><Icon name="settings" size={22}/></span><div><strong>{t('general.statusTitle')}</strong><p>{t(configured ? 'general.configured' : 'general.notConfigured')}</p></div><em className={configured ? 'active' : ''}><i />{t(configured ? 'status.ready' : 'status.inactive')}</em></section>
    {error && <div className="error">{error}</div>}
    <section className="platform-settings-card">
      <header><div><h2>{t('general.helpTitle')}</h2><p>{t('general.helpHint')}</p></div><span className="platform-card-icon"><Icon name="help" size={20}/></span></header>
      <div className="platform-settings-form platform-general-form"><label className="platform-settings-wide">{t('general.helpUrl')}<input type="url" maxLength={1000} value={helpUrl} onChange={event => setHelpUrl(event.target.value)} placeholder="https://docs.example.com"/><small>{t('general.helpUrlHint')}</small></label></div>
      <div className="platform-help-preview"><span><Icon name="help"/></span><div><strong>{t('general.previewTitle')}</strong><p>{t(previewUrl ? 'general.previewEnabled' : 'general.previewDisabled')}</p></div>{previewUrl && <a href={previewUrl} target="_blank" rel="noopener noreferrer"><Icon name="book"/>{t('general.openPreview')}</a>}</div>
    </section>
    <section className="platform-settings-card">
      <header><div><h2>{t('general.upgradeTitle')}</h2><p>{t('general.upgradeHint')}</p></div><span className="platform-card-icon"><Icon name="arrowUp" size={20}/></span></header>
      <div className="platform-settings-form platform-general-form"><label className="platform-settings-wide">{t('general.upgradeUrl')}<input type="url" maxLength={1000} value={upgradeUrl} onChange={event => setUpgradeUrl(event.target.value)} placeholder="https://billing.example.com/upgrade"/><small>{t('general.upgradeUrlHint')}</small></label></div>
      <div className="platform-help-preview platform-upgrade-preview"><span><Icon name="arrowUp"/></span><div><strong>{t('general.upgradePreviewTitle')}</strong><p>{t(previewUpgradeUrl ? 'general.upgradePreviewEnabled' : 'general.upgradePreviewDisabled')}</p></div>{previewUpgradeUrl && <a href={previewUpgradeUrl} target="_blank" rel="noopener noreferrer"><Icon name="arrowRight"/>{t('general.openUpgradePreview')}</a>}</div>
      <footer><span>{t('general.footerHint')}</span><button className="primary icon-button" disabled={busy}><Icon name="check"/>{t(busy ? 'common:status.loading' : 'common:actions.save')}</button></footer>
    </section>
  </form>
}
