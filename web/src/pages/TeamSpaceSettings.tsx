import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import AccountMenu from '../components/AccountMenu'
import Brand from '../components/Brand'
import Icon from '../components/Icon'
import LanguageSwitcher from '../components/LanguageSwitcher'
import HelpLink from '../components/HelpLink'
import WorkspaceSwitcher from '../components/WorkspaceSwitcher'
import UserAvatar from '../components/UserAvatar'
import { useToast } from '../components/toast'
import type { Organization, OrganizationMember, OrganizationRole, User } from '../types'
import type { WorkspaceCapabilities } from '../workspace/types'
import { quotaAllowed, quotaGuardTitle } from '../quota/guards'
import QuotaGuard from '../components/quota/QuotaGuard'

export default function TeamSpaceSettings({ user, onUserChange, logout }: { user: User; onUserChange: (user: User) => void; logout: () => void }) {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { t, i18n } = useTranslation(['account', 'admin', 'common'])
  const toast = useToast()
  const [space, setSpace] = useState<Organization | null>(null)
  const [members, setMembers] = useState<OrganizationMember[]>([])
  const [tab, setTab] = useState<'members' | 'settings'>('members')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<OrganizationRole>('editor')
  const [name, setName] = useState('')
  const [inviteUrl, setInviteUrl] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [capabilities, setCapabilities] = useState<WorkspaceCapabilities | null>(null)
  const refreshCapabilities=useCallback(()=>api.quotaCapabilities(undefined,id).then(value=>{setCapabilities(value);return value}),[id])

  async function load() {
    try {
      const spaces = await api.organizations()
      const selected = spaces.find(item => item.id === id)
      if (!selected || selected.kind !== 'team') throw new Error(t('space.notFound'))
      if (selected.access_source !== 'platform_admin' && !['owner', 'admin'].includes(selected.role)) throw new Error(t('space.forbidden'))
      const [memberItems]=await Promise.all([api.organizationMembers(selected.id),refreshCapabilities()])
      setSpace(selected); setName(selected.name); setMembers(memberItems)
    } catch (value) { setError(value instanceof Error ? value.message : t('common:errors.operationFailed')) }
  }
  useEffect(() => { void load() }, [id])
  useEffect(()=>{const refresh=()=>{if(document.visibilityState==='visible')void refreshCapabilities().catch(()=>undefined)},timer=window.setInterval(refresh,15000);window.addEventListener('focus',refresh);return()=>{window.clearInterval(timer);window.removeEventListener('focus',refresh)}},[refreshCapabilities])

  async function invite(event: React.FormEvent) {
    event.preventDefault(); if (!space) return
    let live=capabilities;try{live=await refreshCapabilities()}catch{/* backend remains authoritative */}
    if(!quotaAllowed(live,'invite_member')){setError(quotaGuardTitle(live,'invite_member',t,i18n.language));return}
    setBusy('invite'); setError(''); setInviteUrl('')
    try { const result = await api.createInvitation(space.id, email, role); setInviteUrl(result.invite_url || ''); setEmail(''); void refreshCapabilities(); toast.success(t('space.inviteCreated')) }
    catch (value) { setError(value instanceof Error ? value.message : t('common:errors.operationFailed')) }
    finally { setBusy('') }
  }

  async function updateMember(member: OrganizationMember, next: OrganizationRole) {
    if (!space) return
    setBusy(member.id); setError('')
    try { const updated = await api.updateOrganizationMember(space.id, member.id, next); setMembers(list => list.map(item => item.id === updated.id ? updated : item)); toast.success(t('space.memberUpdated')) }
    catch (value) { setError(value instanceof Error ? value.message : t('common:errors.operationFailed')) }
    finally { setBusy('') }
  }

  async function removeMember(member: OrganizationMember) {
    if (!space || !confirm(t('space.removeConfirm', { name: member.name || member.email }))) return
    setBusy(member.id); setError('')
    try { await api.removeOrganizationMember(space.id, member.id); setMembers(list => list.filter(item => item.id !== member.id)); toast.success(t('space.memberRemoved')) }
    catch (value) { setError(value instanceof Error ? value.message : t('common:errors.operationFailed')) }
    finally { setBusy('') }
  }

  async function rename(event: React.FormEvent) {
    event.preventDefault(); if (!space) return
    setBusy('rename'); setError('')
    try { const updated = await api.updateOrganization(space.id, name.trim()); setSpace(updated); toast.success(t('space.renamed')) }
    catch (value) { setError(value instanceof Error ? value.message : t('common:errors.operationFailed')) }
    finally { setBusy('') }
  }

  async function archive() {
    if (!space || !confirm(t('space.archiveConfirm', { name: space.name }))) return
    setBusy('archive'); setError('')
    try { await api.archiveOrganization(space.id); onUserChange(await api.me()); navigate('/') }
    catch (value) { setError(value instanceof Error ? value.message : t('common:errors.operationFailed')) }
    finally { setBusy('') }
  }

  const isOwner = space?.access_source === 'platform_admin' || space?.role === 'owner'
  const canInvite=quotaAllowed(capabilities,'invite_member'),inviteQuotaTitle=quotaGuardTitle(capabilities,'invite_member',t,i18n.language)
  return <div className="settings-shell team-space-user-settings">
    <header className="settings-topbar"><Link to="/"><Brand /></Link><div className="topbar-account-actions"><WorkspaceSwitcher user={user} onUserChange={onUserChange} /><LanguageSwitcher account /><HelpLink/><AccountMenu user={user} view="user" onUserChange={onUserChange} logout={logout} /></div></header>
    <main className="settings-center">
      <Link className="settings-back" to="/"><Icon name="chevronLeft" />{t('backToWorkspace')}</Link>
      <div className="settings-heading"><span className="settings-heading-icon"><Icon name="users" size={22} /></span><div><h1>{space?.name || t('space.title')}</h1><p>{t('space.subtitle')}</p></div></div>
      {error && <div className="error">{error}</div>}
      {space && <section className="team-space-user-card"><header><div><small>{t('space.yourRole')}</small><strong>{t(`admin:organizations.roles.${space.role}`)}</strong></div><span>{space.slug}</span></header><nav><button className={tab === 'members' ? 'active' : ''} onClick={() => setTab('members')}><Icon name="users" />{t('space.tabs.members')}</button>{isOwner && <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}><Icon name="settings" />{t('space.tabs.settings')}</button>}</nav>
        {tab === 'members' && <div><form className="team-invite-form" onSubmit={invite}><label>{t('space.email')}<input type="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="name@company.com" /></label><label>{t('space.role')}<select value={role} onChange={event => setRole(event.target.value as OrganizationRole)}><option value="admin" disabled={!isOwner}>{t('admin:organizations.roles.admin')}</option><option value="editor">{t('admin:organizations.roles.editor')}</option><option value="viewer">{t('admin:organizations.roles.viewer')}</option></select></label><QuotaGuard fill message={!canInvite?inviteQuotaTitle:''}><button className="primary icon-button" disabled={busy === 'invite'||!canInvite}><Icon name="plus" />{t('space.invite')}</button></QuotaGuard></form>{inviteUrl && <div className="invite-result"><input readOnly value={inviteUrl} /><button onClick={() => navigator.clipboard.writeText(inviteUrl)}><Icon name="copy" />{t('common:actions.copy')}</button></div>}<div className="team-member-list">{members.map(member => <article key={member.id}><UserAvatar user={member} size={40} /><div><strong>{member.name || member.email.split('@')[0]}</strong><small>{member.email}</small></div><select value={member.role} disabled={busy === member.id || (!isOwner && ['owner', 'admin'].includes(member.role))} onChange={event => updateMember(member, event.target.value as OrganizationRole)}><option value="owner" disabled={!isOwner}>{t('admin:organizations.roles.owner')}</option><option value="admin" disabled={!isOwner}>{t('admin:organizations.roles.admin')}</option><option value="editor">{t('admin:organizations.roles.editor')}</option><option value="viewer">{t('admin:organizations.roles.viewer')}</option></select><button className="team-member-remove" disabled={busy === member.id || (!isOwner && ['owner', 'admin'].includes(member.role))} onClick={() => removeMember(member)}><Icon name="delete" /></button></article>)}</div></div>}
        {tab === 'settings' && isOwner && <div className="team-space-settings"><section><h3>{t('space.basic')}</h3><p>{t('space.basicDescription')}</p><form onSubmit={rename}><label>{t('space.name')}<input required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label><button className="primary icon-button" disabled={busy === 'rename'}><Icon name="check" />{t('common:actions.save')}</button></form></section><section className="team-space-danger"><h3>{t('space.archive')}</h3><p>{t('space.archiveDescription')}</p><button className="danger icon-button" disabled={busy === 'archive'} onClick={archive}><Icon name="delete" />{t('space.archiveAction')}</button></section></div>}
      </section>}
    </main>
  </div>
}
