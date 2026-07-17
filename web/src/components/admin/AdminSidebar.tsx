import {
  autoUpdate,
  FloatingPortal,
  offset,
  shift,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
} from '@floating-ui/react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LAST_WORKSPACE_KEY } from '../AccountMenu'
import Brand from '../Brand'
import Icon, { type IconName } from '../Icon'

function SidebarTooltip({ children, className = '', enabled, label }: {
  children: ReactNode
  className?: string
  enabled: boolean
  label: string
}) {
  const [open, setOpen] = useState(false)
  const { context, floatingStyles, refs } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'right',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [offset(11), shift({ padding: 8 })],
  })
  const hover = useHover(context, { enabled, move: false, delay: { open: 180, close: 60 } })
  const focus = useFocus(context, { enabled })
  const role = useRole(context, { role: 'tooltip' })
  const { getFloatingProps, getReferenceProps } = useInteractions([hover, focus, role])

  useEffect(() => { if (!enabled) setOpen(false) }, [enabled])

  return <>
    <span className={`admin-sidebar-tooltip-anchor ${className}`.trim()} ref={refs.setReference} {...getReferenceProps()}>{children}</span>
    {enabled && open && <FloatingPortal><span className="admin-sidebar-tooltip" ref={refs.setFloating} style={floatingStyles} {...getFloatingProps()}>{label}</span></FloatingPortal>}
  </>
}

function SidebarLink({ collapsed, end, icon, label, to }: {
  collapsed: boolean
  end?: boolean
  icon: IconName
  label: string
  to: string
}) {
  return <SidebarTooltip enabled={collapsed} label={label}>
    <NavLink end={end} to={to} aria-label={label}><Icon name={icon} /><span>{label}</span></NavLink>
  </SidebarTooltip>
}

export default function AdminSidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { t } = useTranslation('admin')
  const toggleLabel = t(collapsed ? 'nav.expand' : 'nav.collapse')
  const workspaceLabel = t('common:workspace.backToUser')

  return <aside className="admin-sidebar">
    <div className="admin-sidebar-brand">
      <Brand />
      <SidebarTooltip className="admin-sidebar-toggle" enabled={collapsed} label={toggleLabel}>
        <button type="button" onClick={onToggle} aria-label={toggleLabel} aria-expanded={!collapsed}><Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} /></button>
      </SidebarTooltip>
    </div>
    <div className="admin-sidebar-label">{t('nav.platform')}</div>
    <nav aria-label={t('nav.platform')}>
      <SidebarLink collapsed={collapsed} end to="/admin" icon="grid" label={t('nav.overview')} />
      <SidebarLink collapsed={collapsed} to="/admin/jobs" icon="list" label={t('nav.jobs')} />
      <SidebarLink collapsed={collapsed} to="/admin/monitoring" icon="analytics" label={t('nav.monitoring')} />
      <div className="admin-nav-separator"><span>{t('nav.accounts')}</span></div>
      <SidebarLink collapsed={collapsed} to="/admin/organizations" icon="users" label={t('nav.organizations')} />
      <SidebarLink collapsed={collapsed} to="/admin/users" icon="user" label={t('nav.users')} />
      <div className="admin-nav-separator"><span>{t('nav.content')}</span></div>
      <SidebarLink collapsed={collapsed} to="/admin/resources" icon="folder" label={t('nav.resources')} />
      <SidebarLink collapsed={collapsed} to="/admin/storage" icon="database" label={t('nav.storage')} />
      <SidebarLink collapsed={collapsed} to="/admin/recycle" icon="delete" label={t('nav.recycle')} />
      <div className="admin-nav-separator"><span>{t('nav.ai')}</span></div>
      <SidebarLink collapsed={collapsed} to="/admin/ai/settings" icon="settings" label={t('nav.aiSettings')} />
      <SidebarLink collapsed={collapsed} to="/admin/ai/models" icon="ai" label={t('nav.aiModels')} />
      <SidebarLink collapsed={collapsed} to="/admin/ai/usage" icon="analytics" label={t('nav.aiUsage')} />
      <div className="admin-nav-separator"><span>{t('nav.system')}</span></div>
      <SidebarLink collapsed={collapsed} to="/admin/settings" icon="settings" label={t('nav.settings')} />
      <div className="admin-nav-separator"><span>{t('nav.security')}</span></div>
      <SidebarLink collapsed={collapsed} to="/admin/audit" icon="clock" label={t('nav.audit')} />
    </nav>
    <SidebarTooltip className="admin-sidebar-foot-anchor" enabled={collapsed} label={workspaceLabel}>
      <Link className="admin-sidebar-foot" to="/" aria-label={workspaceLabel} onClick={() => localStorage.setItem(LAST_WORKSPACE_KEY, 'user')}>
        <Icon name="home" /><span><strong>{workspaceLabel}</strong><small>{t('nav.workspaceHint')}</small></span>
      </Link>
    </SidebarTooltip>
  </aside>
}
