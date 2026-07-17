import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { API_URL, api } from '../../api'
import { applyLocale, normalizeLocale } from '../../i18n'
import type { User } from '../../types'
import { LAST_WORKSPACE_KEY } from '../AccountMenu'
import Brand from '../Brand'
import HelpLink from '../HelpLink'
import Icon from '../Icon'
import LanguageSwitcher from '../LanguageSwitcher'
import '../../styles/auth.css'

export default function AuthPage({ onAuthenticated }: { onAuthenticated: (user: User) => void }) {
  const { t, i18n } = useTranslation(['auth', 'common'])
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [googleEnabled, setGoogleEnabled] = useState(false)
  const [googleRegistration, setGoogleRegistration] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    api.googleAuthConfig().then(value => {
      setGoogleEnabled(value.enabled)
      setGoogleRegistration(value.allow_registration)
    }).catch(() => undefined)
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const oauthError = params.get('oauth_error')
    if (!oauthError) return
    const key = `google.errors.${oauthError}`
    setError(i18n.exists(key, { ns: 'auth' }) ? t(key) : t('google.errors.google_login_failed'))
    params.delete('oauth_error'); params.delete('oauth')
    window.history.replaceState({}, '', `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`)
  }, [i18n, location.hash, location.pathname, location.search, t])

  function changeMode() {
    setMode(value => value === 'login' ? 'register' : 'login')
    setError(''); setPassword(''); setPasswordVisible(false)
  }

  function startGoogle() {
    const params = new URLSearchParams(location.search)
    params.delete('oauth'); params.delete('oauth_error')
    const returnTo = `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`
    window.location.assign(`${API_URL}/api/auth/google/start?${new URLSearchParams({ return_to: returnTo })}`)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      await api.auth(mode, email, password, normalizeLocale(i18n.language))
      const user = await api.me()
      await applyLocale(user.ui_locale)
      onAuthenticated(user)
      const resumeExtensionConnect = location.pathname === '/extension/connect'
      navigate(resumeExtensionConnect ? `${location.pathname}${location.search}` : user.role === 'admin' && localStorage.getItem(LAST_WORKSPACE_KEY) === 'admin' ? '/admin' : '/')
    } catch (value) {
      setError(value instanceof Error ? value.message : t('loginFailed'))
    } finally { setBusy(false) }
  }

  const googleAvailable = googleEnabled && (mode === 'login' || googleRegistration)
  return <main className="auth-shell">
    <div className="auth-top-actions"><HelpLink login/><LanguageSwitcher /></div>
    <section className="auth-card">
      <div className="auth-brand"><Brand large /></div>
      <header className="auth-intro">
        <h1>{t(mode === 'login' ? 'loginTitle' : 'registerTitle')}</h1>
        <p>{t(mode === 'login' ? 'loginSubtitle' : 'registerSubtitle')}</p>
      </header>
      <form onSubmit={submit} className="auth-form">
        <label><span>{t('email')}</span><div className="auth-input"><Icon name="message"/><input type="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="name@company.com" autoComplete="email" /></div></label>
        <label><span>{t('password')}</span><div className="auth-input"><Icon name="lock"/><input type={passwordVisible ? 'text' : 'password'} minLength={8} required value={password} onChange={event => setPassword(event.target.value)} placeholder={t('passwordHint')} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /><button type="button" className="auth-password-toggle" onClick={() => setPasswordVisible(value => !value)} title={t(passwordVisible ? 'hidePassword' : 'showPassword')} aria-label={t(passwordVisible ? 'hidePassword' : 'showPassword')}><Icon name={passwordVisible ? 'eyeOff' : 'eye'} /></button></div></label>
        {error && <div className="error auth-error"><Icon name="warning"/>{error}</div>}
        <button className="primary auth-submit" disabled={busy}>{busy ? <span className="action-spinner"/> : <Icon name={mode === 'login' ? 'arrowRight' : 'plus'}/>} {busy ? t('waiting') : t(mode === 'login' ? 'login' : 'register')}</button>
      </form>
      {googleAvailable && <><div className="auth-divider"><span>{t('google.or')}</span></div><button type="button" className="google-auth-button" onClick={startGoogle}><span className="google-mark">G</span>{t(mode === 'login' ? 'google.signIn' : 'google.register')}</button></>}
      <div className="auth-mode-switch"><span>{t(mode === 'login' ? 'newUser' : 'existingUser')}</span><button type="button" onClick={changeMode}>{t(mode === 'login' ? 'registerAction' : 'loginAction')}</button></div>
      <footer><Icon name="shield" size={14}/>{t('secureHint')}</footer>
    </section>
  </main>
}
