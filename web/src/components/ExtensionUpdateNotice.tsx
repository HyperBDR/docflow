import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import { detectBrowserExtension } from '../extensionBridge'
import type { ExtensionReleaseCheck } from '../types'
import Icon from './Icon'

const DISMISS_KEY = 'docflow.extensionUpdateDismissed'

export default function ExtensionUpdateNotice() {
  const { t } = useTranslation('common')
  const [update, setUpdate] = useState<ExtensionReleaseCheck | null>(null)
  useEffect(() => {
    let cancelled = false
    detectBrowserExtension().then(async identity => {
      const embedded = identity.update as ExtensionReleaseCheck | null | undefined
      let value = embedded
      if (!value && identity.channel && identity.version) value = await api.extensionReleaseCheck(String(identity.channel), String(identity.version))
      // Releases before the update protocol did not report identity/channel.
      // Prefer Stable, but probe the other channels so existing offline Dev or
      // Beta installs can bootstrap into the managed update flow once.
      if (!value) {
        const candidates = await Promise.all(['stable', 'beta', 'dev'].map(channel => api.extensionReleaseCheck(channel, '0.0.0').catch(() => null)))
        value = candidates.find(candidate => candidate?.update_available) || undefined
      }
      if (!value) return
      if (!cancelled && value.update_available && (value.required || localStorage.getItem(DISMISS_KEY) !== value.latest_version)) setUpdate(value)
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [])
  if (!update) return null
  return <aside className={`extension-update-notice ${update.required ? 'required' : ''}`} role={update.required ? 'alert' : 'status'}>
    <span><Icon name={update.required ? 'warning' : 'arrowUp'} /></span>
    <div><strong>{t(update.required ? 'extensionUpdate.requiredTitle' : 'extensionUpdate.title')}</strong><p>{t('extensionUpdate.versions', { current: update.current_version, latest: update.latest_version })}</p>{update.release_notes && <small>{update.release_notes}</small>}<em>{t('extensionUpdate.installHint')}</em></div>
    <a className="primary button icon-button" href={update.download_url || '#'}><Icon name="download" />{t('extensionUpdate.download')}</a>
    {!update.required && <button className="extension-update-dismiss" title={t('actions.close')} onClick={() => { localStorage.setItem(DISMISS_KEY, update.latest_version || ''); setUpdate(null) }}><Icon name="close" /></button>}
  </aside>
}
