import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AdminPagination from '../../components/AdminPagination'
import MonitoringNav from '../../components/monitoring/MonitoringNav'
import SeverityBadge from '../../components/monitoring/SeverityBadge'
import Icon from '../../components/Icon'
import { useToast } from '../../components/toast'
import { formatDate, normalizeLocale } from '../../i18n'
import { monitoringApi } from '../../monitoring/api'
import type { AlertEventPage } from '../../monitoring/types'

export default function AlertEvents() {
  const { t, i18n } = useTranslation(['monitoring','common']); const locale = normalizeLocale(i18n.language), toast = useToast()
  const [value,setValue]=useState<AlertEventPage>({items:[],total:0,page:1,page_size:20}), [status,setStatus]=useState(''), [severity,setSeverity]=useState(''), [page,setPage]=useState(1), [pageSize,setPageSize]=useState(20), [error,setError]=useState('')
  const load=useCallback(()=>monitoringApi.alerts({status,severity,page,page_size:pageSize}).then(setValue).catch(reason=>setError(reason.message)),[status,severity,page,pageSize])
  useEffect(()=>{load()},[load])
  async function acknowledge(id:string){try{await monitoringApi.acknowledge(id);toast.success(t('alerts.acknowledged'));await load()}catch(reason){toast.error((reason as Error).message)}}
  return <main className="admin-content-page monitoring-page"><div className="admin-page-intro"><div><h1>{t('alerts.title')}</h1><p>{t('alerts.subtitle')}</p></div><span>{t('alerts.total',{count:value.total})}</span></div><MonitoringNav/>{error&&<div className="error">{error}</div>}
    <section className="monitor-panel"><header className="monitor-filters"><select value={status} onChange={event=>{setStatus(event.target.value);setPage(1)}}><option value="">{t('alerts.allStatuses')}</option><option value="active">{t('alertStatus.active')}</option><option value="acknowledged">{t('alertStatus.acknowledged')}</option><option value="resolved">{t('alertStatus.resolved')}</option></select><select value={severity} onChange={event=>{setSeverity(event.target.value);setPage(1)}}><option value="">{t('alerts.allSeverities')}</option><option value="critical">{t('severity.critical')}</option><option value="warning">{t('severity.warning')}</option><option value="info">{t('severity.info')}</option></select></header>
      <div className="monitor-alert-list">{value.items.map(item=><article key={item.id} className={item.status}><span className={`monitor-alert-icon ${item.severity}`}><Icon name="warning"/></span><div><div><strong>{item.title}</strong><SeverityBadge value={item.severity}/><em>{t(`alertStatus.${item.status}`)}</em></div><p>{item.message}</p><small>{t(`metrics.catalog.${item.metric_key}`,{defaultValue:item.metric_key})} · {formatDate(item.started_at,locale)} · {t('alerts.lastValue',{value:item.current_value})}</small></div>{item.status==='active'&&<button onClick={()=>acknowledge(item.id)}><Icon name="check"/>{t('alerts.acknowledge')}</button>}</article>)}{!value.items.length&&<div className="monitor-empty"><Icon name="check" size={30}/><strong>{t('alerts.empty')}</strong><p>{t('alerts.emptyHint')}</p></div>}</div>
      <AdminPagination page={page} pageSize={pageSize} total={value.total} onPage={setPage} onPageSize={size=>{setPageSize(size);setPage(1)}}/></section>
  </main>
}
