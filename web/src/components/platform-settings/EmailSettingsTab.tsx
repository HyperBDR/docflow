import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '../toast'
import Icon from '../Icon'
import { platformSettingsApi } from '../../platform-settings/api'
import type { EmailPlatformSettings, EmailPlatformSettingsInput } from '../../platform-settings/types'

const empty: EmailPlatformSettingsInput = { enabled: false, host: '', port: 587, username: '', password: '', from_email: '', from_name: 'DocFlow', security: 'starttls', timeout_seconds: 10 }

export default function EmailSettingsTab() {
  const { t } = useTranslation(['platformSettings', 'common'])
  const toast = useToast()
  const [current, setCurrent] = useState<EmailPlatformSettings | null>(null), [draft, setDraft] = useState(empty)
  const [recipient, setRecipient] = useState(''), [busy, setBusy] = useState(''), [error, setError] = useState('')
  useEffect(() => { platformSettingsApi.email().then(value => { setCurrent(value); setDraft({ enabled:value.enabled,host:value.host,port:value.port,username:value.username,password:'',from_email:value.from_email,from_name:value.from_name,security:value.security,timeout_seconds:value.timeout_seconds }) }).catch(reason => setError(reason.message)) }, [])
  const field = <K extends keyof EmailPlatformSettingsInput>(key: K, value: EmailPlatformSettingsInput[K]) => setDraft(previous => ({ ...previous, [key]: value }))
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy('save'); setError('')
    try { const value = await platformSettingsApi.updateEmail(draft); setCurrent(value); setDraft(previous => ({ ...previous, password: '' })); toast.success(t('email.saved')) }
    catch (reason) { setError((reason as Error).message) } finally { setBusy('') }
  }
  async function test() {
    setBusy('test'); setError('')
    try { await platformSettingsApi.testEmail(recipient); toast.success(t('email.testSent')) }
    catch (reason) { setError((reason as Error).message) } finally { setBusy('') }
  }
  if (!current && !error) return <div className="platform-settings-loading"><span className="action-spinner" />{t('common:status.loading')}</div>
  return <div className="platform-settings-tab"><section className="platform-settings-summary"><span><Icon name="message" size={22}/></span><div><strong>{t('email.statusTitle')}</strong><p>{t(current?.configured ? 'email.configured' : 'email.notConfigured')}</p></div><em className={current?.configured ? 'active' : ''}><i />{t(current?.configured ? 'status.ready' : 'status.inactive')}</em></section>{error&&<div className="error">{error}</div>}
    <form className="platform-settings-card" onSubmit={save}><header><div><h2>{t('email.transport')}</h2><p>{t('email.transportHint')}</p></div><label className="platform-switch"><input type="checkbox" checked={draft.enabled} onChange={event=>field('enabled',event.target.checked)}/><span/><strong>{t(draft.enabled?'status.enabled':'status.disabled')}</strong></label></header>
      <div className="platform-settings-form"><label>{t('email.fields.host')}<input required={draft.enabled} value={draft.host} onChange={event=>field('host',event.target.value)} placeholder="smtp.example.com"/></label><label>{t('email.fields.port')}<input type="number" min="1" max="65535" value={draft.port} onChange={event=>field('port',Number(event.target.value))}/></label><label>{t('email.fields.security')}<select value={draft.security} onChange={event=>field('security',event.target.value as typeof draft.security)}><option value="starttls">STARTTLS</option><option value="ssl">SSL/TLS</option><option value="none">{t('email.securityNone')}</option></select></label><label>{t('email.fields.timeout')}<input type="number" min="2" max="60" value={draft.timeout_seconds} onChange={event=>field('timeout_seconds',Number(event.target.value))}/></label><label>{t('email.fields.username')}<input value={draft.username} onChange={event=>field('username',event.target.value)} autoComplete="off"/></label><label>{t('email.fields.password')}<input type="password" value={draft.password} onChange={event=>field('password',event.target.value)} autoComplete="new-password" placeholder={current?.password_configured?t('email.passwordRetained'):''}/><small>{t('email.passwordHint')}</small></label><label>{t('email.fields.fromName')}<input value={draft.from_name} onChange={event=>field('from_name',event.target.value)}/></label><label>{t('email.fields.fromEmail')}<input type="email" required={draft.enabled} value={draft.from_email} onChange={event=>field('from_email',event.target.value)}/></label></div>
      <footer><span>{t('email.source', { value: t(`email.sources.${current?.source || 'none'}`) })}</span><button className="primary icon-button" disabled={busy==='save'}><Icon name="check"/>{t(busy==='save'?'common:status.loading':'common:actions.save')}</button></footer></form>
    <section className="platform-settings-card platform-email-test"><header><div><h2>{t('email.testTitle')}</h2><p>{t('email.testHint')}</p></div></header><div><label>{t('email.testRecipient')}<input type="email" value={recipient} onChange={event=>setRecipient(event.target.value)} placeholder="ops@example.com"/></label><button className="icon-button" disabled={!recipient||busy==='test'||!current?.configured} onClick={test}><Icon name="publish"/>{t(busy==='test'?'email.testing':'email.sendTest')}</button></div></section>
  </div>
}
