import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import Icon from '../components/Icon'
import { formatDate, normalizeLocale } from '../i18n'
import type { ExtensionRelease } from '../types'
import '../styles/extension-releases.css'

const channels = ['stable', 'beta', 'dev'] as const

function bytes(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

export default function AdminExtensionReleases() {
  const { t, i18n } = useTranslation('admin')
  const locale = normalizeLocale(i18n.language)
  const [items, setItems] = useState<ExtensionRelease[]>([])
  const [channel, setChannel] = useState<(typeof channels)[number]>('stable')
  const [file, setFile] = useState<File | null>(null)
  const [version, setVersion] = useState('')
  const [minimum, setMinimum] = useState('0.0.0')
  const [notes, setNotes] = useState('')
  const [required, setRequired] = useState(false)
  const [publish, setPublish] = useState(true)
  const [selected, setSelected] = useState<ExtensionRelease | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = (selectAvailable = false) => api.extensionReleases().then(value => {
    setItems(value)
    if (selectAvailable && !value.some(item => item.channel === 'stable')) {
      const available = value.find(item => item.status === 'published')?.channel
      if (available) setChannel(available)
    }
  }).catch(value => setError((value as Error).message))
  useEffect(() => { void load(true) }, [])
  const latest = useMemo(() => Object.fromEntries(channels.map(key => [key, items.find(item => item.channel === key && item.status === 'published')])), [items]) as Record<(typeof channels)[number], ExtensionRelease | undefined>
  const visible = items.filter(item => item.channel === channel)

  async function upload(event: React.FormEvent) {
    event.preventDefault()
    if (!file || !version.trim()) return
    setBusy(true); setError('')
    const form = new FormData()
    form.set('package', file); form.set('channel', channel); form.set('version', version.trim())
    form.set('minimum_version', minimum.trim() || '0.0.0'); form.set('release_notes', notes)
    form.set('is_required', String(required)); form.set('publish', String(publish))
    try {
      await api.createExtensionRelease(form)
      setFile(null); setVersion(''); setNotes(''); setRequired(false)
      const input = document.getElementById('extension-package') as HTMLInputElement | null
      if (input) input.value = ''
      await load()
    } catch (value) { setError((value as Error).message) }
    finally { setBusy(false) }
  }

  async function changeStatus(item: ExtensionRelease, status: ExtensionRelease['status']) {
    setBusy(true); setError('')
    try { await api.updateExtensionRelease(item.id, { status }); await load(); setSelected(null) }
    catch (value) { setError((value as Error).message) }
    finally { setBusy(false) }
  }

  async function remove(item: ExtensionRelease) {
    if (!window.confirm(t('extensions.deleteConfirm', { version: item.version }))) return
    setBusy(true); setError('')
    try { await api.deleteExtensionRelease(item.id); await load(); if (selected?.id === item.id) setSelected(null) }
    catch (value) { setError((value as Error).message) }
    finally { setBusy(false) }
  }

  async function saveDetails(event: React.FormEvent) {
    event.preventDefault()
    if (!selected) return
    setBusy(true); setError('')
    try {
      await api.updateExtensionRelease(selected.id, {
        minimum_version: selected.minimum_version, is_required: selected.is_required, release_notes: selected.release_notes,
      })
      await load(); setSelected(null)
    } catch (value) { setError((value as Error).message) }
    finally { setBusy(false) }
  }

  return <main className="admin-content-page extension-release-page">
    <div className="admin-page-intro"><div><h1>{t('extensions.title')}</h1><p>{t('extensions.subtitle')}</p></div><span>{t('extensions.total', { count: items.length })}</span></div>
    <section className="extension-channel-grid">{channels.map(key => { const item = latest[key]; return <article key={key} className={channel === key ? 'active' : ''} onClick={() => setChannel(key)}><span><Icon name={key === 'stable' ? 'shield' : key === 'beta' ? 'animation' : 'device'} /></span><div><small>{t(`extensions.channels.${key}`)}</small><strong>{item ? `v${item.version}` : t('extensions.noRelease')}</strong><p>{item ? t('extensions.minimum', { version: item.minimum_version }) : t('extensions.noReleaseHint')}</p></div><em className={item?.is_required ? 'required' : ''}>{item?.is_required ? t('extensions.required') : t('extensions.optional')}</em></article> })}</section>
    {error && <div className="error">{error}</div>}
    <section className="extension-upload-card"><header><div><h2>{t('extensions.uploadTitle')}</h2><p>{t('extensions.uploadHint')}</p></div><Icon name="publish" /></header><form onSubmit={upload}>
      <label className="extension-file"><input id="extension-package" type="file" accept=".zip,application/zip" onChange={event => setFile(event.target.files?.[0] || null)} /><span><Icon name="folder" /><strong>{file?.name || t('extensions.choosePackage')}</strong><small>{file ? bytes(file.size) : t('extensions.packageHint')}</small></span></label>
      <div className="extension-release-fields"><label>{t('extensions.channel')}<select value={channel} onChange={event => setChannel(event.target.value as typeof channel)}>{channels.map(key => <option value={key} key={key}>{t(`extensions.channels.${key}`)}</option>)}</select></label><label>{t('extensions.version')}<input required pattern="[0-9]+(\.[0-9]+){1,3}" value={version} onChange={event => setVersion(event.target.value)} placeholder="1.2.2" /></label><label>{t('extensions.minimumVersion')}<input required pattern="[0-9]+(\.[0-9]+){1,3}" value={minimum} onChange={event => setMinimum(event.target.value)} /></label></div>
      <label>{t('extensions.releaseNotes')}<textarea rows={4} maxLength={10000} value={notes} onChange={event => setNotes(event.target.value)} placeholder={t('extensions.notesPlaceholder')} /></label>
      <div className="extension-release-options"><label><input type="checkbox" checked={required} onChange={event => setRequired(event.target.checked)} /><span><strong>{t('extensions.forceUpdate')}</strong><small>{t('extensions.forceUpdateHint')}</small></span></label><label><input type="checkbox" checked={publish} onChange={event => setPublish(event.target.checked)} /><span><strong>{t('extensions.publishNow')}</strong><small>{t('extensions.publishNowHint')}</small></span></label><button className="primary icon-button" disabled={busy || !file || !version.trim()}><Icon name="publish" />{t(busy ? 'common:status.loading' : 'extensions.upload')}</button></div>
    </form></section>
    <section className="extension-history-card"><header><div><h2>{t('extensions.history')}</h2><p>{t('extensions.historyHint', { channel: t(`extensions.channels.${channel}`) })}</p></div><nav>{channels.map(key => <button key={key} className={channel === key ? 'active' : ''} onClick={() => setChannel(key)}>{t(`extensions.channels.${key}`)}</button>)}</nav></header>
      <div className="extension-release-table"><table><thead><tr><th>{t('extensions.version')}</th><th>{t('extensions.status')}</th><th>{t('extensions.compatibility')}</th><th>{t('extensions.package')}</th><th>{t('extensions.publishedAt')}</th><th /></tr></thead><tbody>{visible.map(item => <tr key={item.id} onClick={() => setSelected({ ...item })}><td><strong>v{item.version}</strong><small>{item.created_by_name || '—'}</small></td><td><span className={`extension-status ${item.status}`}>{t(`extensions.statuses.${item.status}`)}</span>{item.is_required && <small className="required-copy">{t('extensions.required')}</small>}</td><td><strong>≥ {item.minimum_version}</strong><small>{item.release_notes || t('extensions.noNotes')}</small></td><td><strong>{bytes(item.size_bytes)}</strong><code title={item.sha256}>{item.sha256.slice(0, 12)}…</code></td><td><time>{formatDate(item.published_at || item.created_at, locale)}</time></td><td><div className="table-actions">{item.download_url && <a className="button icon-button" href={item.download_url} onClick={event => event.stopPropagation()}><Icon name="download" /></a>}<button onClick={event => { event.stopPropagation(); void changeStatus(item, item.status === 'published' ? 'retired' : 'published') }} disabled={busy}><Icon name={item.status === 'published' ? 'close' : 'publish'} /></button><button className="danger" onClick={event => { event.stopPropagation(); void remove(item) }} disabled={busy}><Icon name="delete" /></button></div></td></tr>)}</tbody></table>{!visible.length && <div className="admin-table-state"><Icon name="device" />{t('extensions.empty')}</div>}</div>
    </section>
    {selected && <div className="extension-release-drawer-layer" onMouseDown={() => setSelected(null)}><aside onMouseDown={event => event.stopPropagation()}><header><div><Icon name="device" /><span><strong>{t('extensions.editRelease', { version: selected.version })}</strong><small>{t(`extensions.channels.${selected.channel}`)} · {selected.sha256}</small></span></div><button onClick={() => setSelected(null)}><Icon name="close" /></button></header><form onSubmit={saveDetails}><label>{t('extensions.minimumVersion')}<input value={selected.minimum_version} pattern="[0-9]+(\.[0-9]+){1,3}" onChange={event => setSelected({ ...selected, minimum_version: event.target.value })} /></label><label>{t('extensions.releaseNotes')}<textarea rows={7} value={selected.release_notes} onChange={event => setSelected({ ...selected, release_notes: event.target.value })} /></label><label className="extension-required-edit"><input type="checkbox" checked={selected.is_required} onChange={event => setSelected({ ...selected, is_required: event.target.checked })} /><span><strong>{t('extensions.forceUpdate')}</strong><small>{t('extensions.forceUpdateHint')}</small></span></label><footer><button type="button" onClick={() => setSelected(null)}>{t('common:actions.cancel')}</button><button className="primary icon-button" disabled={busy}><Icon name="check" />{t('common:actions.save')}</button></footer></form></aside></div>}
  </main>
}
