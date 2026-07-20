import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { api } from '../api'
import Icon from '../components/Icon'
import { useToast } from '../components/toast'
import type { AIPlatformSettings } from '../types'
import '../styles/ai-settings.css'

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
  const dirty = draft.enabled !== value.enabled || draft.chunk_size !== value.chunk_size
  const updateChunkSize = (next: number) => setDraft({ ...draft, chunk_size: Math.max(1, Math.min(12, Number.isFinite(next) ? next : 1)) })
  return <div className="admin-content-page ai-settings-page"><div className="admin-page-intro"><div><h1>{t('aiSettings.title')}</h1><p>{t('aiSettings.subtitle')}</p></div><Link className="button icon-button" to="/admin/ai/models"><Icon name="settings" />{t('aiSettings.manageModels')}</Link></div>
    {error && <div className="error">{error}</div>}
    <section className={`ai-settings-overview ${loading ? 'loading' : ''}`}>
      <article><span><Icon name="database" /></span><div><small>{t('aiSettings.configured')}</small><strong>{value.configured_models}</strong><p>{t('aiSettings.configuredHint')}</p></div></article>
      <article><span className="success"><Icon name="check" /></span><div><small>{t('aiSettings.enabledModels')}</small><strong>{value.enabled_models}</strong><p>{t('aiSettings.enabledHint')}</p></div></article>
      <article className={value.effective ? 'active' : ''}><span><Icon name="ai" /></span><div><small>{t('aiSettings.runtime')}</small><strong>{t(value.effective ? 'aiSettings.effective' : 'aiSettings.inactive')}</strong><p>{t(value.effective ? 'aiSettings.runtimeReadyHint' : 'aiSettings.runtimeInactiveHint')}</p></div><em><i />{t(value.effective ? 'aiSettings.on' : 'aiSettings.off')}</em></article>
    </section>
    <form className="ai-settings-policy" onSubmit={save}>
      <header><div className="ai-policy-heading"><span><Icon name="settings" size={20} /></span><div><h2>{t('aiSettings.policyTitle')}</h2><p>{t('aiSettings.policyHint')}</p></div></div><span className={`ai-policy-state ${value.effective ? 'active' : ''}`}><i />{t(value.effective ? 'aiSettings.effective' : 'aiSettings.inactive')}</span></header>
      <div className="ai-policy-grid">
        <article className="ai-policy-option"><header><span><Icon name="ai" /></span><div><strong>{t('aiSettings.switchTitle')}</strong><small>{t('aiSettings.switchHint')}</small></div></header><div className="ai-policy-switch-control"><label className="platform-switch ai-policy-switch"><input type="checkbox" disabled={loading} checked={draft.enabled} onChange={event => setDraft({ ...draft, enabled: event.target.checked })} /><span /><strong>{t(draft.enabled ? 'aiSettings.on' : 'aiSettings.off')}</strong></label><small>{t(draft.enabled ? 'aiSettings.switchOnHint' : 'aiSettings.switchOffHint')}</small></div>{draft.enabled && !value.enabled_models && <p className="ai-policy-warning"><Icon name="warning" />{t('aiSettings.noModel')}</p>}</article>
        <article className="ai-policy-option"><header><span><Icon name="list" /></span><div><strong>{t('aiSettings.chunkTitle')}</strong><small>{t('aiSettings.chunkHint')}</small></div></header><div className="ai-chunk-editor"><label className="ai-chunk-number"><input aria-label={t('aiSettings.chunkTitle')} disabled={loading} type="number" min="1" max="12" value={draft.chunk_size} onChange={event => updateChunkSize(Number(event.target.value))} /><span>{t('aiSettings.steps')}</span></label><input className="ai-chunk-range" aria-label={t('aiSettings.chunkTitle')} disabled={loading} type="range" min="1" max="12" step="1" value={draft.chunk_size} onChange={event => updateChunkSize(Number(event.target.value))} /><div className="ai-chunk-scale"><span>1</span><b>{draft.chunk_size}</b><span>12</span></div></div></article>
      </div>
      <footer><span className="ai-policy-footer-note"><Icon name="clock" />{t('aiSettings.saveHint')}</span><div><button type="button" disabled={saving || loading || !dirty} onClick={() => setDraft({ enabled: value.enabled, chunk_size: value.chunk_size })}>{t('common:actions.cancel')}</button><button className="primary icon-button" disabled={saving || loading || !dirty}>{saving ? <span className="action-spinner" /> : <Icon name="check" />}{saving ? t('saving') : t('common:actions.save')}</button></div></footer>
    </form>
  </div>
}
