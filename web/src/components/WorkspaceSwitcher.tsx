import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import type { Organization, User } from '../types'
import Icon from './Icon'

export default function WorkspaceSwitcher({ user, onUserChange }: { user: User; onUserChange: (user: User) => void }) {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const activeId = user.active_organization_id || user.current_organization_id || ''
  const active = organizations.find(item => item.id === activeId)

  useEffect(() => { api.organizations().then(setOrganizations).catch(() => setError(t('errors.requestFailed'))) }, [activeId, t])
  useEffect(() => {
    if (!open) return
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', outside); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape) }
  }, [open])

  async function switchTo(organization: Organization) {
    if (organization.id === activeId || busy) { setOpen(false); return }
    setBusy(organization.id); setError('')
    try {
      onUserChange(await api.switchOrganization(organization.id))
      setOpen(false)
      window.location.assign('/')
    } catch (value) {
      setError(value instanceof Error ? value.message : t('errors.operationFailed'))
      setBusy('')
    }
  }

  const group = (kind: 'personal' | 'team', label: string) => {
    const items = organizations.filter(item => item.kind === kind)
    if (!items.length) return null
    return <section><small>{label}</small>{items.map(item => <button type="button" role="menuitemradio" aria-checked={item.id === activeId} className={item.id === activeId ? 'active' : ''} key={item.id} disabled={Boolean(busy)} onClick={() => switchTo(item)}>
      <span><Icon name={item.kind === 'team' ? 'users' : 'user'} /></span><strong>{item.name}</strong>{busy === item.id ? <i className="action-spinner" /> : item.id === activeId ? <Icon name="check" size={14} /> : null}
    </button>)}</section>
  }

  return <div className="workspace-switcher" ref={root}>
    <button type="button" className="workspace-switcher-trigger" title={`${t('organization.label')} · ${active?.name || ''}`} aria-label={t('organization.label')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span><Icon name={active?.kind === 'team' ? 'users' : 'user'} size={16} /></span><span><small>{t('organization.label')}</small><strong>{active?.name || '—'}</strong></span><b aria-hidden>⌄</b>
    </button>
    {open && <div className="workspace-switcher-popover" role="menu">
      <header><Icon name="folder" /><span><small>{t('organization.label')}</small><strong>{active?.name || '—'}</strong></span></header>
      {group('personal', t('organization.personalGroup'))}{group('team', t('organization.teamGroup'))}
      {error && <p>{error}</p>}
    </div>}
  </div>
}
