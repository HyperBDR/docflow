import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Brand from '../components/Brand'
import Icon from '../components/Icon'
import { connectBrowserExtension, detectBrowserExtension } from '../extensionBridge'

type Phase = 'detecting' | 'connecting' | 'success' | 'error'

export default function ExtensionConnect() {
  const { t } = useTranslation('dashboard')
  const started = useRef(false)
  const closeTimer = useRef<number | undefined>(undefined)
  const [phase, setPhase] = useState<Phase>('detecting')
  const [error, setError] = useState('')

  async function connect() {
    setError(''); setPhase('detecting')
    try {
      const status = await detectBrowserExtension()
      if (!status.installed) throw new Error('extension_not_detected')
      if (!status.connected) {
        setPhase('connecting')
        await connectBrowserExtension()
      }
      setPhase('success')
      if (new URLSearchParams(window.location.search).get('source') === 'extension') {
        window.clearTimeout(closeTimer.current)
        closeTimer.current = window.setTimeout(() => window.close(), 1600)
      }
    } catch (value) {
      const message = (value as Error).message
      setError(message === 'extension_not_detected' ? t('extensionNotDetected') : t('extensionConnectFailed'))
      setPhase('error')
    }
  }

  useEffect(() => {
    if (!started.current) { started.current = true; void connect() }
    return () => window.clearTimeout(closeTimer.current)
  }, [])

  const icon = phase === 'success' ? 'check' : phase === 'error' ? 'warning' : 'link'
  const title = phase === 'detecting' ? t('connectDetectingTitle')
    : phase === 'connecting' ? t('connectAuthorizingTitle')
      : phase === 'success' ? t('connectSuccessTitle') : t('connectErrorTitle')
  const description = phase === 'detecting' ? t('connectDetectingDescription')
    : phase === 'connecting' ? t('connectAuthorizingDescription')
      : phase === 'success' ? t('connectSuccessDescription') : error

  return <main className="extension-connect-shell">
    <section className="extension-connect-card" role="dialog" aria-live="polite">
      <div className="extension-connect-brand"><Brand large /></div>
      <span className={`extension-connect-state ${phase}`}><Icon name={icon} size={28} />{(phase === 'detecting' || phase === 'connecting') && <i />}</span>
      <h1>{title}</h1>
      <p>{description}</p>
      {phase === 'success' && <small>{t('connectCloseHint')}</small>}
      <div className="extension-connect-actions">
        {phase === 'error' && <button className="primary icon-button" onClick={() => void connect()}><Icon name="link" />{t('retryConnection')}</button>}
        {phase === 'success' && <button className="primary" onClick={() => window.close()}>{t('closeConnectPage')}</button>}
        <Link to="/">{t('returnHome')}</Link>
      </div>
    </section>
  </main>
}
