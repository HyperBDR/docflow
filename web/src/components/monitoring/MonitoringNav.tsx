import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Icon from '../Icon'

export default function MonitoringNav() {
  const { t } = useTranslation('monitoring')
  return <nav className="monitoring-tabs" aria-label={t('nav.label')}>
    <NavLink end to="/admin/monitoring"><Icon name="analytics" />{t('nav.overview')}</NavLink>
    <NavLink to="/admin/monitoring/alerts"><Icon name="warning" />{t('nav.alerts')}</NavLink>
    <NavLink to="/admin/monitoring/rules"><Icon name="settings" />{t('nav.rules')}</NavLink>
    <NavLink to="/admin/monitoring/channels"><Icon name="message" />{t('nav.channels')}</NavLink>
  </nav>
}
