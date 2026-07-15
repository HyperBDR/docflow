import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import { applyLocale, normalizeLocale } from '../i18n'
import type { Locale, Organization, User } from '../types'
import Icon from './Icon'
import UserAvatar from './UserAvatar'

export const LAST_WORKSPACE_KEY = 'docflow.lastWorkspace'

export default function AccountMenu({ user, view, onUserChange, logout }: {
  user: User
  view: 'user' | 'admin'
  onUserChange: (user: User) => void
  logout: () => void
}) {
  const { t, i18n } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const root = useRef<HTMLDivElement>(null)
  const locale = normalizeLocale(i18n.language)
  const activeOrganization = organizations.find(item => item.id === (user.active_organization_id || user.current_organization_id))

  useEffect(() => {
    if (!open) return
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', outside); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  useEffect(() => { if (open) api.organizations().then(setOrganizations).catch(() => undefined) }, [open])

  async function changeLanguage(next: Locale) {
    if (next === locale) return
    await applyLocale(next)
    try { onUserChange(await api.updateLocale(next)) } catch { /* local preference remains usable */ }
  }

  function switchWorkspace(next: 'user' | 'admin') {
    localStorage.setItem(LAST_WORKSPACE_KEY, next)
    setOpen(false)
  }

  async function switchOrganization(id: string) {
    const updated = await api.switchOrganization(id)
    onUserChange(updated); setOpen(false)
    if (view === 'user') window.location.assign('/')
  }

  return <div className="account-menu" ref={root}>
    <button className="account-menu-trigger" type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <UserAvatar user={user} size={36} />
      <span><strong>{user.name || user.email.split('@')[0]}</strong><small>{view === 'admin' ? t('workspace.adminView') : t('workspace.userView')}</small></span>
      <b aria-hidden>⌄</b>
    </button>
    {open && <div className="account-menu-popover" role="menu">
      <div className="account-menu-identity"><UserAvatar user={user} size={42} /><span><strong>{user.name || user.email.split('@')[0]}</strong><small>{user.email}</small></span></div>
      <div className="account-menu-section">
        <Link to={`/account/profile?from=${view}`} onClick={() => setOpen(false)}><Icon name="settings" /><span>{t('navigation.account')}</span></Link>
        {view === 'user' && activeOrganization?.kind === 'team' && (activeOrganization.access_source === 'platform_admin' || ['owner', 'admin'].includes(activeOrganization.role)) && <Link to={`/spaces/${activeOrganization.id}`} onClick={() => setOpen(false)}><Icon name="users" /><span>{t('organization.manage')}</span></Link>}
        {user.role === 'admin' && (view === 'admin'
          ? <Link to="/" onClick={() => switchWorkspace('user')}><Icon name="home" /><span>{t('workspace.backToUser')}</span></Link>
          : <Link to="/admin" onClick={() => switchWorkspace('admin')}><Icon name="shield" /><span>{t('workspace.enterAdmin')}</span></Link>)}
      </div>
      <div className="account-menu-organization">
        <div className="account-menu-organization-heading"><span><Icon name="users" />{t('organization.label')}</span></div>
        {organizations.length > 0 && <select value={user.active_organization_id || user.current_organization_id || ''} onChange={event => switchOrganization(event.target.value)}><optgroup label={t('organization.personalGroup')}>{organizations.filter(item => item.kind === 'personal').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup><optgroup label={t('organization.teamGroup')}>{organizations.filter(item => item.kind === 'team').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup></select>}
      </div>
      <div className="account-menu-language"><span><Icon name="globe" />{t('language.label')}</span><div>{(['zh-CN', 'en'] as Locale[]).map(item => <button key={item} className={locale === item ? 'active' : ''} onClick={() => changeLanguage(item)}>{item === 'zh-CN' ? '中文' : 'EN'}</button>)}</div></div>
      <div className="account-menu-section"><button className="account-menu-logout" onClick={() => { setOpen(false); logout() }}><Icon name="logout" /><span>{t('actions.logout')}</span></button></div>
    </div>}
  </div>
}
