import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import { copyText } from '../clipboard'
import { formatDate } from '../i18n'
import type { Demo, ShareLink } from '../types'
import type { WorkspaceCapabilities } from '../workspace/types'
import Icon from './Icon'
import QuotaGuard from './quota/QuotaGuard'
import { useToast } from './toast'
import { quotaAllowed, quotaGuardTitle } from '../quota/guards'

function datetimeLocal(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export default function ShareLinkManager({ demo, capabilities, onQuotaChanged }: { demo: Demo; capabilities: WorkspaceCapabilities | null; onQuotaChanged: () => void }) {
  const { t, i18n } = useTranslation(['editor', 'common'])
  const toast = useToast()
  const [items, setItems] = useState<ShareLink[]>([])
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [expires, setExpires] = useState('')
  const [password, setPassword] = useState('')
  const [editingId, setEditingId] = useState('')
  const [editName, setEditName] = useState('')
  const [editExpires, setEditExpires] = useState('')
  const [editPassword, setEditPassword] = useState('')
  const [sessionPasswords, setSessionPasswords] = useState<Record<string, string>>({})
  const [revealedId, setRevealedId] = useState('')
  const [action, setAction] = useState('')
  const [error, setError] = useState('')
  const busy = Boolean(action)
  const canCreate = quotaAllowed(capabilities, 'create_share')
  const blockedTitle = quotaGuardTitle(capabilities, 'create_share', t, i18n.language)
  const showError = (value: unknown) => {
    const message = value instanceof Error ? value.message : t('common:errors.operationFailed')
    setError(message)
    toast.error(message, { dedupeKey: 'share-manager-error' })
  }
  const load = () => api.shareLinks(demo.id).then(setItems).catch(showError)

  useEffect(() => { if (demo.share_url) void load(); else setItems([]) }, [demo.id, demo.share_url])

  function openSettings(item: ShareLink, reveal = false) {
    setEditingId(item.id)
    setEditName(item.name)
    setEditExpires(datetimeLocal(item.expires_at))
    setEditPassword('')
    setRevealedId(reveal && sessionPasswords[item.id] ? item.id : '')
    setError('')
  }

  async function create(event: FormEvent) {
    event.preventDefault()
    if (!canCreate) { setError(blockedTitle); toast.warning(blockedTitle); return }
    setAction('create'); setError('')
    try {
      const created = await api.createShareLink(demo.id, { name, expires_at: expires ? new Date(expires).toISOString() : null, password })
      if (password) setSessionPasswords(current => ({ ...current, [created.id]: password }))
      setName(''); setExpires(''); setPassword(''); setCreating(false)
      setEditingId(created.id); setEditName(created.name); setEditExpires(datetimeLocal(created.expires_at)); setEditPassword(''); setRevealedId(password ? created.id : '')
      await load(); onQuotaChanged(); toast.success(t('shareManager.linkCreated'))
    } catch (value) { showError(value) } finally { setAction('') }
  }

  async function save(event: FormEvent, item: ShareLink) {
    event.preventDefault(); setAction(`save:${item.id}`); setError('')
    try {
      const values: { name: string; expires_at: string | null; password?: string } = { name: editName, expires_at: editExpires ? new Date(editExpires).toISOString() : null }
      if (editPassword) values.password = editPassword
      await api.updateShareLink(demo.id, item.id, values)
      if (editPassword) {
        setSessionPasswords(current => ({ ...current, [item.id]: editPassword }))
        setRevealedId(item.id)
      }
      const passwordChanged = Boolean(editPassword)
      setEditPassword(''); await load(); toast.success(t(passwordChanged ? 'shareManager.passwordReset' : 'shareManager.settingsSaved'))
    } catch (value) { showError(value) } finally { setAction('') }
  }

  async function removePassword(item: ShareLink) {
    if (!window.confirm(t('shareManager.removePasswordConfirm'))) return
    setAction(`remove-password:${item.id}`); setError('')
    try {
      await api.updateShareLink(demo.id, item.id, { password: '' })
      setSessionPasswords(current => { const next = { ...current }; delete next[item.id]; return next })
      setRevealedId(''); setEditPassword(''); await load(); toast.success(t('shareManager.passwordRemoved'))
    } catch (value) { showError(value) } finally { setAction('') }
  }

  async function toggle(item: ShareLink) {
    if (item.revoked && !canCreate) { setError(blockedTitle); toast.warning(blockedTitle); return }
    setAction(`toggle:${item.id}`); setError('')
    try { await api.updateShareLink(demo.id, item.id, { revoked: !item.revoked }); await load(); onQuotaChanged(); toast.success(t(item.revoked ? 'shareManager.restoredDone' : 'shareManager.revokedDone')) }
    catch (value) { showError(value) } finally { setAction('') }
  }

  async function copyLink(item: ShareLink) {
    setAction(`copy:${item.id}`); setError('')
    try { await copyText(item.url); toast.success(t('shareManager.linkCopied')) }
    catch (value) { showError(value) } finally { setAction('') }
  }

  async function copyPassword(item: ShareLink) {
    const value = sessionPasswords[item.id]
    if (!value) return
    setAction(`copy-password:${item.id}`); setError('')
    try { await copyText(value); toast.success(t('shareManager.passwordCopied')) }
    catch (reason) { showError(reason) } finally { setAction('') }
  }

  if (!demo.share_url) return null
  return <div className="share-manager">
    <header><span>{t('shareManager.links', { count: items.length })}</span><QuotaGuard message={!creating && !canCreate ? blockedTitle : ''}><button className="icon-button" disabled={!creating && !canCreate} onClick={() => setCreating(value => !value)}><Icon name={creating ? 'close' : 'plus'} />{t(creating ? 'shareManager.cancel' : 'shareManager.create')}</button></QuotaGuard></header>
    {creating && <form onSubmit={create}><label>{t('shareManager.name')}<input value={name} onChange={event => setName(event.target.value)} placeholder={t('shareManager.namePlaceholder')} /></label><label>{t('shareManager.expires')}<input type="datetime-local" value={expires} onChange={event => setExpires(event.target.value)} /></label><label>{t('shareManager.password')}<input type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder={t('shareManager.passwordHint')} /></label><QuotaGuard fill message={!canCreate ? blockedTitle : ''}><button className="primary" disabled={busy || !canCreate}>{action === 'create' ? <><span className="action-spinner" />{t('shareManager.creating')}</> : t('shareManager.createLink')}</button></QuotaGuard></form>}
    {error && <small className="error">{error}</small>}
    <div className="share-manager-list">{items.map(item => <div className="share-manager-entry" key={item.id}>
      <article className={item.revoked || item.expired ? 'inactive' : ''}>
        {item.password_protected ? <button className="share-security-button" title={t('shareManager.passwordSettings')} onClick={() => openSettings(item, true)}><Icon name="lock" /></button> : <span><Icon name="link" /></span>}
        <div><strong>{item.name || t('shareManager.unnamed')}</strong><small>{item.expires_at ? t('shareManager.expiresAt', { date: formatDate(item.expires_at) }) : t('shareManager.neverExpires')} · {t('shareManager.visits', { count: item.access_count })}</small></div>
        <button disabled={busy} title={t('common:actions.copy')} onClick={() => copyLink(item)}>{action === `copy:${item.id}` ? <span className="action-spinner" /> : <Icon name="copy" />}</button>
        <button title={t('shareManager.settings')} onClick={() => openSettings(item)}><Icon name="settings" /></button>
        <button disabled={busy || (item.revoked && !canCreate)} title={item.revoked && !canCreate ? blockedTitle : t(item.revoked ? 'shareManager.restore' : 'shareManager.revoke')} onClick={() => toggle(item)}>{action === `toggle:${item.id}` ? <span className="action-spinner" /> : <Icon name={item.revoked ? 'link' : 'unlink'} />}</button>
      </article>
      {editingId === item.id && <form className="share-manager-edit" onSubmit={event => save(event, item)}><header><div><strong>{t('shareManager.configuration')}</strong><small>{item.password_protected ? t('shareManager.passwordProtected') : t('shareManager.passwordNotSet')}</small></div><button type="button" aria-label={t('common:actions.close')} onClick={() => setEditingId('')}><Icon name="close" /></button></header>
        <label>{t('shareManager.name')}<input value={editName} onChange={event => setEditName(event.target.value)} placeholder={t('shareManager.namePlaceholder')} /></label>
        <label>{t('shareManager.expires')}<input type="datetime-local" value={editExpires} onChange={event => setEditExpires(event.target.value)} /></label>
        {item.password_protected && sessionPasswords[item.id] ? <div className="share-password-secret"><span><Icon name="lock" /><small>{t('shareManager.sessionPasswordHint')}</small></span><code>{revealedId === item.id ? sessionPasswords[item.id] : '••••••••'}</code><button type="button" title={t(revealedId === item.id ? 'shareManager.hidePassword' : 'shareManager.showPassword')} onClick={() => setRevealedId(value => value === item.id ? '' : item.id)}><Icon name={revealedId === item.id ? 'eyeOff' : 'eye'} /></button><button type="button" disabled={busy} title={t('shareManager.copyPassword')} onClick={() => copyPassword(item)}>{action === `copy-password:${item.id}` ? <span className="action-spinner" /> : <Icon name="copy" />}</button></div> : item.password_protected && <p className="share-password-note"><Icon name="lock" />{t('shareManager.passwordUnavailable')}</p>}
        <label>{t(item.password_protected ? 'shareManager.newPassword' : 'shareManager.password')}<input type="password" value={editPassword} onChange={event => setEditPassword(event.target.value)} placeholder={t(item.password_protected ? 'shareManager.newPasswordHint' : 'shareManager.passwordHint')} /></label>
        <footer>{item.password_protected && <button type="button" className="danger" disabled={busy} onClick={() => removePassword(item)}>{action === `remove-password:${item.id}` ? <><span className="action-spinner" />{t('shareManager.removing')}</> : t('shareManager.removePassword')}</button>}<button type="button" disabled={busy} onClick={() => setEditingId('')}>{t('common:actions.cancel')}</button><button className="primary" disabled={busy}>{action === `save:${item.id}` ? <><span className="action-spinner" />{t('shareManager.saving')}</> : t('common:actions.save')}</button></footer>
      </form>}
    </div>)}</div>
  </div>
}
