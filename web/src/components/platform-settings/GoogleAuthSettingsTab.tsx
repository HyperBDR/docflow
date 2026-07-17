import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '../toast'
import Icon from '../Icon'
import { platformSettingsApi } from '../../platform-settings/api'
import type { GoogleAuthSettings, GoogleAuthSettingsInput } from '../../platform-settings/types'

const empty: GoogleAuthSettingsInput = {
  enabled: false,
  client_id: '',
  client_secret: '',
  allow_registration: false,
  allowed_domains: [],
}

export default function GoogleAuthSettingsTab() {
  const { t } = useTranslation(['platformSettings', 'common'])
  const toast = useToast()
  const [current, setCurrent] = useState<GoogleAuthSettings | null>(null)
  const [draft, setDraft] = useState(empty)
  const [domains, setDomains] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    platformSettingsApi.google().then(value => {
      setCurrent(value)
      setDraft({
        enabled: value.enabled,
        client_id: value.client_id,
        client_secret: '',
        allow_registration: value.allow_registration,
        allowed_domains: value.allowed_domains,
      })
      setDomains(value.allowed_domains.join('\n'))
    }).catch(reason => setError(reason.message))
  }, [])

  const field = <K extends keyof GoogleAuthSettingsInput>(key: K, value: GoogleAuthSettingsInput[K]) => {
    setDraft(previous => ({ ...previous, [key]: value }))
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setBusy('save'); setError('')
    try {
      const allowedDomains = domains.split(/[\s,;]+/).map(value => value.trim()).filter(Boolean)
      const value = await platformSettingsApi.updateGoogle({ ...draft, allowed_domains: allowedDomains })
      setCurrent(value)
      setDraft(previous => ({ ...previous, client_secret: '', allowed_domains: value.allowed_domains }))
      setDomains(value.allowed_domains.join('\n'))
      toast.success(t('google.saved'))
    } catch (reason) {
      setError((reason as Error).message)
    } finally { setBusy('') }
  }

  async function test() {
    setBusy('test'); setError('')
    try {
      await platformSettingsApi.testGoogle()
      toast.success(t('google.testPassed'))
    } catch (reason) {
      setError((reason as Error).message)
    } finally { setBusy('') }
  }

  if (!current && !error) return <div className="platform-settings-loading"><span className="action-spinner" />{t('common:status.loading')}</div>
  return <div className="platform-settings-tab">
    <section className="platform-settings-summary">
      <span><Icon name="shield" size={22}/></span>
      <div><strong>{t('google.statusTitle')}</strong><p>{t(current?.configured ? 'google.configured' : 'google.notConfigured')}</p></div>
      <em className={current?.configured ? 'active' : ''}><i />{t(current?.configured ? 'status.ready' : 'status.inactive')}</em>
    </section>
    {error && <div className="error">{error}</div>}
    <form className="platform-settings-card" onSubmit={save}>
      <header>
        <div><h2>{t('google.configuration')}</h2><p>{t('google.configurationHint')}</p></div>
        <label className="platform-switch"><input type="checkbox" checked={draft.enabled} onChange={event => field('enabled', event.target.checked)}/><span/><strong>{t(draft.enabled ? 'status.enabled' : 'status.disabled')}</strong></label>
      </header>
      <div className="platform-settings-form">
        <label>{t('google.fields.clientId')}<input required={draft.enabled} value={draft.client_id} onChange={event => field('client_id', event.target.value)} autoComplete="off" placeholder="000000000000-xxxx.apps.googleusercontent.com"/></label>
        <label>{t('google.fields.clientSecret')}<input type="password" required={draft.enabled && !current?.client_secret_configured} value={draft.client_secret} onChange={event => field('client_secret', event.target.value)} autoComplete="new-password" placeholder={current?.client_secret_configured ? t('google.secretRetained') : ''}/><small>{t('google.secretHint')}</small></label>
        <label className="platform-settings-wide">{t('google.fields.redirectUri')}<input value={current?.redirect_uri || ''} readOnly/><small>{t('google.redirectHint')}</small></label>
        <label className="platform-settings-wide">{t('google.fields.domains')}<textarea rows={3} value={domains} onChange={event => setDomains(event.target.value)} placeholder="oneprocloud.com"/><small>{t('google.domainsHint')}</small></label>
      </div>
      <div className="platform-settings-options">
        <label className="platform-switch platform-registration-switch">
          <input type="checkbox" checked={draft.allow_registration} onChange={event => field('allow_registration', event.target.checked)}/><span/>
          <div><strong>{t('google.allowRegistration')}</strong><small>{t('google.allowRegistrationHint')}</small></div>
        </label>
      </div>
      <footer><span>{t('google.footerHint')}</span><button className="primary icon-button" disabled={busy === 'save'}><Icon name="check"/>{t(busy === 'save' ? 'common:status.loading' : 'common:actions.save')}</button></footer>
    </form>
    <section className="platform-settings-card platform-google-test">
      <header><div><h2>{t('google.testTitle')}</h2><p>{t('google.testHint')}</p></div><button className="icon-button" disabled={!current?.configured || busy === 'test'} onClick={test}><Icon name="globe"/>{t(busy === 'test' ? 'google.testing' : 'google.test')}</button></header>
    </section>
    <div className="platform-settings-note"><Icon name="warning"/><div><strong>{t('google.linkPolicy')}</strong><p>{t('google.linkPolicyHint')}</p></div></div>
  </div>
}
