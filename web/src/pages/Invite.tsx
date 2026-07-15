import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import Brand from '../components/Brand'
import Icon from '../components/Icon'
import { normalizeLocale } from '../i18n'
import type { Invitation, User } from '../types'

export default function Invite({ user, onAuthenticated }: { user: User | null; onAuthenticated: (user: User) => void }) {
  const { token = '' } = useParams(), navigate = useNavigate(), { t, i18n } = useTranslation(['account', 'common'])
  const [invitation, setInvitation] = useState<Invitation | null>(null), [name, setName] = useState(''), [password, setPassword] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => { api.invitation(token).then(setInvitation).catch(value => setError(value.message)) }, [token])
  async function accept(event: React.FormEvent) { event.preventDefault(); setBusy(true); setError(''); try { const value = user ? await api.acceptInvitation(token) : await api.registerInvitation(token, name, password, normalizeLocale(i18n.language)); onAuthenticated(value); navigate('/') } catch (value) { setError(value instanceof Error ? value.message : t('common:errors.operationFailed')); setBusy(false) } }
  return <main className="invite-page"><section className="invite-card"><Brand large /><span className="invite-icon"><Icon name="users" size={28} /></span><h1>{t('invite.title')}</h1>{invitation ? <><p>{t('invite.description', { organization: invitation.organization_name })}</p><div className="invite-summary"><span>{invitation.email}</span><b>{t(`invite.roles.${invitation.role}`)}</b></div><form className="stack" onSubmit={accept}>{!user && <><label>{t('profile.name')}<input required value={name} onChange={event => setName(event.target.value)} /></label><label>{t('security.newPassword')}<input type="password" minLength={8} required value={password} onChange={event => setPassword(event.target.value)} /></label></>}{user && <p className="invite-signed-in">{t('invite.signedIn', { email: user.email })}</p>}{error && <div className="error">{error}</div>}<button className="primary" disabled={busy}>{busy ? t('invite.accepting') : t('invite.accept')}</button></form></> : <div className={error ? 'error' : 'center-page'}>{error || t('invite.loading')}</div>}</section></main>
}
