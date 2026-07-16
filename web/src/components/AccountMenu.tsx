import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import type { Organization, User } from '../types'
import Icon from './Icon'
import UserAvatar from './UserAvatar'

export const LAST_WORKSPACE_KEY = 'docflow.lastWorkspace'

export default function AccountMenu({ user, view, onUserChange, logout }: {
  user: User
  view: 'user' | 'admin'
  onUserChange: (user: User) => void
  logout: () => void
}) {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const root = useRef<HTMLDivElement>(null)
  const activeOrganization = organizations.find(item => item.id === (user.active_organization_id || user.current_organization_id))

  useEffect(() => {
    if (!open) return
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', outside); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  useEffect(() => { if (open) api.organizations().then(setOrganizations).catch(() => undefined) }, [open])

  function switchWorkspace(next: 'user' | 'admin') {
    localStorage.setItem(LAST_WORKSPACE_KEY, next)
    setOpen(false)
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
      <div className="account-menu-section"><button className="account-menu-logout" onClick={() => { setOpen(false); logout() }}><Icon name="logout" /><span>{t('actions.logout')}</span></button></div>
    </div>}
  </div>
}
