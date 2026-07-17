import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import Icon from '../components/Icon'
import AdminPagination from '../components/AdminPagination'
import UserAvatar from '../components/UserAvatar'
import { useToast } from '../components/toast'
import OrganizationQuotaPanel from '../components/admin/OrganizationQuotaPanel'
import { formatDate, normalizeLocale } from '../i18n'
import type { AdminOrganization, AdminResource, AdminUser, OrganizationMember, OrganizationRole, User } from '../types'
import '../styles/spaces-admin.css'

function bytes(value: number, locale: string) {
  if (!value) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB'], index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 4)
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1024 ** index)} ${units[index]}`
}

export default function AdminOrganizations({ user, onUserChange }: { user: User; onUserChange: (user: User) => void }) {
  const { t, i18n } = useTranslation(['admin', 'common'])
  const toast = useToast()
  const locale = normalizeLocale(i18n.language)
  const [items, setItems] = useState<AdminOrganization[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [members, setMembers] = useState<OrganizationMember[]>([])
  const [resources, setResources] = useState<AdminResource[]>([])
  const [spaceType, setSpaceType] = useState<'team' | 'personal'>('team')
  const [selectedId, setSelectedId] = useState('')
  const [tab, setTab] = useState<'overview' | 'members' | 'owner' | 'quota' | 'usage' | 'settings'>('overview')
  const [query, setQuery] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<OrganizationRole>('editor')
  const [inviteUrl, setInviteUrl] = useState('')
  const [error, setError] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [organizationName, setOrganizationName] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [renameValue, setRenameValue] = useState('')
  const [busy, setBusy] = useState('')
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(10)

  const current = items.find(item => item.id === selectedId)
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return items.filter(item => item.kind === spaceType && (!needle || `${item.name} ${item.slug} ${item.owner_name} ${item.owner_email}`.toLowerCase().includes(needle)))
  }, [items, query, spaceType])
  const visibleItems = filtered.slice((page - 1) * pageSize, page * pageSize)
  useEffect(() => { if (page > Math.max(1, Math.ceil(filtered.length / pageSize))) setPage(1) }, [filtered.length, page, pageSize])

  async function loadItems() {
    try {
      const value = await api.adminOrganizations(true)
      setItems(value)
      setSelectedId(current => current && value.some(item => item.id === current) ? current : value.find(item => item.kind === spaceType)?.id || value[0]?.id || '')
    }
    catch (value) { setError(value instanceof Error ? value.message : t('common:errors.operationFailed')) }
  }

  useEffect(() => {
    void loadItems()
    api.adminUsers({ page_size: 100 }).then(value => { setUsers(value.items); setOwnerId(current => current || value.items[0]?.id || '') }).catch(() => undefined)
  }, [])

  useEffect(() => {
    setTab('overview'); setInviteUrl(''); setError(''); setResources([])
    if (!current) { setMembers([]); setRenameValue(''); return }
    setRenameValue(current.name)
    if (current.kind === 'team') api.organizationMembers(current.id).then(setMembers).catch(value => setError(value instanceof Error ? value.message : t('common:errors.operationFailed')))
    else { setMembers([]); api.adminResources({ organization_id: current.id, page_size: 100 }).then(value => setResources(value.items)).catch(value => setError(value instanceof Error ? value.message : t('common:errors.operationFailed'))) }
  }, [current?.id])

  function changeSpaceType(value: 'team' | 'personal') {
    setSpaceType(value); setQuery(''); setPage(1); setSelectedId(items.find(item => item.kind === value)?.id || '')
  }

  async function createOrganization(event: React.FormEvent) {
    event.preventDefault()
    if (!organizationName.trim() || !ownerId) return
    setBusy('create'); setError('')
    try {
      const organization = await api.createOrganization(organizationName.trim(), ownerId)
      onUserChange(await api.switchOrganization(organization.id))
      setOrganizationName(''); setCreateOpen(false); setSpaceType('team'); setSelectedId(organization.id); await loadItems()
    } catch (value) { setError(value instanceof Error ? value.message : t('common:errors.operationFailed')) }
    finally { setBusy('') }
  }

  async function enterOrganization(id: string) {
    setSelectedId(id)
  }

  async function invite(event: React.FormEvent) {
    event.preventDefault()
    if (!current) return
    setBusy('invite'); setError(''); setInviteUrl('')
    try { const value = await api.createInvitation(current.id, email, role); setInviteUrl(value.invite_url || ''); setEmail(''); toast.success(t('spaces.inviteCreated')) }
    catch (value) { setError(value instanceof Error ? value.message : t('common:errors.operationFailed')) }
    finally { setBusy('') }
  }

  async function updateMember(member: OrganizationMember, next: OrganizationRole) {
    if (!current) return
    setBusy(member.id); setError('')
    try { const value = await api.updateOrganizationMember(current.id, member.id, next); setMembers(list => list.map(item => item.id === value.id ? value : item)); toast.success(t('spaces.memberUpdated')) }
    catch (value) { setError(value instanceof Error ? value.message : t('common:errors.operationFailed')) }
    finally { setBusy('') }
  }

  async function removeMember(member: OrganizationMember) {
    if (!current || !window.confirm(t('spaces.removeMemberConfirm', { name: member.name || member.email }))) return
    setBusy(member.id); setError('')
    try { await api.removeOrganizationMember(current.id, member.id); setMembers(list => list.filter(item => item.id !== member.id)); toast.success(t('spaces.memberRemoved')); await loadItems() }
    catch (value) { setError(value instanceof Error ? value.message : t('common:errors.operationFailed')) }
    finally { setBusy('') }
  }

  async function rename(event: React.FormEvent) {
    event.preventDefault()
    if (!current || !renameValue.trim()) return
    setBusy('rename'); setError('')
    try { await api.updateOrganization(current.id, renameValue.trim()); toast.success(t('spaces.renamed')); await loadItems() }
    catch (value) { setError(value instanceof Error ? value.message : t('common:errors.operationFailed')) }
    finally { setBusy('') }
  }

  async function archive() {
    if (!current || !window.confirm(t('spaces.archiveConfirm', { name: current.name }))) return
    setBusy('archive'); setError('')
    try {
      await api.archiveOrganization(current.id)
      onUserChange(await api.me()); setMembers([]); await loadItems()
    } catch (value) { setError(value instanceof Error ? value.message : t('common:errors.operationFailed')) }
    finally { setBusy('') }
  }

  return <div className="admin-content-page team-spaces-page">
    <div className="admin-page-intro"><div><h1>{t('spaces.title')}</h1><p>{t('spaces.subtitle')}</p></div>{spaceType === 'team' && <button className="primary icon-button" onClick={() => setCreateOpen(true)}><Icon name="plus" />{t('spaces.create')}</button>}</div>
    <nav className="space-kind-tabs"><button className={spaceType === 'team' ? 'active' : ''} onClick={() => changeSpaceType('team')}><Icon name="users" /><span><strong>{t('spaces.types.team')}</strong><small>{t('spaces.types.teamHint')}</small></span><b>{items.filter(item => item.kind === 'team').length}</b></button><button className={spaceType === 'personal' ? 'active' : ''} onClick={() => changeSpaceType('personal')}><Icon name="user" /><span><strong>{t('spaces.types.personal')}</strong><small>{t('spaces.types.personalHint')}</small></span><b>{items.filter(item => item.kind === 'personal').length}</b></button></nav>
    {error && <div className="error">{error}</div>}
    <section className="admin-list-card team-space-list-card">
      <div className="team-space-list-toolbar"><label className="admin-search"><Icon name="search" /><input value={query} onChange={event => { setQuery(event.target.value); setPage(1) }} placeholder={t('spaces.search')} /></label><span>{t('spaces.total', { count: filtered.length, type: t(`spaces.types.${spaceType}`) })}</span></div>
      <div className="team-space-table-wrap"><table className="team-space-table"><thead><tr><th>{t('spaces.table.space')}</th><th>{t('spaces.table.owner')}</th><th>{t('spaces.table.members')}</th><th>{t('spaces.table.resources')}</th><th>{t('spaces.table.storage')}</th><th>{t('spaces.table.created')}</th><th /></tr></thead><tbody>{visibleItems.map(item => <tr key={item.id} className={item.id === selectedId ? 'current' : ''}><td><div className="team-space-name"><span><Icon name={item.kind === 'personal' ? 'user' : 'users'} /></span><div><strong>{item.name}</strong><small>{item.slug}</small></div>{item.id === selectedId && <em>{t('spaces.selected')}</em>}</div></td><td><div className="resource-owner-cell"><strong>{item.owner_name || item.owner_email.split('@')[0]}</strong><small>{item.owner_email}</small></div></td><td>{item.kind === 'personal' ? '—' : item.member_count}</td><td>{item.demo_count}</td><td>{bytes(item.storage_bytes, locale)}</td><td><small>{formatDate(item.created_at, locale)}</small></td><td><button className={item.id === selectedId ? 'current' : ''} disabled={item.id === selectedId} onClick={() => enterOrganization(item.id)}><Icon name={item.id === selectedId ? 'check' : 'chevronRight'} />{t(item.id === selectedId ? 'spaces.selected' : 'spaces.view')}</button></td></tr>)}</tbody></table>{!filtered.length && <div className="admin-table-state"><Icon name={spaceType === 'personal' ? 'user' : 'users'} size={28} />{t('spaces.empty')}</div>}</div>
      <AdminPagination page={page} pageSize={pageSize} total={filtered.length} onPage={setPage} onPageSize={size => { setPageSize(size); setPage(1) }} />
    </section>

    {current ? <section className="team-space-detail-card"><header><div><span><Icon name={current.kind === 'personal' ? 'user' : 'shield'} /></span><div><small>{t(current.kind === 'personal' ? 'spaces.personalLifecycle' : 'spaces.platformAccess')}</small><h2>{current.name}</h2><p>{current.owner_email}</p></div></div><b>{t(`spaces.types.${current.kind}`)}</b></header><nav>{(current.kind === 'team' ? ['overview', 'members', 'quota', 'settings'] as const : ['overview', 'owner', 'quota', 'usage'] as const).map(value => <button key={value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}><Icon name={value === 'overview' ? 'grid' : value === 'members' || value === 'owner' ? 'user' : value === 'quota' ? 'database' : value === 'usage' ? 'analytics' : 'settings'} />{t(`spaces.tabs.${value}`)}</button>)}</nav>
      {tab === 'overview' && <div className="team-space-overview"><article><span><Icon name="users" /></span><small>{t('spaces.table.members')}</small><strong>{current.member_count}</strong></article><article><span><Icon name="folder" /></span><small>{t('spaces.table.resources')}</small><strong>{current.demo_count}</strong></article><article><span><Icon name="database" /></span><small>{t('spaces.table.storage')}</small><strong>{bytes(current.storage_bytes, locale)}</strong></article><div><h3>{t('spaces.ownership')}</h3><p>{t('spaces.ownershipDescription')}</p><strong>{current.owner_name || current.owner_email}</strong><small>{current.owner_email}</small></div></div>}
      {tab === 'members' && <div className="team-space-members"><form className="team-invite-form" onSubmit={invite}><label>{t('spaces.memberEmail')}<input type="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="name@company.com" /></label><label>{t('spaces.teamRole')}<select value={role} onChange={event => setRole(event.target.value as OrganizationRole)}><option value="admin">{t('organizations.roles.admin')}</option><option value="editor">{t('organizations.roles.editor')}</option><option value="viewer">{t('organizations.roles.viewer')}</option></select></label><button className="primary icon-button" disabled={busy === 'invite'}><Icon name="plus" />{t('spaces.invite')}</button></form>{inviteUrl && <div className="invite-result"><input readOnly value={inviteUrl} /><button onClick={() => navigator.clipboard.writeText(inviteUrl)}><Icon name="copy" />{t('common:actions.copy')}</button></div>}<div className="team-member-list">{members.map(member => <article key={member.id}><UserAvatar user={member} size={40} /><div><strong>{member.name || member.email.split('@')[0]}</strong><small>{member.email}</small></div><select value={member.role} disabled={busy === member.id} onChange={event => updateMember(member, event.target.value as OrganizationRole)}><option value="owner">{t('organizations.roles.owner')}</option><option value="admin">{t('organizations.roles.admin')}</option><option value="editor">{t('organizations.roles.editor')}</option><option value="viewer">{t('organizations.roles.viewer')}</option></select><button className="team-member-remove" disabled={busy === member.id} title={t('spaces.removeMember')} onClick={() => removeMember(member)}><Icon name="delete" /></button></article>)}</div></div>}
      {tab === 'owner' && <div className="personal-space-owner"><UserAvatar user={{ name: current.owner_name, email: current.owner_email }} size={54} /><div><small>{t('spaces.ownerAccount')}</small><strong>{current.owner_name || current.owner_email.split('@')[0]}</strong><p>{current.owner_email}</p></div><span><Icon name="lock" />{t('spaces.ownerImmutable')}</span></div>}
      {tab === 'quota' && <OrganizationQuotaPanel id={current.id} />}
      {tab === 'usage' && <div className="personal-space-usage"><section><article><span><Icon name="folder" /></span><small>{t('spaces.table.resources')}</small><strong>{current.demo_count}</strong></article><article><span><Icon name="database" /></span><small>{t('spaces.table.storage')}</small><strong>{bytes(current.storage_bytes, locale)}</strong></article></section><div><header><strong>{t('spaces.resourceList')}</strong><small>{t('spaces.resourceListHint')}</small></header>{resources.map(resource => <article key={resource.id}><span><Icon name="record" /></span><div><strong>{resource.title}</strong><small>{resource.status} · {resource.step_count} {t('spaces.steps')}</small></div><b>{bytes(resource.storage_bytes, locale)}</b></article>)}{!resources.length && <p>{t('spaces.noResources')}</p>}</div></div>}
      {tab === 'settings' && <div className="team-space-settings"><section><h3>{t('spaces.basicSettings')}</h3><p>{t('spaces.basicSettingsDescription')}</p><form onSubmit={rename}><label>{t('spaces.name')}<input maxLength={120} required value={renameValue} onChange={event => setRenameValue(event.target.value)} /></label><button className="primary icon-button" disabled={busy === 'rename'}><Icon name="check" />{t('common:actions.save')}</button></form></section><section className="team-space-danger"><h3>{t('spaces.archive')}</h3><p>{t('spaces.archiveDescription')}</p><button className="danger icon-button" disabled={busy === 'archive'} onClick={archive}><Icon name="delete" />{t('spaces.archiveAction')}</button></section></div>}
    </section> : <section className="team-space-select-state"><span><Icon name="users" size={28} /></span><h2>{t('spaces.selectTitle')}</h2><p>{t('spaces.selectDescription')}</p></section>}

    {createOpen && <div className="team-space-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setCreateOpen(false) }}><form className="team-space-dialog" role="dialog" aria-modal="true" aria-labelledby="team-space-dialog-title" onSubmit={createOrganization}><header><span><Icon name="users" size={22} /></span><div><h2 id="team-space-dialog-title">{t('spaces.create')}</h2><p>{t('spaces.createHelp')}</p></div><button type="button" aria-label={t('common:actions.close')} onClick={() => setCreateOpen(false)}>×</button></header><div className="team-space-create-fields"><label>{t('spaces.name')}<input autoFocus maxLength={120} required value={organizationName} onChange={event => setOrganizationName(event.target.value)} placeholder={t('spaces.namePlaceholder')} /></label><label>{t('spaces.owner')}<select required value={ownerId} onChange={event => setOwnerId(event.target.value)}>{users.map(item => <option key={item.id} value={item.id}>{item.name || item.email} · {item.email}</option>)}</select></label></div><footer><button type="button" className="secondary" onClick={() => setCreateOpen(false)}>{t('common:actions.cancel')}</button><button className="primary icon-button" disabled={busy === 'create'}>{busy === 'create' ? <span className="action-spinner" /> : <Icon name="plus" />}{t('spaces.createAction')}</button></footer></form></div>}
  </div>
}
