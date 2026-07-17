import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import EmailSettingsTab from '../components/platform-settings/EmailSettingsTab'
import MonitoringSettingsTab from '../components/platform-settings/MonitoringSettingsTab'
import GoogleAuthSettingsTab from '../components/platform-settings/GoogleAuthSettingsTab'
import Icon from '../components/Icon'
import '../styles/platform-settings.css'

export default function PlatformSettings() {
  const { t } = useTranslation('platformSettings')
  const [tab,setTab]=useState<'email'|'login'|'monitoring'>('email')
  return <main className="admin-content-page platform-settings-page"><div className="admin-page-intro"><div><h1>{t('title')}</h1><p>{t('subtitle')}</p></div></div><nav className="platform-settings-tabs">{([['email','message'],['login','shield'],['monitoring','analytics']] as const).map(([key,icon])=><button key={key} className={tab===key?'active':''} onClick={()=>setTab(key)}><Icon name={icon}/><span><strong>{t(`tabs.${key}`)}</strong><small>{t(`tabs.${key}Hint`)}</small></span></button>)}</nav>{tab==='email'?<EmailSettingsTab/>:tab==='login'?<GoogleAuthSettingsTab/>:<MonitoringSettingsTab/>}</main>
}
