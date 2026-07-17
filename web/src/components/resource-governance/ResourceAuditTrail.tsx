import { useTranslation } from 'react-i18next'
import { formatDate } from '../../i18n'
import type { Locale, ResourceGovernance } from '../../types'
import Icon from '../Icon'

export default function ResourceAuditTrail({value,locale}:{value:ResourceGovernance;locale:Locale}){
  const{t}=useTranslation('admin')
  const action=(key:string)=>t(`audit.actions.${key}`,{defaultValue:key})
  return <section className="governance-card governance-audit"><header><div><strong>{t('resource.governance.auditTitle')}</strong><small>{t('resource.governance.auditHint')}</small></div></header><div>{value.audit.map(item=><article key={item.id}><span><Icon name={item.outcome==='success'?'check':'warning'}/></span><div><strong>{action(item.action)}</strong><small>{item.target_label||item.target_type}</small></div><div><strong>{item.actor?.name||item.actor?.email||t('audit.system')}</strong><small>{item.source}</small></div><time>{formatDate(item.created_at,locale)}</time></article>)}{!value.audit.length&&<p className="governance-empty">{t('audit.empty')}</p>}</div></section>
}
