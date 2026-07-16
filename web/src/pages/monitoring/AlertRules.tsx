import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import MonitoringNav from '../../components/monitoring/MonitoringNav'
import RuleDialog from '../../components/monitoring/RuleDialog'
import SeverityBadge from '../../components/monitoring/SeverityBadge'
import Icon from '../../components/Icon'
import { useToast } from '../../components/toast'
import { monitoringApi } from '../../monitoring/api'
import type { AlertRule, AlertRuleInput, MetricDefinition } from '../../monitoring/types'

export default function AlertRules(){
  const {t}=useTranslation(['monitoring','common']),toast=useToast();const [items,setItems]=useState<AlertRule[]>([]),[metrics,setMetrics]=useState<MetricDefinition[]>([]),[editing,setEditing]=useState<AlertRule|null|undefined>(undefined),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const load=()=>Promise.all([monitoringApi.rules(),monitoringApi.metrics()]).then(([rules,definitions])=>{setItems(rules);setMetrics(definitions)}).catch(reason=>setError(reason.message))
  useEffect(()=>{load()},[])
  async function save(value:AlertRuleInput){setBusy(true);try{editing?await monitoringApi.updateRule(editing.id,value):await monitoringApi.createRule(value);setEditing(undefined);toast.success(t('rules.saved'));await load()}catch(reason){toast.error((reason as Error).message)}finally{setBusy(false)}}
  async function toggle(item:AlertRule){try{await monitoringApi.updateRule(item.id,{enabled:!item.enabled});await load()}catch(reason){toast.error((reason as Error).message)}}
  async function remove(item:AlertRule){if(item.built_in||!confirm(t('rules.deleteConfirm',{name:item.name})))return;try{await monitoringApi.deleteRule(item.id);toast.success(t('rules.deleted'));await load()}catch(reason){toast.error((reason as Error).message)}}
  return <main className="admin-content-page monitoring-page"><div className="admin-page-intro"><div><h1>{t('rules.title')}</h1><p>{t('rules.subtitle')}</p></div><button className="primary icon-button" onClick={()=>setEditing(null)}><Icon name="plus"/>{t('rules.create')}</button></div><MonitoringNav/>{error&&<div className="error">{error}</div>}<section className="monitor-panel"><div className="monitor-rule-list">{items.map(item=><article key={item.id}><span className={`monitor-rule-icon ${item.severity}`}><Icon name="warning"/></span><div><div><strong>{item.name}</strong>{item.built_in&&<em>{t('rules.builtIn')}</em>}<SeverityBadge value={item.severity}/></div><p>{t(`metrics.catalog.${item.metric_key}`,{defaultValue:item.metric_key})} · {t(`operators.${item.operator}`)} {item.threshold}</p><small>{t('rules.behavior',{periods:item.consecutive_periods,cooldown:item.cooldown_minutes,value:item.last_value??'—'})}</small></div><button className={`model-toggle ${item.enabled?'active':''}`} onClick={()=>toggle(item)}><i/>{t(item.enabled?'rules.enabled':'rules.disabled')}</button><button onClick={()=>setEditing(item)}><Icon name="edit"/></button><button className="danger" disabled={item.built_in} onClick={()=>remove(item)}><Icon name="delete"/></button></article>)}</div></section>{editing!==undefined&&<RuleDialog rule={editing} metrics={metrics} busy={busy} onClose={()=>setEditing(undefined)} onSave={save}/>}</main>
}
