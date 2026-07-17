import { useTranslation } from 'react-i18next'
import Icon from './Icon'
import { usePlatformConfig } from './platform-config/PlatformConfigContext'

export default function HelpLink({ login = false }: { login?: boolean }) {
  const { t } = useTranslation('common')
  const { helpUrl } = usePlatformConfig()
  if (!helpUrl) return null
  const label = t('help.open')
  return <a className={login ? 'auth-help-link' : 'header-icon-button help-center-link'} href={helpUrl} target="_blank" rel="noopener noreferrer" title={label} aria-label={label}>
    <Icon name={login ? 'help' : 'support'} size={login ? 19 : 18}/>
  </a>
}
