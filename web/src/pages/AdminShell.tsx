import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import AccountMenu, { LAST_WORKSPACE_KEY } from '../components/AccountMenu'
import Icon from '../components/Icon'
import LanguageSwitcher from '../components/LanguageSwitcher'
import HelpLink from '../components/HelpLink'
import AdminSidebar from '../components/admin/AdminSidebar'
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
import PlatformSettings from './PlatformSettings'
import AdminQuotas from './AdminQuotas'
import MonitoringOverview from './monitoring/MonitoringOverview'
import AlertEvents from './monitoring/AlertEvents'
import AlertRules from './monitoring/AlertRules'
import NotificationChannels from './monitoring/NotificationChannels'
import NotificationBell from '../components/notifications/NotificationBell'
import NotificationCenter from './NotificationCenter'

export default function AdminShell({ user, onUserChange, logout }: { user: User; onUserChange: (user: User) => void; logout: () => void }) {
  const { t } = useTranslation('admin')
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('docflow.adminSidebar') === 'collapsed')
  const [mobileOpen, setMobileOpen] = useState(false)
  useEffect(() => { localStorage.setItem(LAST_WORKSPACE_KEY, 'admin'); setMobileOpen(false) }, [location.pathname])
  const title = location.pathname.startsWith('/admin/resources/') ? t('resource.detailTitle')
    : location.pathname.startsWith('/admin/settings') ? t('nav.settings')
    : location.pathname.startsWith('/admin/monitoring') ? t('nav.monitoring')
    : location.pathname.startsWith('/admin/jobs') ? t('nav.jobs')
    : location.pathname.startsWith('/admin/notifications') ? t('nav.notifications')
    : location.pathname.startsWith('/admin/storage') ? t('nav.storage')
    : location.pathname.startsWith('/admin/operations/quotas') ? t('nav.quotas')
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
    <AdminSidebar collapsed={collapsed} onToggle={toggle} />
    <button className="admin-sidebar-scrim" aria-label={t('common:actions.close')} onClick={() => setMobileOpen(false)} />
    <div className="admin-shell-main">
      <header className="admin-topbar"><div><button className="admin-mobile-menu" onClick={() => setMobileOpen(true)}><Icon name="menu" /></button><span><small>DocFlow Admin</small><strong>{title}</strong></span></div><div className="topbar-account-actions"><HelpLink/><LanguageSwitcher account /><NotificationBell scope="admin" /><AccountMenu user={user} view="admin" onUserChange={onUserChange} logout={logout} /></div></header>
      <div className="admin-route-content"><Routes>
        <Route index element={<AdminOverview />} />
        <Route path="jobs" element={<AdminJobs />} />
        <Route path="notifications" element={<NotificationCenter scope="admin" />} />
        <Route path="monitoring" element={<MonitoringOverview />} />
        <Route path="monitoring/alerts" element={<AlertEvents />} />
        <Route path="monitoring/rules" element={<AlertRules />} />
        <Route path="monitoring/channels" element={<NotificationChannels />} />
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
        <Route path="operations/quotas" element={<AdminQuotas />} />
        <Route path="settings" element={<PlatformSettings />} />
        <Route path="*" element={<Navigate to="/admin" />} />
      </Routes></div>
    </div>
  </div>
}
