import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Icon from '../Icon'
import { platformSettingsApi } from '../../platform-settings/api'
import type { MonitoringPlatformSettings } from '../../platform-settings/types'

export default function MonitoringSettingsTab() {
  const { t } = useTranslation('platformSettings')
  const [value, setValue] = useState<MonitoringPlatformSettings | null>(null), [error, setError] = useState('')
  useEffect(()=>{platformSettingsApi.monitoring().then(setValue).catch(reason=>setError(reason.message))},[])
  if (error) return <div className="error">{error}</div>
  if (!value) return <div className="platform-settings-loading"><span className="action-spinner"/></div>
  return <div className="platform-settings-tab"><section className="platform-settings-summary"><span><Icon name="analytics" size={22}/></span><div><strong>{t('monitoring.statusTitle')}</strong><p>{t('monitoring.statusHint')}</p></div><em className="active"><i/>{t('status.running')}</em></section><section className="platform-monitoring-grid"><article><span><Icon name="clock"/></span><div><small>{t('monitoring.interval')}</small><strong>{t('monitoring.seconds',{count:value.interval_seconds})}</strong><p>{t('monitoring.intervalHint')}</p></div></article><article><span><Icon name="database"/></span><div><small>{t('monitoring.retention')}</small><strong>{t('monitoring.days',{count:value.retention_days})}</strong><p>{t('monitoring.retentionHint')}</p></div></article><article><span><Icon name="analytics"/></span><div><small>{t('monitoring.ranges')}</small><strong>{value.raw_ranges.join(' · ')}</strong><p>{t('monitoring.rangesHint')}</p></div></article></section><section className="platform-settings-note"><Icon name="shield"/><div><strong>{t('monitoring.privacy')}</strong><p>{t('monitoring.privacyHint')}</p></div></section></div>
}
