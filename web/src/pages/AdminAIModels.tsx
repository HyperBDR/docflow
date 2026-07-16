import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import Icon from '../components/Icon'
import { useToast } from '../components/toast'
import type { AIModelConfig, AIModelInput } from '../types'

const emptyModel: AIModelInput = { name: '', base_url: 'https://api.openai.com/v1', api_key: '', model: 'gpt-4.1-mini', enabled: true, is_default: false, vision_enabled: true, timeout_seconds: 120, temperature: .2, extra_options: {} }

export default function AdminAIModels() {
  const { t } = useTranslation(['admin', 'common'])
  const toast = useToast()
  const [items, setItems] = useState<AIModelConfig[]>([]), [editing, setEditing] = useState<AIModelConfig | null | undefined>(undefined)
  const [draft, setDraft] = useState<AIModelInput>(emptyModel), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [testing, setTesting] = useState('')
  const load = () => api.aiModels().then(setItems).catch(value => setError(value.message))
  useEffect(() => { void load() }, [])
  function open(item?: AIModelConfig) {
    setEditing(item || null); setError('')
    setDraft(item ? { name: item.name, base_url: item.base_url, api_key: '', model: item.model, enabled: item.enabled, is_default: item.is_default, vision_enabled: item.vision_enabled, timeout_seconds: item.timeout_seconds, temperature: item.temperature, extra_options: item.extra_options } : { ...emptyModel, is_default: !items.length })
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try { editing ? await api.updateAIModel(editing.id, draft) : await api.createAIModel(draft); setEditing(undefined); await load() }
    catch (value) { setError((value as Error).message) } finally { setBusy(false) }
  }
  async function remove(item: AIModelConfig) {
    if (!confirm(t('models.deleteConfirm', { name: item.name }))) return
    try { await api.deleteAIModel(item.id); await load() } catch (value) { setError((value as Error).message) }
  }
  async function toggle(item: AIModelConfig) {
    try { await api.updateAIModel(item.id, { enabled: !item.enabled }); await load() } catch (value) { setError((value as Error).message) }
  }
  async function makeDefault(item: AIModelConfig) {
    try { await api.updateAIModel(item.id, { is_default: true }); await load() } catch (value) { setError((value as Error).message) }
  }
  async function testConnection(item: AIModelConfig) {
    setTesting(item.id); setError('')
    try { const result = await api.testAIModel(item.id); toast.success(t('models.testSuccess', { value: result.latency_ms })) }
    catch (value) { setError((value as Error).message) } finally { setTesting('') }
  }
  return <div className="admin-content-page"><div className="admin-page-intro"><div><h1>{t('models.title')}</h1><p>{t('models.subtitle')}</p></div><button className="primary icon-button" onClick={() => open()}><Icon name="plus" />{t('models.add')}</button></div>
    {error && editing === undefined && <div className="error">{error}</div>}
    <section className="admin-list-card ai-model-list"><table><thead><tr><th>{t('models.columns.name')}</th><th>{t('models.columns.endpoint')}</th><th>{t('models.columns.model')}</th><th>{t('models.columns.capability')}</th><th>{t('models.columns.status')}</th><th /></tr></thead><tbody>{items.map(item => <tr key={item.id}><td><div className="ai-model-name"><span><Icon name="ai" /></span><div><strong>{item.name}</strong><small>{item.provider}</small></div>{item.is_default && <em>{t('models.default')}</em>}</div></td><td><code>{item.base_url}</code></td><td><strong>{item.model}</strong></td><td><span>{item.vision_enabled ? t('models.vision') : t('models.textOnly')}</span><small>{t('models.timeout', { value: item.timeout_seconds })}</small></td><td><button className={`model-toggle ${item.enabled ? 'active' : ''}`} onClick={() => toggle(item)} disabled={item.is_default}><i />{t(item.enabled ? 'models.enabled' : 'models.disabled')}</button></td><td><div className="table-actions"><button disabled={testing === item.id} onClick={() => testConnection(item)}>{testing === item.id ? <span className="action-spinner" /> : <Icon name="link" />}{t('models.test')}</button>{!item.is_default && <button onClick={() => makeDefault(item)}>{t('models.setDefault')}</button>}<button title={t('common:actions.edit')} onClick={() => open(item)}><Icon name="edit" /></button><button className="danger" title={t('common:actions.delete')} onClick={() => remove(item)}><Icon name="delete" /></button></div></td></tr>)}</tbody></table>{!items.length && <div className="admin-table-empty"><Icon name="ai" size={30} /><strong>{t('models.empty')}</strong><p>{t('models.emptyHint')}</p></div>}</section>
    {editing !== undefined && <div className="admin-modal-layer" onMouseDown={() => setEditing(undefined)}><form className="ai-model-dialog" onSubmit={save} onMouseDown={event => event.stopPropagation()}><header><div><h2>{t(editing ? 'models.edit' : 'models.add')}</h2><p>{t('models.formHint')}</p></div><button type="button" onClick={() => setEditing(undefined)}>×</button></header><div className="ai-model-form">
      <label>{t('models.fields.name')}<input required value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
      <label>{t('models.fields.model')}<input required value={draft.model} onChange={event => setDraft({ ...draft, model: event.target.value })} /></label>
      <label className="wide">{t('models.fields.baseUrl')}<input required type="url" value={draft.base_url} onChange={event => setDraft({ ...draft, base_url: event.target.value })} /></label>
      <label className="wide">{t('models.fields.apiKey')}<input type="password" autoComplete="new-password" value={draft.api_key || ''} placeholder={editing?.api_key_configured ? t('models.keyRetained') : ''} onChange={event => setDraft({ ...draft, api_key: event.target.value })} /><small>{t('models.keyHint')}</small></label>
      <label>{t('models.fields.timeout')}<input type="number" min="5" max="600" value={draft.timeout_seconds} onChange={event => setDraft({ ...draft, timeout_seconds: Number(event.target.value) })} /></label>
      <label>{t('models.fields.temperature')}<input type="number" min="0" max="2" step=".1" value={draft.temperature} onChange={event => setDraft({ ...draft, temperature: Number(event.target.value) })} /></label>
      <label className="check"><input type="checkbox" checked={draft.vision_enabled} onChange={event => setDraft({ ...draft, vision_enabled: event.target.checked })} />{t('models.fields.vision')}</label>
      <label className="check"><input type="checkbox" disabled={!!editing?.is_default} checked={draft.enabled} onChange={event => setDraft({ ...draft, enabled: event.target.checked })} />{t('models.fields.enabled')}</label>
      <label className="check wide"><input type="checkbox" disabled={!!editing?.is_default} checked={draft.is_default} onChange={event => setDraft({ ...draft, is_default: event.target.checked })} />{t('models.fields.default')}</label>
      {error && <div className="error wide">{error}</div>}
    </div><footer><button type="button" onClick={() => setEditing(undefined)}>{t('common:actions.cancel')}</button><button className="primary" disabled={busy}>{busy ? t('saving') : t('common:actions.save')}</button></footer></form></div>}
  </div>
}
