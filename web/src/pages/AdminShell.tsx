import { useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import AccountMenu, { LAST_WORKSPACE_KEY } from '../components/AccountMenu'
import Brand from '../components/Brand'
import Icon from '../components/Icon'
import LanguageSwitcher from '../components/LanguageSwitcher'
import type { User } from '../types'
import AdminUsers from './Admin'
import AdminOverview from './AdminOverview'
import AdminResources from './AdminResources'
import AdminResourceDetail from './AdminResourceDetail'
import AdminOrganizations from './AdminOrganizations'
import AdminAudit from './AdminAudit'
import AdminRecycle from './AdminRecycle'
import AdminAIModels from './AdminAIModels'
import AdminAIUsage from './AdminAIUsage'
import AdminAISettings from './AdminAISettings'
import AdminStorage from './AdminStorage'
import AdminJobs from './AdminJobs'

export default function AdminShell({ user, onUserChange, logout }: { user: User; onUserChange: (user: User) => void; logout: () => void }) {
  const { t } = useTranslation('admin')
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('docflow.adminSidebar') === 'collapsed')
  const [mobileOpen, setMobileOpen] = useState(false)
  useEffect(() => { localStorage.setItem(LAST_WORKSPACE_KEY, 'admin'); setMobileOpen(false) }, [location.pathname])
  const title = location.pathname.startsWith('/admin/resources/') ? t('resource.detailTitle')
    : location.pathname.startsWith('/admin/jobs') ? t('nav.jobs')
    : location.pathname.startsWith('/admin/storage') ? t('nav.storage')
    : location.pathname.startsWith('/admin/ai/settings') ? t('nav.aiSettings')
      : location.pathname.startsWith('/admin/ai/usage') ? t('nav.aiUsage')
      : location.pathname.startsWith('/admin/ai/models') ? t('nav.aiModels')
    : location.pathname.startsWith('/admin/resources') ? t('nav.resources')
      : location.pathname.startsWith('/admin/users') ? t('nav.users')
        : location.pathname.startsWith('/admin/organizations') ? t('nav.organizations')
          : location.pathname.startsWith('/admin/audit') ? t('nav.audit')
            : location.pathname.startsWith('/admin/recycle') ? t('nav.recycle') : t('nav.overview')
  const toggle = () => setCollapsed(value => { localStorage.setItem('docflow.adminSidebar', value ? 'expanded' : 'collapsed'); return !value })
  return <div className={`admin-shell ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
    <aside className="admin-sidebar">
      <div className="admin-sidebar-brand"><Brand /><button onClick={toggle} aria-label={t('nav.collapse')}><Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} /></button></div>
      <div className="admin-sidebar-label">{t('nav.platform')}</div>
      <nav aria-label={t('nav.platform')}>
        <NavLink end to="/admin" title={t('nav.overview')}><Icon name="grid" /><span>{t('nav.overview')}</span></NavLink>
        <NavLink to="/admin/jobs" title={t('nav.jobs')}><Icon name="list" /><span>{t('nav.jobs')}</span></NavLink>
        <div className="admin-nav-separator"><span>{t('nav.accounts')}</span></div>
        <NavLink to="/admin/organizations" title={t('nav.organizations')}><Icon name="users" /><span>{t('nav.organizations')}</span></NavLink>
        <NavLink to="/admin/users" title={t('nav.users')}><Icon name="user" /><span>{t('nav.users')}</span></NavLink>
        <div className="admin-nav-separator"><span>{t('nav.content')}</span></div>
        <NavLink to="/admin/resources" title={t('nav.resources')}><Icon name="folder" /><span>{t('nav.resources')}</span></NavLink>
        <NavLink to="/admin/storage" title={t('nav.storage')}><Icon name="database" /><span>{t('nav.storage')}</span></NavLink>
        <NavLink to="/admin/recycle" title={t('nav.recycle')}><Icon name="delete" /><span>{t('nav.recycle')}</span></NavLink>
        <div className="admin-nav-separator"><span>{t('nav.ai')}</span></div>
        <NavLink to="/admin/ai/settings" title={t('nav.aiSettings')}><Icon name="settings" /><span>{t('nav.aiSettings')}</span></NavLink>
        <NavLink to="/admin/ai/models" title={t('nav.aiModels')}><Icon name="ai" /><span>{t('nav.aiModels')}</span></NavLink>
        <NavLink to="/admin/ai/usage" title={t('nav.aiUsage')}><Icon name="analytics" /><span>{t('nav.aiUsage')}</span></NavLink>
        <div className="admin-nav-separator"><span>{t('nav.security')}</span></div>
        <NavLink to="/admin/audit" title={t('nav.audit')}><Icon name="clock" /><span>{t('nav.audit')}</span></NavLink>
      </nav>
      <div className="admin-sidebar-foot"><Icon name="shield" /><span><strong>DocFlow Admin</strong><small>{t('nav.secure')}</small></span></div>
    </aside>
    <button className="admin-sidebar-scrim" aria-label={t('common:actions.close')} onClick={() => setMobileOpen(false)} />
    <div className="admin-shell-main">
      <header className="admin-topbar"><div><button className="admin-mobile-menu" onClick={() => setMobileOpen(true)}><Icon name="menu" /></button><span><small>DocFlow Admin</small><strong>{title}</strong></span></div><div className="topbar-account-actions"><LanguageSwitcher account /><AccountMenu user={user} view="admin" onUserChange={onUserChange} logout={logout} /></div></header>
      <div className="admin-route-content"><Routes>
        <Route index element={<AdminOverview />} />
        <Route path="jobs" element={<AdminJobs />} />
        <Route path="users" element={<AdminUsers currentUser={user} onCurrentUserChange={onUserChange} />} />
        <Route path="resources" element={<AdminResources />} />
        <Route path="resources/:id" element={<AdminResourceDetail />} />
        <Route path="organizations" element={<AdminOrganizations user={user} onUserChange={onUserChange} />} />
        <Route path="audit" element={<AdminAudit />} />
        <Route path="recycle" element={<AdminRecycle />} />
        <Route path="ai/models" element={<AdminAIModels />} />
        <Route path="ai/settings" element={<AdminAISettings />} />
        <Route path="ai/usage" element={<AdminAIUsage />} />
        <Route path="storage" element={<AdminStorage />} />
        <Route path="*" element={<Navigate to="/admin" />} />
      </Routes></div>
    </div>
  </div>
}
