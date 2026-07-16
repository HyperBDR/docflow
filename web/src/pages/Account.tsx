import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, NavLink, useLocation } from 'react-router-dom'
import { api } from '../api'
import Icon from '../components/Icon'
import UserAvatar from '../components/UserAvatar'
import Brand from '../components/Brand'
import { useToast } from '../components/toast'
import { LAST_WORKSPACE_KEY } from '../components/AccountMenu'
import { applyLocale } from '../i18n'
import type { Locale, User } from '../types'

export default function Account({ user, onUserChange, onPasswordChanged }: { user: User; onUserChange: (user: User) => void; onPasswordChanged: () => void }) {
  const { t } = useTranslation(['account', 'common'])
  const toast = useToast()
  const [name, setName] = useState(user.name)
  const [locale, setLocale] = useState<Locale>(user.ui_locale)
  const [profileBusy, setProfileBusy] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const location = useLocation()
  const tab = location.pathname.split('/')[2] || 'profile'
  const requestedFrom = new URLSearchParams(location.search).get('from')
  const source = requestedFrom === 'admin' && user.role === 'admin' ? 'admin' : requestedFrom === 'user' ? 'user' : localStorage.getItem(LAST_WORKSPACE_KEY) === 'admin' && user.role === 'admin' ? 'admin' : 'user'
  const suffix = `?from=${source}`

  useEffect(() => { setName(user.name); setLocale(user.ui_locale) }, [user])

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault()
    setProfileBusy(true); setProfileError('')
    try {
      const updated = await api.updateProfile({ name, ui_locale: locale })
      await applyLocale(updated.ui_locale)
      onUserChange(updated)
      toast.success(t('profile.saved'))
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : t('common:errors.operationFailed'))
    } finally { setProfileBusy(false) }
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault()
    setPasswordError('')
    if (newPassword !== confirmPassword) { setPasswordError(t('security.mismatch')); return }
    setPasswordBusy(true)
    try {
      await api.changePassword(currentPassword, newPassword)
      onPasswordChanged()
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : t('common:errors.operationFailed'))
      setPasswordBusy(false)
    }
  }

  if (location.pathname === '/account' || !['profile', 'security', 'preferences'].includes(tab)) return <Navigate to={`/account/profile${suffix}`} replace />
  return <div className="settings-shell">
    <header className="settings-topbar"><Link to={source === 'admin' ? '/admin' : '/'} className="brand"><Brand /></Link><Link className="settings-back" to={source === 'admin' ? '/admin' : '/'}><Icon name="chevronLeft" />{source === 'admin' ? t('backToAdmin') : t('backToWorkspace')}</Link></header>
    <main className="settings-center">
      <div className="settings-heading"><div className="settings-heading-icon"><Icon name="settings" size={22} /></div><div><h1>{t('title')}</h1><p>{t('subtitle')}</p></div></div>
      <div className="settings-layout">
        <aside className="settings-navigation"><div className="settings-user-summary"><UserAvatar user={user} size={50} /><span><strong>{user.name || user.email.split('@')[0]}</strong><small>{user.email}</small></span></div><nav>
          <NavLink to={`/account/profile${suffix}`}><Icon name="user" /><span>{t('profile.title')}</span><Icon name="chevronRight" /></NavLink>
          <NavLink to={`/account/security${suffix}`}><Icon name="lock" /><span>{t('security.title')}</span><Icon name="chevronRight" /></NavLink>
          <NavLink to={`/account/preferences${suffix}`}><Icon name="globe" /><span>{t('preferences.title')}</span><Icon name="chevronRight" /></NavLink>
        </nav></aside>
        <section className="settings-card settings-content-card">
          {tab === 'profile' && <><header><div><h2>{t('profile.title')}</h2><p>{t('profile.description')}</p></div><UserAvatar user={user} size={52} /></header><form onSubmit={saveProfile} className="settings-form"><label>{t('profile.name')}<input maxLength={100} value={name} onChange={event => setName(event.target.value)} placeholder={t('profile.namePlaceholder')} /></label><label>{t('profile.email')}<input value={user.email} disabled /></label><p className="field-help"><Icon name="lock" size={13} />{t('profile.emailHint')}</p>{profileError && <div className="error">{profileError}</div>}<div className="form-actions"><button className="primary icon-button" disabled={profileBusy}><Icon name="check" />{profileBusy ? t('saving') : t('common:actions.save')}</button></div></form></>}
          {tab === 'preferences' && <><header><div className="settings-card-icon"><Icon name="globe" size={20} /></div><div><h2>{t('preferences.title')}</h2><p>{t('preferences.description')}</p></div></header><form onSubmit={saveProfile} className="settings-form"><label>{t('preferences.language')}<select value={locale} onChange={event => setLocale(event.target.value as Locale)}><option value="zh-CN">{t('common:language.zh-CN')}</option><option value="en">{t('common:language.en')}</option></select></label><p className="field-help">{t('preferences.languageHint')}</p>{profileError && <div className="error">{profileError}</div>}<div className="form-actions"><button className="primary icon-button" disabled={profileBusy}><Icon name="check" />{profileBusy ? t('saving') : t('common:actions.save')}</button></div></form></>}
          {tab === 'security' && <><header><div className="settings-card-icon warm"><Icon name="lock" size={20} /></div><div><h2>{t('security.title')}</h2><p>{t('security.description')}</p></div></header><form onSubmit={changePassword} className="settings-form"><label>{t('security.currentPassword')}<input type="password" minLength={8} maxLength={128} required value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} autoComplete="current-password" /></label><label>{t('security.newPassword')}<input type="password" minLength={8} maxLength={128} required value={newPassword} onChange={event => setNewPassword(event.target.value)} placeholder={t('security.passwordHint')} autoComplete="new-password" /></label><label>{t('security.confirmPassword')}<input type="password" minLength={8} maxLength={128} required value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} autoComplete="new-password" /></label>{passwordError && <div className="error">{passwordError}</div>}<div className="form-actions"><button className="primary icon-button" disabled={passwordBusy}><Icon name="lock" />{passwordBusy ? t('changing') : t('security.change')}</button></div></form></>}
        </section>
      </div>
    </main>
  </div>
}
