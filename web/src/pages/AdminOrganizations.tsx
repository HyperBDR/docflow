import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import Icon from '../components/Icon'
import UserAvatar from '../components/UserAvatar'
import { formatDate, normalizeLocale } from '../i18n'
import type { AdminOrganization, AdminUser, OrganizationMember, OrganizationRole, User } from '../types'

function bytes(value: number, locale: string) {
  if (!value) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB'], index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 4)
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1024 ** index)} ${units[index]}`
}

export default function AdminOrganizations({ user, onUserChange }: { user: User; onUserChange: (user: User) => void }) {
  const { t, i18n } = useTranslation(['admin', 'common'])
  const locale = normalizeLocale(i18n.language)
  const activeId = user.active_organization_id || user.current_organization_id || ''
  const [items, setItems] = useState<AdminOrganization[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [members, setMembers] = useState<OrganizationMember[]>([])
  const [tab, setTab] = useState<'overview' | 'members' | 'settings'>('overview')
  const [query, setQuery] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<OrganizationRole>('editor')
  const [inviteUrl, setInviteUrl] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [organizationName, setOrganizationName] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [renameValue, setRenameValue] = useState('')
  const [busy, setBusy] = useState('')

  const current = items.find(item => item.id === activeId)
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle ? items.filter(item => `${item.name} ${item.slug} ${item.owner_name} ${item.owner_email}`.toLowerCase().includes(needle)) : items
  }, [items, query])

  async function loadItems() {
    try { setItems(await api.adminOrganizations()) }
    catch (value) { setError(value instanceof Error ? value.message : t('common:errors.operationFailed')) }
  }

  useEffect(() => {
    void loadItems()
    api.adminUsers({ page_size: 100 }).then(value => { setUsers(value.items); setOwnerId(current => current || value.items[0]?.id || '') }).catch(() => undefined)
  }, [])

  useEffect(() => {
    setTab('overview'); setInviteUrl(''); setMessage(''); setError('')
    if (!current) { setMembers([]); setRenameValue(''); return }
    setRenameValue(current.name)
    api.organizationMembers(current.id).then(setMembers).catch(value => setError(value instanceof Error ? value.message : t('common:errors.operationFailed')))
  }, [activeId, current?.id])

  async function createOrganization(event: React.FormEvent) {
    event.preventDefault()
    if (!organizationName.trim() || !ownerId) return
    setBusy('create'); setError('')
    try {
      const organization = await api.createOrganization(organizationName.trim(), ownerId)
      onUserChange(await api.switchOrganization(organization.id))
      setOrganizationName(''); setCreateOpen(false); await loadItems()
    } catch (value) { setError(value instanceof Error ? value.message : t('common:errors.operationFailed')) }
    finally { setBusy('') }
  }

  async function enterOrganization(id: string) {
    if (id === activeId) return
    setBusy(`enter:${id}`); setError('')
    try { onUserChange(await api.switchOrganization(id)) }
    catch (value) { setError(value instanceof Error ? value.message : t('common:errors.operationFailed')) }
    finally { setBusy('') }
  }

  async function invite(event: React.FormEvent) {
    event.preventDefault()
    if (!current) return
    setBusy('invite'); setError(''); setInviteUrl('')
    try { const value = await api.createInvitation(current.id, email, role); setInviteUrl(value.invite_url || ''); setEmail(''); setMessage(t('spaces.inviteCreated')) }
    catch (value) { setError(value instanceof Error ? value.message : t('common:errors.operationFailed')) }
    finally { setBusy('') }
  }

  async function updateMember(member: OrganizationMember, next: OrganizationRole) {
    if (!current) return
    setBusy(member.id); setError('')
    try { const value = await api.updateOrganizationMember(current.id, member.id, next); setMembers(list => list.map(item => item.id === value.id ? value : item)); setMessage(t('spaces.memberUpdated')) }
    catch (value) { setError(value instanceof Error ? value.message : t('common:errors.operationFailed')) }
    finally { setBusy('') }
  }

  async function removeMember(member: OrganizationMember) {
    if (!current || !window.confirm(t('spaces.removeMemberConfirm', { name: member.name || member.email }))) return
    setBusy(member.id); setError('')
    try { await api.removeOrganizationMember(current.id, member.id); setMembers(list => list.filter(item => item.id !== member.id)); setMessage(t('spaces.memberRemoved')); await loadItems() }
    catch (value) { setError(value instanceof Error ? value.message : t('common:errors.operationFailed')) }
    finally { setBusy('') }
  }

  async function rename(event: React.FormEvent) {
    event.preventDefault()
    if (!current || !renameValue.trim()) return
    setBusy('rename'); setError('')
    try { await api.updateOrganization(current.id, renameValue.trim()); setMessage(t('spaces.renamed')); await loadItems() }
    catch (value) { setError(value instanceof Error ? value.message : t('common:errors.operationFailed')) }
    finally { setBusy('') }
  }

  async function archive() {
    if (!current || !window.confirm(t('spaces.archiveConfirm', { name: current.name }))) return
    setBusy('archive'); setError('')
    try {
      await api.archiveOrganization(current.id)
      onUserChange(await api.me()); setMembers([]); setMessage(''); await loadItems()
    } catch (value) { setError(value instanceof Error ? value.message : t('common:errors.operationFailed')) }
    finally { setBusy('') }
  }

  return <div className="admin-content-page team-spaces-page">
    <div className="admin-page-intro"><div><h1>{t('spaces.title')}</h1><p>{t('spaces.subtitle')}</p></div><button className="primary icon-button" onClick={() => setCreateOpen(true)}><Icon name="plus" />{t('spaces.create')}</button></div>
    {error && <div className="error">{error}</div>}{message && <div className="success settings-message">{message}</div>}
    <section className="admin-list-card team-space-list-card">
      <div className="team-space-list-toolbar"><label className="admin-search"><Icon name="search" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={t('spaces.search')} /></label><span>{t('spaces.total', { count: filtered.length })}</span></div>
      <div className="team-space-table-wrap"><table className="team-space-table"><thead><tr><th>{t('spaces.table.space')}</th><th>{t('spaces.table.owner')}</th><th>{t('spaces.table.members')}</th><th>{t('spaces.table.resources')}</th><th>{t('spaces.table.storage')}</th><th>{t('spaces.table.created')}</th><th /></tr></thead><tbody>{filtered.map(item => <tr key={item.id} className={item.id === activeId ? 'current' : ''}><td><div className="team-space-name"><span><Icon name="users" /></span><div><strong>{item.name}</strong><small>{item.slug}</small></div>{item.id === activeId && <em>{t('spaces.managing')}</em>}</div></td><td><div className="resource-owner-cell"><strong>{item.owner_name || item.owner_email.split('@')[0]}</strong><small>{item.owner_email}</small></div></td><td>{item.member_count}</td><td>{item.demo_count}</td><td>{bytes(item.storage_bytes, locale)}</td><td><small>{formatDate(item.created_at, locale)}</small></td><td><button className={item.id === activeId ? 'current' : ''} disabled={item.id === activeId || busy === `enter:${item.id}`} onClick={() => enterOrganization(item.id)}>{busy === `enter:${item.id}` ? <span className="action-spinner" /> : <Icon name={item.id === activeId ? 'check' : 'chevronRight'} />}{t(item.id === activeId ? 'spaces.managing' : 'spaces.enter')}</button></td></tr>)}</tbody></table>{!filtered.length && <div className="admin-table-state"><Icon name="users" size={28} />{t('spaces.empty')}</div>}</div>
    </section>

    {current ? <section className="team-space-detail-card"><header><div><span><Icon name="shield" /></span><div><small>{t('spaces.platformAccess')}</small><h2>{current.name}</h2><p>{current.owner_email}</p></div></div><b>{t('spaces.active')}</b></header><nav>{(['overview', 'members', 'settings'] as const).map(value => <button key={value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}><Icon name={value === 'overview' ? 'grid' : value === 'members' ? 'users' : 'settings'} />{t(`spaces.tabs.${value}`)}</button>)}</nav>
      {tab === 'overview' && <div className="team-space-overview"><article><span><Icon name="users" /></span><small>{t('spaces.table.members')}</small><strong>{current.member_count}</strong></article><article><span><Icon name="folder" /></span><small>{t('spaces.table.resources')}</small><strong>{current.demo_count}</strong></article><article><span><Icon name="database" /></span><small>{t('spaces.table.storage')}</small><strong>{bytes(current.storage_bytes, locale)}</strong></article><div><h3>{t('spaces.ownership')}</h3><p>{t('spaces.ownershipDescription')}</p><strong>{current.owner_name || current.owner_email}</strong><small>{current.owner_email}</small></div></div>}
      {tab === 'members' && <div className="team-space-members"><form className="team-invite-form" onSubmit={invite}><label>{t('spaces.memberEmail')}<input type="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="name@company.com" /></label><label>{t('spaces.teamRole')}<select value={role} onChange={event => setRole(event.target.value as OrganizationRole)}><option value="admin">{t('organizations.roles.admin')}</option><option value="editor">{t('organizations.roles.editor')}</option><option value="viewer">{t('organizations.roles.viewer')}</option></select></label><button className="primary icon-button" disabled={busy === 'invite'}><Icon name="plus" />{t('spaces.invite')}</button></form>{inviteUrl && <div className="invite-result"><input readOnly value={inviteUrl} /><button onClick={() => navigator.clipboard.writeText(inviteUrl)}><Icon name="copy" />{t('common:actions.copy')}</button></div>}<div className="team-member-list">{members.map(member => <article key={member.id}><UserAvatar user={member} size={40} /><div><strong>{member.name || member.email.split('@')[0]}</strong><small>{member.email}</small></div><select value={member.role} disabled={busy === member.id} onChange={event => updateMember(member, event.target.value as OrganizationRole)}><option value="owner">{t('organizations.roles.owner')}</option><option value="admin">{t('organizations.roles.admin')}</option><option value="editor">{t('organizations.roles.editor')}</option><option value="viewer">{t('organizations.roles.viewer')}</option></select><button className="team-member-remove" disabled={busy === member.id} title={t('spaces.removeMember')} onClick={() => removeMember(member)}><Icon name="delete" /></button></article>)}</div></div>}
      {tab === 'settings' && <div className="team-space-settings"><section><h3>{t('spaces.basicSettings')}</h3><p>{t('spaces.basicSettingsDescription')}</p><form onSubmit={rename}><label>{t('spaces.name')}<input maxLength={120} required value={renameValue} onChange={event => setRenameValue(event.target.value)} /></label><button className="primary icon-button" disabled={busy === 'rename'}><Icon name="check" />{t('common:actions.save')}</button></form></section><section className="team-space-danger"><h3>{t('spaces.archive')}</h3><p>{t('spaces.archiveDescription')}</p><button className="danger icon-button" disabled={busy === 'archive'} onClick={archive}><Icon name="delete" />{t('spaces.archiveAction')}</button></section></div>}
    </section> : <section className="team-space-select-state"><span><Icon name="users" size={28} /></span><h2>{t('spaces.selectTitle')}</h2><p>{t('spaces.selectDescription')}</p></section>}

    {createOpen && <div className="team-space-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setCreateOpen(false) }}><form className="team-space-dialog" role="dialog" aria-modal="true" aria-labelledby="team-space-dialog-title" onSubmit={createOrganization}><header><span><Icon name="users" size={22} /></span><div><h2 id="team-space-dialog-title">{t('spaces.create')}</h2><p>{t('spaces.createHelp')}</p></div><button type="button" aria-label={t('common:actions.close')} onClick={() => setCreateOpen(false)}>×</button></header><div className="team-space-create-fields"><label>{t('spaces.name')}<input autoFocus maxLength={120} required value={organizationName} onChange={event => setOrganizationName(event.target.value)} placeholder={t('spaces.namePlaceholder')} /></label><label>{t('spaces.owner')}<select required value={ownerId} onChange={event => setOwnerId(event.target.value)}>{users.map(item => <option key={item.id} value={item.id}>{item.name || item.email} · {item.email}</option>)}</select></label></div><footer><button type="button" className="secondary" onClick={() => setCreateOpen(false)}>{t('common:actions.cancel')}</button><button className="primary icon-button" disabled={busy === 'create'}>{busy === 'create' ? <span className="action-spinner" /> : <Icon name="plus" />}{t('spaces.createAction')}</button></footer></form></div>}
  </div>
}
