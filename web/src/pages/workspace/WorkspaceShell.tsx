import { useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import AccountMenu, { LAST_WORKSPACE_KEY } from '../../components/AccountMenu'
import Brand from '../../components/Brand'
import Icon from '../../components/Icon'
import LanguageSwitcher from '../../components/LanguageSwitcher'
import WorkspaceSwitcher from '../../components/WorkspaceSwitcher'
import type { User } from '../../types'
import Dashboard from '../Dashboard'
import WorkspaceOverview from './WorkspaceOverview'
import WorkspaceTasks from './WorkspaceTasks'
import '../../styles/workspace.css'

export default function WorkspaceShell({ user, onUserChange, logout }: { user: User; onUserChange: (user: User) => void; logout: () => void }) {
  const { t } = useTranslation('workspace')
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  useEffect(() => { localStorage.setItem(LAST_WORKSPACE_KEY, 'user'); setMobileOpen(false) }, [location.pathname])
  const organizationKey = user.active_organization_id || user.current_organization_id || user.id
  return <div className={`workspace-shell ${mobileOpen ? 'mobile-open' : ''}`}>
    <aside className="workspace-primary-nav">
      <div className="workspace-nav-brand"><Brand /><button onClick={() => setMobileOpen(false)} aria-label={t('nav.close')}>×</button></div>
      <nav aria-label={t('nav.label')}>
        <NavLink end to="/"><Icon name="folder" /><span>{t('nav.library')}</span></NavLink>
        <NavLink to="/overview"><Icon name="analytics" /><span>{t('nav.overview')}</span></NavLink>
        <NavLink to="/tasks"><Icon name="clock" /><span>{t('nav.tasks')}</span></NavLink>
      </nav>
      <footer><small>{t('nav.workspace')}</small><WorkspaceSwitcher user={user} onUserChange={onUserChange} /></footer>
    </aside>
    <button className="workspace-nav-backdrop" aria-label={t('nav.close')} onClick={() => setMobileOpen(false)} />
    <div className="workspace-shell-main">
      <header className="workspace-header"><button className="workspace-mobile-menu" onClick={() => setMobileOpen(true)} aria-label={t('nav.open')}><Icon name="menu" /></button><div className="workspace-mobile-brand"><Brand /></div><div className="topbar-account-actions"><LanguageSwitcher account /><AccountMenu user={user} view="user" onUserChange={onUserChange} logout={logout} /></div></header>
      <div key={organizationKey} className="workspace-route-content"><Routes>
        <Route index element={<Dashboard />} />
        <Route path="overview" element={<WorkspaceOverview />} />
        <Route path="tasks" element={<WorkspaceTasks />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes></div>
    </div>
  </div>
}
