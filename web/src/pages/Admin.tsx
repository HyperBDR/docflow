import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import Icon from '../components/Icon'
import UserAvatar from '../components/UserAvatar'
import { formatDate, formatNumber, normalizeLocale } from '../i18n'
import type { AdminOrganization, AdminUser, Locale, OrganizationRole, User, UserRole } from '../types'

function formatBytes(bytes: number, locale: Locale) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: index ? 1 : 0 }).format(bytes / 1024 ** index)} ${units[index]}`
}

export default function Admin({ currentUser, onCurrentUserChange }: { currentUser: User; onCurrentUserChange: (user: User) => void }) {
  const { t, i18n } = useTranslation(['admin', 'common'])
  const locale = normalizeLocale(i18n.language)
  const [searchParams, setSearchParams] = useSearchParams()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [selected, setSelected] = useState<AdminUser | null>(null)
  const [query, setQuery] = useState('')
  const [role, setRole] = useState<UserRole | ''>('')
  const [active, setActive] = useState<'' | 'true' | 'false'>('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [draft, setDraft] = useState({ name: '', email: '', role: 'user' as UserRole, is_active: true, ui_locale: 'zh-CN' as Locale })
  const [password, setPassword] = useState('')
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [detailTab, setDetailTab] = useState<'account' | 'teams' | 'usage' | 'security'>('account')
  const [organizations, setOrganizations] = useState<AdminOrganization[]>([])
  const [membershipOrganization, setMembershipOrganization] = useState('')
  const [membershipRole, setMembershipRole] = useState<OrganizationRole>('viewer')
  const [membershipBusy, setMembershipBusy] = useState('')

  const load = useCallback(async (keepSelection = true) => {
    setLoading(true); setError('')
    try {
      const result = await api.adminUsers({ query, role, active, page, page_size: 20 })
      setUsers(result.items); setTotal(result.total)
      setSelected(previous => {
        if (!keepSelection) return null
        return result.items.find(item => item.id === previous?.id) || previous
      })
    } catch (value) { setError(value instanceof Error ? value.message : t('common:errors.operationFailed')) }
    finally { setLoading(false) }
  }, [active, page, query, role, t])

  useEffect(() => { const timer = window.setTimeout(() => { void load() }, 220); return () => window.clearTimeout(timer) }, [load])
  useEffect(() => { api.adminOrganizations().then(setOrganizations).catch(() => undefined) }, [])
  useEffect(() => {
    if (!selected) return
    setDraft({ name: selected.name, email: selected.email, role: selected.role, is_active: selected.is_active, ui_locale: selected.ui_locale })
    setPassword(''); setMembershipOrganization(''); setMembershipRole('viewer'); setMessage(''); setError('')
  }, [selected?.id])
  useEffect(() => {
    const userId = searchParams.get('user')
    if (!userId) { setSelected(null); return }
    const found = users.find(item => item.id === userId)
    if (found) setSelected(found)
    else api.adminUser(userId).then(setSelected).catch(() => setSearchParams({}, { replace: true }))
  }, [searchParams, users, setSearchParams])

  function openUser(item: AdminUser) { setSelected(item); setDetailTab('account'); setSearchParams({ user: item.id }) }
  function closeUser() { setSelected(null); setSearchParams({}) }

  async function saveUser(event: React.FormEvent) {
    event.preventDefault()
    if (!selected) return
    setBusy(true); setError(''); setMessage('')
    try {
      const updated = await api.updateAdminUser(selected.id, draft)
      setSelected(updated)
      setUsers(items => items.map(item => item.id === updated.id ? updated : item))
      if (updated.id === currentUser.id) onCurrentUserChange(updated)
      setMessage(t('detail.saved'))
    } catch (value) { setError(value instanceof Error ? value.message : t('common:errors.operationFailed')) }
    finally { setBusy(false) }
  }

  async function resetPassword(event: React.FormEvent) {
    event.preventDefault()
    if (!selected) return
    setPasswordBusy(true); setError(''); setMessage('')
    try {
      await api.resetAdminPassword(selected.id, password)
      setPassword(''); setMessage(t('security.resetDone'))
    } catch (value) { setError(value instanceof Error ? value.message : t('common:errors.operationFailed')) }
    finally { setPasswordBusy(false) }
  }

  async function removeUser() {
    if (!selected || !window.confirm(t('security.deleteConfirm', { name: selected.name || selected.email }))) return
    setBusy(true); setError('')
    try { await api.deleteAdminUser(selected.id); closeUser(); await load(false) }
    catch (value) { setError(value instanceof Error ? value.message : t('common:errors.operationFailed')) }
    finally { setBusy(false) }
  }

  function applyUserUpdate(updated: AdminUser) {
    setSelected(updated)
    setUsers(items => items.map(item => item.id === updated.id ? updated : item))
    if (updated.id === currentUser.id) onCurrentUserChange(updated)
  }

  async function addMembership(event: React.FormEvent) {
    event.preventDefault()
    if (!selected || !membershipOrganization) return
    setMembershipBusy('add'); setError(''); setMessage('')
    try {
      applyUserUpdate(await api.addAdminUserMembership(selected.id, membershipOrganization, membershipRole))
      setMembershipOrganization(''); setMembershipRole('viewer'); setMessage(t('teams.added'))
    } catch (value) { setError(value instanceof Error ? value.message : t('common:errors.operationFailed')) }
    finally { setMembershipBusy('') }
  }

  async function updateMembership(membershipId: string, role: OrganizationRole) {
    if (!selected) return
    setMembershipBusy(membershipId); setError(''); setMessage('')
    try { applyUserUpdate(await api.updateAdminUserMembership(selected.id, membershipId, role)); setMessage(t('teams.updated')) }
    catch (value) { setError(value instanceof Error ? value.message : t('common:errors.operationFailed')) }
    finally { setMembershipBusy('') }
  }

  async function removeMembership(membershipId: string, organizationName: string) {
    if (!selected || !window.confirm(t('teams.removeConfirm', { organization: organizationName }))) return
    setMembershipBusy(membershipId); setError(''); setMessage('')
    try { applyUserUpdate(await api.deleteAdminUserMembership(selected.id, membershipId)); setMessage(t('teams.removed')) }
    catch (value) { setError(value instanceof Error ? value.message : t('common:errors.operationFailed')) }
    finally { setMembershipBusy('') }
  }

  const pages = Math.max(1, Math.ceil(total / 20))
  return <main className="admin-content-page admin-users-page">
    <div className="admin-page-intro"><div><h1>{t('users.title')}</h1><p>{t('users.subtitle')}</p></div><span>{t('users.total', { count: total })}</span></div>
    {error && !selected && <div className="error admin-global-error">{error}</div>}
    <section className="admin-workspace">
      <div className="admin-list-panel">
        <div className="admin-filters">
          <label className="admin-search"><Icon name="search" size={16} /><input value={query} onChange={event => { setQuery(event.target.value); setPage(1) }} placeholder={t('filters.search')} aria-label={t('filters.search')} /></label>
          <select value={role} onChange={event => { setRole(event.target.value as UserRole | ''); setPage(1) }} aria-label={t('table.role')}><option value="">{t('filters.allRoles')}</option><option value="admin">{t('roles.admin')}</option><option value="user">{t('roles.user')}</option></select>
          <select value={active} onChange={event => { setActive(event.target.value as typeof active); setPage(1) }} aria-label={t('table.status')}><option value="">{t('filters.allStatuses')}</option><option value="true">{t('filters.active')}</option><option value="false">{t('filters.disabled')}</option></select>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-user-table"><thead><tr><th>{t('table.user')}</th><th>{t('table.role')}</th><th>{t('table.status')}</th><th>{t('table.teams')}</th><th>{t('table.resources')}</th><th>{t('table.views')}</th><th>{t('table.storage')}</th><th>{t('table.created')}</th></tr></thead>
            <tbody>{users.map(item => <tr key={item.id} className={selected?.id === item.id ? 'selected' : ''} onClick={() => openUser(item)} tabIndex={0} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') openUser(item) }}>
              <td><div className="user-cell"><UserAvatar user={item} size={36} /><span><strong>{item.name || item.email.split('@')[0]}</strong><small>{item.email}</small></span>{item.id === currentUser.id && <em>{t('self')}</em>}</div></td>
              <td><span className={`role-badge ${item.role}`}><Icon name={item.role === 'admin' ? 'shield' : 'user'} size={12} />{t(`roles.${item.role}`)}</span></td>
              <td><span className={`account-state ${item.is_active ? 'active' : 'disabled'}`}><i />{t(item.is_active ? 'filters.active' : 'filters.disabled')}</span></td>
              <td><div className="user-team-cell"><b>{formatNumber(item.memberships.filter(membership => membership.organization_kind === 'team').length, locale)}</b><small>{item.memberships.find(membership => membership.organization_kind === 'team' && membership.is_current)?.organization_name || item.memberships.find(membership => membership.organization_kind === 'team')?.organization_name || t('teams.personalOnly')}</small></div></td>
              <td><b>{formatNumber(item.stats.demos, locale)}</b><small>{t('detail.demos')}</small></td><td><b>{formatNumber(item.stats.views, locale)}</b></td><td><b>{formatBytes(item.stats.storage_bytes, locale)}</b></td><td><small>{formatDate(item.created_at, locale)}</small></td>
            </tr>)}</tbody>
          </table>
          {loading && <div className="admin-table-state"><span className="action-spinner" />{t('loading')}</div>}
          {!loading && !users.length && <div className="admin-table-state"><Icon name="users" size={26} />{t('table.empty')}</div>}
        </div>
        <div className="admin-pagination"><span>{t('pagination.range', { from: total ? (page - 1) * 20 + 1 : 0, to: Math.min(page * 20, total), total })}</span><div><button disabled={page <= 1} onClick={() => setPage(value => value - 1)}><Icon name="chevronLeft" /></button><b>{page} / {pages}</b><button disabled={page >= pages} onClick={() => setPage(value => value + 1)}><Icon name="chevronRight" /></button></div></div>
      </div>
    </section>
    {selected && <>
      <button className="admin-user-drawer-scrim" aria-label={t('common:actions.close')} onClick={closeUser} />
      <aside className="admin-user-drawer" role="dialog" aria-modal="true" aria-labelledby="admin-user-drawer-title">
        <header className="admin-user-drawer-header">
          <div className="admin-user-identity">
            <UserAvatar user={selected} size={54} />
            <div><h2 id="admin-user-drawer-title">{selected.name || selected.email.split('@')[0]}</h2><p>{selected.email}</p>
              <div className="admin-user-meta">
                <span className={`role-badge ${selected.role}`}><Icon name={selected.role === 'admin' ? 'shield' : 'user'} size={12} />{t(`roles.${selected.role}`)}</span>
                <span className={`account-state ${selected.is_active ? 'active' : 'disabled'}`}><i />{t(selected.is_active ? 'filters.active' : 'filters.disabled')}</span>
                {selected.id === currentUser.id && <em>{t('self')}</em>}
              </div>
            </div>
          </div>
          <button className="admin-user-drawer-close" aria-label={t('common:actions.close')} onClick={closeUser}>×</button>
        </header>
        <nav className="admin-user-tabs" aria-label={t('detail.title')}>
          {([
            ['account', 'user', 'detail.tabs.account'],
            ['teams', 'users', 'detail.tabs.teams'],
            ['usage', 'analytics', 'detail.tabs.usage'],
            ['security', 'lock', 'detail.tabs.security'],
          ] as const).map(([tab, icon, label]) => <button key={tab} className={detailTab === tab ? 'active' : ''} onClick={() => setDetailTab(tab)}><Icon name={icon} />{t(label)}</button>)}
        </nav>
        <div className="admin-user-drawer-body">
          {message && <div className="success admin-user-feedback"><Icon name="check" />{message}</div>}
          {error && <div className="error admin-user-feedback">{error}</div>}
          {detailTab === 'account' && <section className="admin-user-section">
            <div className="admin-user-section-title"><span><Icon name="user" /></span><div><h3>{t('detail.account')}</h3><p>{t('detail.accountHelp')}</p></div></div>
            <form className="admin-user-profile-form" onSubmit={saveUser}>
              <div className="admin-user-form-grid">
                <label>{t('detail.name')}<input maxLength={100} value={draft.name} onChange={event => setDraft(value => ({ ...value, name: event.target.value }))} /></label>
                <label>{t('detail.email')}<input type="email" required value={draft.email} onChange={event => setDraft(value => ({ ...value, email: event.target.value }))} /></label>
                <label>{t('detail.role')}<select disabled={selected.id === currentUser.id} value={draft.role} onChange={event => setDraft(value => ({ ...value, role: event.target.value as UserRole }))}><option value="user">{t('roles.user')}</option><option value="admin">{t('roles.admin')}</option></select></label>
                <label>{t('detail.status')}<select disabled={selected.id === currentUser.id} value={draft.is_active ? 'active' : 'disabled'} onChange={event => setDraft(value => ({ ...value, is_active: event.target.value === 'active' }))}><option value="active">{t('filters.active')}</option><option value="disabled">{t('filters.disabled')}</option></select></label>
                <label>{t('detail.language')}<select value={draft.ui_locale} onChange={event => setDraft(value => ({ ...value, ui_locale: event.target.value as Locale }))}><option value="zh-CN">{t('common:language.zh-CN')}</option><option value="en">{t('common:language.en')}</option></select></label>
                <label>{t('table.created')}<input disabled value={formatDate(selected.created_at, locale)} /></label>
              </div>
              {selected.id === currentUser.id && <p className="admin-user-self-note"><Icon name="lock" />{t('detail.selfProtection')}</p>}
              <footer><button className="primary icon-button" disabled={busy}><Icon name="check" />{busy ? t('saving') : t('common:actions.save')}</button></footer>
            </form>
          </section>}
          {detailTab === 'teams' && <section className="admin-user-section">
            <div className="admin-user-section-title"><span><Icon name="users" /></span><div><h3>{t('teams.title')}</h3><p>{t('teams.description')}</p></div></div>
            {organizations.some(organization => !selected.memberships.some(membership => membership.organization_id === organization.id))
              ? <form className="admin-membership-add" onSubmit={addMembership}><label>{t('teams.organization')}<select required value={membershipOrganization} onChange={event => setMembershipOrganization(event.target.value)}><option value="">{t('teams.selectOrganization')}</option>{organizations.filter(organization => !selected.memberships.some(membership => membership.organization_id === organization.id)).map(organization => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label><label>{t('teams.role')}<select value={membershipRole} onChange={event => setMembershipRole(event.target.value as OrganizationRole)}><option value="owner">{t('organizations.roles.owner')}</option><option value="admin">{t('organizations.roles.admin')}</option><option value="editor">{t('organizations.roles.editor')}</option><option value="viewer">{t('organizations.roles.viewer')}</option></select></label><button className="primary icon-button" disabled={membershipBusy === 'add'}>{membershipBusy === 'add' ? <span className="action-spinner" /> : <Icon name="plus" />}{t('teams.add')}</button></form>
              : <div className="admin-membership-all-linked"><Icon name="check" />{t('teams.allLinked')}</div>}
            <div className="admin-membership-list">{selected.memberships.map(membership => <article key={membership.id}><span><Icon name={membership.organization_kind === 'personal' ? 'user' : 'users'} /></span><div><strong>{membership.organization_name}</strong><small>{membership.organization_slug}</small><div>{membership.organization_kind === 'personal' && <em>{t('teams.personal')}</em>}{membership.is_current && <em>{t('teams.current')}</em>}<b>{t(`organizations.roles.${membership.role}`)}</b></div></div><select aria-label={t('teams.role')} value={membership.role} disabled={membershipBusy === membership.id || membership.organization_kind === 'personal'} onChange={event => updateMembership(membership.id, event.target.value as OrganizationRole)}><option value="owner">{t('organizations.roles.owner')}</option><option value="admin">{t('organizations.roles.admin')}</option><option value="editor">{t('organizations.roles.editor')}</option><option value="viewer">{t('organizations.roles.viewer')}</option></select><button className="admin-membership-remove" title={t('teams.remove')} aria-label={t('teams.remove')} disabled={membershipBusy === membership.id || membership.organization_kind === 'personal'} onClick={() => removeMembership(membership.id, membership.organization_name)}><Icon name="delete" /></button></article>)}</div>
            <p className="admin-membership-note"><Icon name="shield" />{t('teams.platformRoleNote')}</p>
          </section>}
          {detailTab === 'usage' && <section className="admin-user-section">
            <div className="admin-user-section-title"><span><Icon name="analytics" /></span><div><h3>{t('detail.resources')}</h3><p>{t('detail.usageHelp')}</p></div></div>
            <div className="admin-user-stat-grid">{([
              ['folder', 'demos', selected.stats.demos], ['list', 'steps', selected.stats.steps], ['publish', 'published', selected.stats.published_demos], ['eye', 'views', selected.stats.views], ['users', 'viewers', selected.stats.unique_viewers], ['download', 'exports', selected.stats.exports],
            ] as const).map(([icon, label, value]) => <article key={label}><span><Icon name={icon} /></span><div><small>{t(`detail.${label}`)}</small><strong>{formatNumber(value, locale)}</strong></div></article>)}</div>
            <div className="admin-user-storage"><span><Icon name="database" /></span><div><small>{t('detail.storage')}</small><strong>{formatBytes(selected.stats.storage_bytes, locale)}</strong></div></div>
          </section>}
          {detailTab === 'security' && <section className="admin-user-section">
            <div className="admin-user-section-title warm"><span><Icon name="lock" /></span><div><h3>{t('security.title')}</h3><p>{t('security.description')}</p></div></div>
            <div className="admin-user-security-card">
              <div><strong>{t('security.reset')}</strong><p>{t('security.resetHelp')}</p></div>
              <form onSubmit={resetPassword}><label>{t('security.newPassword')}<input type="password" minLength={8} required value={password} onChange={event => setPassword(event.target.value)} placeholder={t('security.passwordPlaceholder')} /></label><button className="secondary icon-button" disabled={passwordBusy || selected.id === currentUser.id}><Icon name="lock" />{passwordBusy ? t('security.resetting') : t('security.reset')}</button></form>
              {selected.id === currentUser.id && <p className="admin-user-self-note"><Icon name="lock" />{t('security.selfResetHint')}</p>}
            </div>
            {selected.id !== currentUser.id && <div className="admin-user-danger-card"><span><Icon name="warning" /></span><div><strong>{t('security.delete')}</strong><p>{t('security.deleteHint')}</p></div><button className="danger icon-button" disabled={busy} onClick={removeUser}><Icon name="delete" />{t('common:actions.delete')}</button></div>}
          </section>}
        </div>
      </aside>
    </>}
  </main>
}
