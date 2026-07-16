import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { API_URL, api } from '../api'
import Icon from '../components/Icon'
import { useToast } from '../components/toast'
import { formatDate, normalizeLocale } from '../i18n'
import type { StorageConfig, StorageConfigInput, StorageObject } from '../types'

const localDefault: StorageConfigInput = { name: '', kind: 'local', enabled: true, is_default: false, local_path: '/storage-data/docflow', endpoint_url: '', region: '', bucket: '', prefix: '', force_path_style: false, direct_download: false, public_base_url: '', access_key: '', secret_key: '' }
const s3Default: StorageConfigInput = { ...localDefault, kind: 's3', local_path: '', endpoint_url: '', region: 'us-east-1', bucket: '', prefix: 'docflow', direct_download: true }

function bytes(value: number) {
  if (value < 0) return '—'
  if (!value) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']; const index = Math.min(4, Math.floor(Math.log(value) / Math.log(1024)))
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value / 1024 ** index)} ${units[index]}`
}

export default function AdminStorage() {
  const { t, i18n } = useTranslation(['admin', 'common']); const locale = normalizeLocale(i18n.language)
  const toast = useToast()
  const [items, setItems] = useState<StorageConfig[]>([]), [editing, setEditing] = useState<StorageConfig | null | undefined>(undefined)
  const [draft, setDraft] = useState<StorageConfigInput>(localDefault), [busy, setBusy] = useState(false), [testing, setTesting] = useState('')
  const [selected, setSelected] = useState<StorageConfig | null>(null), [objects, setObjects] = useState<StorageObject[]>([]), [prefix, setPrefix] = useState(''), [browserBusy, setBrowserBusy] = useState(false)
  const [error, setError] = useState('')
  const load = async () => { const value = await api.storageConfigs(); setItems(value); setSelected(current => current ? value.find(item => item.id === current.id) || null : current) }
  useEffect(() => { load().catch(value => setError(value.message)) }, [])
  async function browse(target: StorageConfig, nextPrefix = '') {
    setSelected(target); setPrefix(nextPrefix); setBrowserBusy(true); setError('')
    try { setObjects(await api.storageObjects(target.id, nextPrefix)) } catch (value) { setError((value as Error).message) } finally { setBrowserBusy(false) }
  }
  function open(item?: StorageConfig, kind: 'local' | 's3' = 'local') {
    setEditing(item || null); setError('')
    if (!item) { setDraft({ ...(kind === 'local' ? localDefault : s3Default), is_default: !items.length }); return }
    setDraft({ name: item.name, kind: item.kind, enabled: item.enabled, is_default: item.is_default, local_path: item.local_path, endpoint_url: item.endpoint_url, region: item.region, bucket: item.bucket, prefix: item.prefix, force_path_style: item.force_path_style, direct_download: item.direct_download, public_base_url: item.public_base_url, access_key: '', secret_key: '' })
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try { editing ? await api.updateStorageConfig(editing.id, draft) : await api.createStorageConfig(draft); setEditing(undefined); await load(); toast.success(t('storage.saved')) }
    catch (value) { setError((value as Error).message) } finally { setBusy(false) }
  }
  async function test(target: StorageConfig) {
    setTesting(target.id); setError('')
    try { const result = await api.testStorageConfig(target.id); const stats = await api.storageStats(target.id); setItems(current => current.map(item => item.id === target.id ? { ...item, ...stats } : item)); toast.success(t('storage.testSuccess', { value: result.latency_ms })) }
    catch (value) { setError((value as Error).message) } finally { setTesting('') }
  }
  async function patch(target: StorageConfig, values: Partial<StorageConfigInput>) {
    try { await api.updateStorageConfig(target.id, values); await load() } catch (value) { setError((value as Error).message) }
  }
  async function remove(target: StorageConfig) {
    if (!confirm(t('storage.deleteConfirm', { name: target.name }))) return
    try { await api.deleteStorageConfig(target.id); if (selected?.id === target.id) setSelected(null); await load() } catch (value) { setError((value as Error).message) }
  }
  async function removeObject(object: StorageObject) {
    if (!selected || !confirm(t('storage.browser.deleteConfirm', { name: object.name }))) return
    try { await api.deleteStorageObject(selected.id, object.key); await browse(selected, prefix) } catch (value) { setError((value as Error).message) }
  }
  const crumbs = useMemo(() => prefix ? prefix.split('/').map((name, index, all) => ({ name, key: all.slice(0, index + 1).join('/') })) : [], [prefix])
  return <div className="admin-content-page storage-page"><div className="admin-page-intro"><div><h1>{t('storage.title')}</h1><p>{t('storage.subtitle')}</p></div><div className="storage-add-actions"><button className="icon-button" onClick={() => open(undefined, 'local')}><Icon name="database" />{t('storage.addLocal')}</button><button className="primary icon-button" onClick={() => open(undefined, 's3')}><Icon name="globe" />{t('storage.addObject')}</button></div></div>
    {error && editing === undefined && <div className="error">{error}</div>}
    <div className="storage-deploy-note"><Icon name="warning" /><div><strong>{t('storage.deployTitle')}</strong><p>{t('storage.deployHint')}</p><code>DOCFLOW_HOST_STORAGE_DIR=/srv/docflow-data → /storage-data</code></div></div>
    <section className="admin-list-card storage-list"><table><thead><tr><th>{t('storage.columns.name')}</th><th>{t('storage.columns.location')}</th><th>{t('storage.columns.namespace')}</th><th>{t('storage.columns.usage')}</th><th>{t('storage.columns.status')}</th><th /></tr></thead><tbody>{items.map(item => <tr key={item.id}><td><div className="storage-name"><span className={item.kind}><Icon name={item.kind === 'local' ? 'database' : 'globe'} /></span><div><strong>{item.name}</strong><small>{t(`storage.kinds.${item.kind}`)}</small></div>{item.is_default && <em>{t('storage.default')}</em>}</div></td><td><code>{item.kind === 'local' ? item.local_path : item.endpoint_url || 'Amazon S3'}</code>{item.kind === 's3' && <small>{item.bucket}</small>}</td><td><code>{item.prefix || '/'}</code><small>{item.kind === 's3' && item.direct_download ? t('storage.direct') : t('storage.proxy')}</small></td><td><strong>{bytes(item.total_bytes)}</strong><small>{item.object_count < 0 ? t('storage.usagePending') : t('storage.objects', { count: item.object_count })}</small></td><td><button className={`model-toggle ${item.enabled ? 'active' : ''}`} disabled={item.is_default} onClick={() => patch(item, { enabled: !item.enabled })}><i />{t(item.enabled ? 'storage.enabled' : 'storage.disabled')}</button></td><td><div className="table-actions"><button onClick={() => browse(item)}><Icon name="folder" />{t('storage.browse')}</button><button disabled={testing === item.id} onClick={() => test(item)}>{testing === item.id ? <span className="action-spinner" /> : <Icon name="link" />}{t('storage.test')}</button>{!item.is_default && <button onClick={() => patch(item, { is_default: true })}>{t('storage.setDefault')}</button>}<button onClick={() => open(item)}><Icon name="edit" /></button><button className="danger" onClick={() => remove(item)}><Icon name="delete" /></button></div></td></tr>)}</tbody></table></section>
    {selected && <section className="admin-list-card storage-browser"><header><div><span><Icon name={selected.kind === 'local' ? 'database' : 'globe'} /></span><div><strong>{selected.name}</strong><nav><button onClick={() => browse(selected, '')}>/</button>{crumbs.map(item => <button key={item.key} onClick={() => browse(selected, item.key)}>{item.name} /</button>)}</nav></div></div><button onClick={() => setSelected(null)}>×</button></header><div className="storage-object-list"><div className="storage-object-head"><span>{t('storage.browser.name')}</span><span>{t('storage.browser.size')}</span><span>{t('storage.browser.updated')}</span><span /></div>{objects.map(object => <div key={object.key}><span><Icon name={object.is_directory ? 'folder' : 'text'} /><button onClick={() => object.is_directory && browse(selected, object.key)}>{object.name}</button></span><span>{object.is_directory ? '—' : bytes(object.size)}</span><span>{object.updated_at ? formatDate(object.updated_at, locale) : '—'}</span><span>{!object.is_directory && <><a className="button" href={`${API_URL}/api/admin/storage/configs/${selected.id}/objects/download?${new URLSearchParams({ key: object.key })}`}><Icon name="download" /></a><button className="danger" onClick={() => removeObject(object)}><Icon name="delete" /></button></>}</span></div>)}{browserBusy && <div className="admin-table-state"><span className="action-spinner" />{t('loading')}</div>}{!browserBusy && !objects.length && <div className="storage-browser-empty">{t('storage.browser.empty')}</div>}</div></section>}
    {editing !== undefined && <div className="admin-modal-layer" onMouseDown={() => setEditing(undefined)}><form className="storage-dialog" onSubmit={save} onMouseDown={event => event.stopPropagation()}><header><div><h2>{t(editing ? 'storage.edit' : draft.kind === 'local' ? 'storage.addLocal' : 'storage.addObject')}</h2><p>{t(`storage.formHint.${draft.kind}`)}</p></div><button type="button" onClick={() => setEditing(undefined)}>×</button></header><div className="storage-form">
      <label>{t('storage.fields.name')}<input required value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
      {draft.kind === 'local' ? <label className="wide">{t('storage.fields.localPath')}<input required value={draft.local_path} onChange={event => setDraft({ ...draft, local_path: event.target.value })} /><small>{t('storage.fields.localPathHint')}</small></label> : <>
        <label className="wide">{t('storage.fields.endpoint')}<input type="url" value={draft.endpoint_url} placeholder="https://s3.example.com" onChange={event => setDraft({ ...draft, endpoint_url: event.target.value })} /><small>{t('storage.fields.endpointHint')}</small></label>
        <label>{t('storage.fields.region')}<input value={draft.region} onChange={event => setDraft({ ...draft, region: event.target.value })} /></label><label>{t('storage.fields.bucket')}<input required value={draft.bucket} onChange={event => setDraft({ ...draft, bucket: event.target.value })} /></label>
        <label>{t('storage.fields.accessKey')}<input autoComplete="new-password" value={draft.access_key || ''} placeholder={editing?.credentials_configured ? t('storage.credentialsRetained') : ''} onChange={event => setDraft({ ...draft, access_key: event.target.value })} /></label><label>{t('storage.fields.secretKey')}<input type="password" autoComplete="new-password" value={draft.secret_key || ''} placeholder={editing?.credentials_configured ? t('storage.credentialsRetained') : ''} onChange={event => setDraft({ ...draft, secret_key: event.target.value })} /></label>
        <label className="wide">{t('storage.fields.publicBase')}<input type="url" value={draft.public_base_url} placeholder="https://cdn.example.com" onChange={event => setDraft({ ...draft, public_base_url: event.target.value })} /><small>{t('storage.fields.publicBaseHint')}</small></label>
      </>}
      <label>{t('storage.fields.prefix')}<input value={draft.prefix} placeholder="docflow" onChange={event => setDraft({ ...draft, prefix: event.target.value })} /></label>
      {draft.kind === 's3' && <label className="check"><input type="checkbox" checked={draft.force_path_style} onChange={event => setDraft({ ...draft, force_path_style: event.target.checked })} />{t('storage.fields.pathStyle')}</label>}
      {draft.kind === 's3' && <label className="check"><input type="checkbox" checked={draft.direct_download} onChange={event => setDraft({ ...draft, direct_download: event.target.checked })} />{t('storage.fields.direct')}</label>}
      <label className="check"><input type="checkbox" disabled={!!editing?.is_default} checked={draft.enabled} onChange={event => setDraft({ ...draft, enabled: event.target.checked })} />{t('storage.fields.enabled')}</label>
      <label className="check wide"><input type="checkbox" disabled={!!editing?.is_default} checked={draft.is_default} onChange={event => setDraft({ ...draft, is_default: event.target.checked })} />{t('storage.fields.default')}</label>
      {error && <div className="error wide">{error}</div>}
    </div><footer><button type="button" onClick={() => setEditing(undefined)}>{t('common:actions.cancel')}</button><button className="primary" disabled={busy}>{busy ? t('saving') : t('common:actions.save')}</button></footer></form></div>}
  </div>
}
