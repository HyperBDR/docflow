import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import Icon from '../components/Icon'
import { useToast } from '../components/toast'
import type { AIPlatformSettings } from '../types'

const EMPTY: AIPlatformSettings = { enabled: false, chunk_size: 8, configured_models: 0, enabled_models: 0, effective: false, updated_at: '' }

export default function AdminAISettings() {
  const { t } = useTranslation(['admin', 'common'])
  const toast = useToast()
  const [value, setValue] = useState(EMPTY), [draft, setDraft] = useState({ enabled: false, chunk_size: 8 })
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState('')
  useEffect(() => { api.aiSettings().then(result => { setValue(result); setDraft({ enabled: result.enabled, chunk_size: result.chunk_size }) }).catch(result => setError(result.message)).finally(() => setLoading(false)) }, [])
  async function save(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError('')
    try { const result = await api.updateAISettings(draft); setValue(result); setDraft({ enabled: result.enabled, chunk_size: result.chunk_size }); toast.success(t('aiSettings.saved')) }
    catch (result) { setError((result as Error).message) } finally { setSaving(false) }
  }
  return <div className="admin-content-page"><div className="admin-page-intro"><div><h1>{t('aiSettings.title')}</h1><p>{t('aiSettings.subtitle')}</p></div><span className={`ai-effective ${value.effective ? 'active' : ''}`}><i />{t(value.effective ? 'aiSettings.effective' : 'aiSettings.inactive')}</span></div>
    {error && <div className="error">{error}</div>}
    <div className={`ai-settings-summary ${loading ? 'loading' : ''}`}><article><span><Icon name="database" /></span><div><small>{t('aiSettings.configured')}</small><strong>{value.configured_models}</strong></div></article><article><span><Icon name="check" /></span><div><small>{t('aiSettings.enabledModels')}</small><strong>{value.enabled_models}</strong></div></article><article><span><Icon name="ai" /></span><div><small>{t('aiSettings.runtime')}</small><strong>{t(value.enabled ? 'aiSettings.on' : 'aiSettings.off')}</strong></div></article></div>
    <form className="ai-global-settings" onSubmit={save}><section><header><span><Icon name="ai" /></span><div><h2>{t('aiSettings.switchTitle')}</h2><p>{t('aiSettings.switchHint')}</p></div></header><label className="platform-switch"><input type="checkbox" checked={draft.enabled} onChange={event => setDraft({ ...draft, enabled: event.target.checked })} /><span /><strong>{t(draft.enabled ? 'aiSettings.on' : 'aiSettings.off')}</strong></label>{draft.enabled && !value.enabled_models && <p className="ai-settings-warning"><Icon name="warning" />{t('aiSettings.noModel')}</p>}</section>
      <section><header><span><Icon name="list" /></span><div><h2>{t('aiSettings.chunkTitle')}</h2><p>{t('aiSettings.chunkHint')}</p></div></header><div className="chunk-size-control"><input type="range" min="1" max="12" value={draft.chunk_size} onChange={event => setDraft({ ...draft, chunk_size: Number(event.target.value) })} /><input type="number" min="1" max="12" value={draft.chunk_size} onChange={event => setDraft({ ...draft, chunk_size: Math.max(1, Math.min(12, Number(event.target.value))) })} /><span>{t('aiSettings.steps')}</span></div></section>
      <footer><button className="primary icon-button" disabled={saving || loading}><Icon name="check" />{saving ? t('saving') : t('common:actions.save')}</button></footer></form>
  </div>
}
