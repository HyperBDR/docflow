import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { API_URL, api } from '../api'
import AdminPagination from '../components/AdminPagination'
import Icon from '../components/Icon'
import { formatDate, formatNumber, normalizeLocale } from '../i18n'
import type { AdminJobDetail, AdminJobItem, AdminJobStatus, AdminOrganization, AdminUser } from '../types'

const statuses: AdminJobStatus[] = ['queued','running','complete','failed','cancelled']
const emptySummary = { queued: 0, running: 0, complete: 0, failed: 0, cancelled: 0 }

function duration(value?: number | null) {
  if (value == null) return '—'
  if (value < 1000) return `${value} ms`
  const seconds = Math.round(value / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60), rest = seconds % 60
  return `${minutes}m ${rest}s`
}

function typeLabel(item: AdminJobItem, t: (key: string, options?: Record<string, unknown>) => string) {
  if (item.job_type === 'ai') return t('jobs.types.ai')
  return t(`overview.exportKinds.${item.kind}`, { defaultValue: item.kind.toUpperCase() })
}

export default function AdminJobs() {
  const { t, i18n } = useTranslation(['admin','common']); const locale = normalizeLocale(i18n.language)
  const [params,setParams] = useSearchParams()
  const [items,setItems] = useState<AdminJobItem[]>([]), [total,setTotal] = useState(0), [summary,setSummary] = useState<Record<AdminJobStatus,number>>(emptySummary)
  const [query,setQuery] = useState(params.get('query')||''), [jobType,setJobType] = useState(params.get('type')||''), [status,setStatus] = useState(params.get('status')||'')
  const [userId,setUserId] = useState(''), [organizationId,setOrganizationId] = useState(''), [from,setFrom] = useState(''), [to,setTo] = useState('')
  const [page,setPage] = useState(1), [pageSize,setPageSize] = useState(20), [loading,setLoading] = useState(true), [error,setError] = useState('')
  const [users,setUsers] = useState<AdminUser[]>([]), [organizations,setOrganizations] = useState<AdminOrganization[]>([])
  const [selected,setSelected] = useState<AdminJobDetail|null>(null), [detailLoading,setDetailLoading] = useState(false), [busy,setBusy] = useState('')

  const load = useCallback(async()=>{
    setLoading(true);setError('')
    try {
      const value=await api.adminJobs({query,job_type:jobType,status,user_id:userId,organization_id:organizationId,from_at:from?`${from}T00:00:00`:undefined,to_at:to?`${to}T23:59:59.999`:undefined,page,page_size:pageSize})
      setItems(Array.isArray(value.items)?value.items:[]);setTotal(value.total||0);setSummary({...emptySummary,...value.summary})
    } catch(value){setError(value instanceof Error?value.message:t('common:errors.operationFailed'))}
    finally{setLoading(false)}
  },[query,jobType,status,userId,organizationId,from,to,page,pageSize,t])
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),220);return()=>clearTimeout(timer)},[load])
  useEffect(()=>{Promise.all([api.adminUsers({page_size:100}),api.adminOrganizations()]).then(([u,o])=>{setUsers(u.items);setOrganizations(o)}).catch(()=>undefined)},[])
  useEffect(()=>{
    const id=params.get('job'), type=params.get('type')
    if(!id||!['ai','export'].includes(type||''))return
    setDetailLoading(true);api.adminJob(type as 'ai'|'export',id).then(setSelected).catch(()=>setParams(current=>{const next=new URLSearchParams(current);next.delete('job');return next},{replace:true})).finally(()=>setDetailLoading(false))
  },[params,setParams])

  const updateFilter=(key:string,value:string,setter:(value:string)=>void)=>{setter(value);setPage(1);setParams(current=>{const next=new URLSearchParams(current);if(value)next.set(key,value);else next.delete(key);next.delete('job');return next},{replace:true})}
  const open=async(item:AdminJobItem)=>{setDetailLoading(true);setParams(current=>{const next=new URLSearchParams(current);next.set('type',item.job_type);next.set('job',item.id);return next});try{setSelected(await api.adminJob(item.job_type,item.id))}finally{setDetailLoading(false)}}
  const close=()=>{setSelected(null);setParams(current=>{const next=new URLSearchParams(current);next.delete('job');return next},{replace:true})}
  const act=async(action:'retry'|'cancel')=>{
    if(!selected||!window.confirm(t(`jobs.actions.${action}Confirm`)))return
    setBusy(action);setError('')
    try{
      const value=action==='retry'?await api.retryAdminJob(selected.job_type,selected.id):await api.cancelAdminJob(selected.job_type,selected.id)
      setSelected(value);setParams(current=>{const next=new URLSearchParams(current);next.set('type',value.job_type);next.set('job',value.id);return next},{replace:true});await load()
    }catch(value){setError(value instanceof Error?value.message:t('common:errors.operationFailed'))}
    finally{setBusy('')}
  }
  const visibleTotal=useMemo(()=>Object.values(summary).reduce((sum,value)=>sum+value,0),[summary])
  return <div className="admin-content-page admin-jobs-page"><div className="admin-page-intro"><div><h1>{t('jobs.title')}</h1><p>{t('jobs.subtitle')}</p></div><span>{t('jobs.total',{count:total})}</span></div>
    <div className="job-summary-grid"><button className={!status?'active':''} onClick={()=>updateFilter('status','',setStatus)}><span><Icon name="list"/></span><div><small>{t('jobs.summary.all')}</small><strong>{formatNumber(visibleTotal,locale)}</strong></div></button>{statuses.map(value=><button key={value} className={status===value?`active ${value}`:value} onClick={()=>updateFilter('status',value,setStatus)}><span><Icon name={value==='failed'?'warning':value==='complete'?'check':value==='cancelled'?'unlink':'clock'}/></span><div><small>{t(`common:status.${value}`)}</small><strong>{formatNumber(summary[value]||0,locale)}</strong></div></button>)}</div>
    <section className="admin-list-card jobs-list-card"><div className="jobs-filters"><label className="admin-search"><Icon name="search"/><input value={query} onChange={event=>updateFilter('query',event.target.value,setQuery)} placeholder={t('jobs.search')}/></label><select value={jobType} onChange={event=>updateFilter('type',event.target.value,setJobType)}><option value="">{t('jobs.allTypes')}</option><option value="ai">{t('jobs.types.ai')}</option><option value="export">{t('jobs.types.export')}</option></select><select value={status} onChange={event=>updateFilter('status',event.target.value,setStatus)}><option value="">{t('jobs.allStatuses')}</option>{statuses.map(value=><option key={value} value={value}>{t(`common:status.${value}`)}</option>)}</select><select value={organizationId} onChange={event=>{setOrganizationId(event.target.value);setPage(1)}}><option value="">{t('jobs.allOrganizations')}</option>{organizations.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select><select value={userId} onChange={event=>{setUserId(event.target.value);setPage(1)}}><option value="">{t('jobs.allUsers')}</option>{users.map(item=><option key={item.id} value={item.id}>{item.name||item.email}</option>)}</select><label className="jobs-date"><span>{t('jobs.from')}</span><input type="date" value={from} onChange={event=>{setFrom(event.target.value);setPage(1)}}/></label><label className="jobs-date"><span>{t('jobs.to')}</span><input type="date" value={to} onChange={event=>{setTo(event.target.value);setPage(1)}}/></label></div>{error&&<div className="error">{error}</div>}
      <div className="jobs-table-wrap"><table className="jobs-table"><thead><tr><th>{t('jobs.columns.task')}</th><th>{t('jobs.columns.status')}</th><th>{t('jobs.columns.resource')}</th><th>{t('jobs.columns.user')}</th><th>{t('jobs.columns.organization')}</th><th>{t('jobs.columns.progress')}</th><th>{t('jobs.columns.duration')}</th><th>{t('jobs.columns.created')}</th><th/></tr></thead><tbody>{items.map(item=><tr key={`${item.job_type}-${item.id}`} onClick={()=>void open(item)} tabIndex={0} onKeyDown={event=>{if(event.key==='Enter'||event.key===' ')void open(item)}}><td><div className={`job-type-icon ${item.job_type}`}><Icon name={item.job_type==='ai'?'ai':'download'}/></div><div><strong>{typeLabel(item,t)}</strong><code>{item.id.slice(0,8)}</code></div></td><td><span className={`job-state ${item.status}`}><i/>{t(`common:status.${item.status}`)}</span></td><td><strong>{item.resource_title||t('overview.untitled')}</strong>{item.step_id&&<small>{t('jobs.stepTask')}</small>}</td><td><strong>{item.user_name||item.user_email||'—'}</strong><small>{item.user_email}</small></td><td>{item.organization_name||'—'}</td><td><div className="job-progress"><span><i style={{width:`${item.progress}%`}}/></span><b>{item.progress}%</b></div></td><td>{duration(item.duration_ms)}</td><td><time>{formatDate(item.created_at,locale)}</time></td><td><Icon name="chevronRight"/></td></tr>)}</tbody></table>{loading&&<div className="admin-table-state"><span className="action-spinner"/>{t('loading')}</div>}{!loading&&!items.length&&<div className="admin-table-state">{t('jobs.empty')}</div>}</div><AdminPagination page={page} pageSize={pageSize} total={total} onPage={setPage} onPageSize={value=>{setPageSize(value);setPage(1)}}/></section>
    {detailLoading&&!selected&&<div className="jobs-detail-loading"><span className="action-spinner"/></div>}{selected&&<><button className="admin-user-drawer-scrim" aria-label={t('common:actions.close')} onClick={close}/><aside className="admin-user-drawer job-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="job-detail-title"><header className="admin-user-drawer-header"><div className="job-detail-identity"><span className={selected.job_type}><Icon name={selected.job_type==='ai'?'ai':'download'} size={22}/></span><div><h2 id="job-detail-title">{typeLabel(selected,t)}</h2><p>{selected.resource_title||t('overview.untitled')}</p><div><span className={`job-state ${selected.status}`}><i/>{t(`common:status.${selected.status}`)}</span><code>{selected.id}</code></div></div></div><button className="admin-user-drawer-close" onClick={close}>×</button></header><div className="admin-user-drawer-body">
        <section className="job-detail-actions">{selected.can_retry&&<button className="primary" disabled={!!busy} onClick={()=>void act('retry')}><Icon name="animation"/>{busy==='retry'?t('jobs.actions.retrying'):t('jobs.actions.retry')}</button>}{selected.can_cancel&&<button className="danger" disabled={!!busy} onClick={()=>void act('cancel')}><Icon name="unlink"/>{busy==='cancel'?t('jobs.actions.cancelling'):t('jobs.actions.cancel')}</button>}{selected.download_url&&<a className="primary" href={`${API_URL}${selected.download_url}`}><Icon name="download"/>{t('common:actions.download')}</a>}<Link to={`/admin/resources/${selected.resource_id}`}><Icon name="folder"/>{t('jobs.actions.openResource')}</Link></section>
        <section className="admin-user-section"><div className="admin-user-section-title"><span><Icon name="list"/></span><div><h3>{t('jobs.details.summary')}</h3><p>{t('jobs.details.summaryHint')}</p></div></div><div className="job-detail-grid"><div><small>{t('jobs.details.user')}</small><strong>{selected.user_name||selected.user_email||'—'}</strong><span>{selected.user_email}</span></div><div><small>{t('jobs.details.organization')}</small><strong>{selected.organization_name||'—'}</strong></div><div><small>{t('jobs.details.resource')}</small><strong>{selected.resource_title||'—'}</strong></div><div><small>{t('jobs.details.type')}</small><strong>{typeLabel(selected,t)}</strong></div><div><small>{t('jobs.details.model')}</small><strong>{selected.model||'—'}</strong></div><div><small>{t('jobs.details.progress')}</small><strong>{selected.progress}%</strong></div><div><small>{t('jobs.details.duration')}</small><strong>{duration(selected.duration_ms)}</strong></div><div><small>{t('jobs.details.retryOf')}</small><code>{selected.retry_of_id||'—'}</code></div></div></section>
        <section className="admin-user-section"><div className="admin-user-section-title"><span><Icon name="clock"/></span><div><h3>{t('jobs.details.timeline')}</h3><p>{t('jobs.details.timelineHint')}</p></div></div><div className="job-timeline">{[{key:'created',time:selected.created_at},{key:'started',time:selected.started_at},{key:selected.status==='cancelled'?'cancelled':selected.status==='failed'?'failed':'completed',time:selected.cancelled_at||selected.completed_at}].filter(item=>item.time).map(item=><div key={item.key}><i/><span><strong>{t(`jobs.timeline.${item.key}`)}</strong><small>{formatDate(item.time as string,locale)}</small></span></div>)}</div></section>
        {(selected.error||selected.error_code)&&<section className="admin-user-section job-error-section"><div className="admin-user-section-title"><span><Icon name="warning"/></span><div><h3>{t('jobs.details.error')}</h3><p>{selected.error_code||'—'}</p></div></div><pre>{selected.error||t('jobs.details.noErrorDetail')}</pre></section>}
        <section className="admin-user-section"><div className="admin-user-section-title"><span><Icon name="database"/></span><div><h3>{t('jobs.details.metadata')}</h3><p>{t('jobs.details.metadataHint')}</p></div></div><pre className="job-json">{JSON.stringify(selected.metadata,null,2)}</pre></section>
        {!!Object.keys(selected.result||{}).length&&<section className="admin-user-section"><div className="admin-user-section-title"><span><Icon name="check"/></span><div><h3>{t('jobs.details.result')}</h3><p>{t('jobs.details.resultHint')}</p></div></div><pre className="job-json">{JSON.stringify(selected.result,null,2)}</pre></section>}
      </div></aside></>}
  </div>
}
