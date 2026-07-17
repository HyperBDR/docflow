import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { API_URL, api } from '../../api'
import type { GoogleIdentity, User } from '../../types'
import Icon from '../Icon'
import { useToast } from '../toast'

export default function AccountSecurity({ user, source, onPasswordChanged }: {
  user: User
  source: 'admin' | 'user'
  onPasswordChanged: () => void
}) {
  const { t } = useTranslation(['account', 'common', 'auth'])
  const toast = useToast()
  const location = useLocation()
  const navigate = useNavigate()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [googleEnabled, setGoogleEnabled] = useState(false)
  const [googleIdentity, setGoogleIdentity] = useState<GoogleIdentity | null>(null)
  const [googleBusy, setGoogleBusy] = useState(false)
  const [googleError, setGoogleError] = useState('')

  useEffect(() => {
    Promise.all([api.googleAuthConfig(), api.googleIdentity()]).then(([config, identity]) => {
      setGoogleEnabled(config.enabled)
      setGoogleIdentity(identity)
    }).catch(reason => setGoogleError(reason instanceof Error ? reason.message : t('common:errors.operationFailed')))
  }, [t])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const result = params.get('oauth')
    const oauthError = params.get('oauth_error')
    if (result === 'google_linked') {
      toast.success(t('security.google.linked'))
      api.googleIdentity().then(setGoogleIdentity).catch(() => undefined)
    } else if (oauthError) {
      setGoogleError(t(`auth:google.errors.${oauthError}`, { defaultValue: t('security.google.linkFailed') }))
    } else return
    params.delete('oauth'); params.delete('oauth_error')
    navigate(`${location.pathname}${params.size ? `?${params}` : ''}`, { replace: true })
  }, [location.pathname, location.search, navigate, t, toast])

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

  function linkGoogle() {
    const returnTo = `/account/security?${new URLSearchParams({ from: source })}`
    window.location.assign(`${API_URL}/api/auth/google/link/start?${new URLSearchParams({ return_to: returnTo })}`)
  }

  async function unlinkGoogle() {
    if (!window.confirm(t('security.google.unlinkConfirm'))) return
    setGoogleBusy(true); setGoogleError('')
    try {
      await api.unlinkGoogle()
      setGoogleIdentity(null)
      toast.success(t('security.google.unlinked'))
    } catch (reason) {
      setGoogleError(reason instanceof Error ? reason.message : t('common:errors.operationFailed'))
    } finally { setGoogleBusy(false) }
  }

  return <>
    <header><div className="settings-card-icon warm"><Icon name="lock" size={20} /></div><div><h2>{t('security.title')}</h2><p>{t('security.description')}</p></div></header>
    <div className="security-methods">
      <section className="security-method">
        <div className="security-method-heading"><span><Icon name="lock" /></span><div><strong>{t('security.passwordTitle')}</strong><small>{t(user.password_configured !== false ? 'security.passwordConfigured' : 'security.passwordUnavailable')}</small></div></div>
        {user.password_configured !== false ? <form onSubmit={changePassword} className="settings-form">
          <label>{t('security.currentPassword')}<input type="password" minLength={8} maxLength={128} required value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} autoComplete="current-password" /></label>
          <label>{t('security.newPassword')}<input type="password" minLength={8} maxLength={128} required value={newPassword} onChange={event => setNewPassword(event.target.value)} placeholder={t('security.passwordHint')} autoComplete="new-password" /></label>
          <label>{t('security.confirmPassword')}<input type="password" minLength={8} maxLength={128} required value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} autoComplete="new-password" /></label>
          {passwordError && <div className="error">{passwordError}</div>}
          <div className="form-actions"><button className="primary icon-button" disabled={passwordBusy}><Icon name="lock" />{passwordBusy ? t('changing') : t('security.change')}</button></div>
        </form> : <p className="security-method-note">{t('security.passwordGoogleOnly')}</p>}
      </section>
      <section className="security-method">
        <div className="security-method-heading"><span className="google-mark">G</span><div><strong>{t('security.google.title')}</strong><small>{t(googleIdentity ? 'security.google.connected' : googleEnabled ? 'security.google.available' : 'security.google.disabled')}</small></div></div>
        {googleError && <div className="error security-method-error">{googleError}</div>}
        {googleIdentity ? <div className="google-identity">
          <div className="google-identity-profile">{googleIdentity.avatar_url ? <img src={googleIdentity.avatar_url} alt="" referrerPolicy="no-referrer"/> : <span>{googleIdentity.email[0].toUpperCase()}</span>}<div><strong>{googleIdentity.display_name || googleIdentity.email}</strong><small>{googleIdentity.email}</small></div></div>
          <button className="danger icon-button" disabled={googleBusy || !googleIdentity.can_unlink} onClick={unlinkGoogle}><Icon name="unlink"/>{t('security.google.unlink')}</button>
          {!googleIdentity.can_unlink && <p>{t('security.google.lastMethod')}</p>}
        </div> : <div className="google-connect"><p>{t('security.google.connectHint')}</p><button className="icon-button" disabled={!googleEnabled || googleBusy} onClick={linkGoogle}><Icon name="link"/>{t('security.google.connect')}</button></div>}
      </section>
    </div>
  </>
}
