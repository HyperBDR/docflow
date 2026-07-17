import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import AdminPagination from '../components/AdminPagination'
import Icon from '../components/Icon'
import ProductDonut from '../components/charts/InteractiveDonut'
import ProductLineChart from '../components/charts/InteractiveLineChart'
import { formatDate, formatNumber, normalizeLocale } from '../i18n'
import type { AdminOrganization, AdminUser, AIModelConfig, AIUsagePoint, AIUsageRecord, AIUsageSummary } from '../types'

const point = { key: 'total', label: '', requests: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, avg_latency_ms: 0 }
const emptySummary: AIUsageSummary = { totals: point, trend: [], by_user: [], by_organization: [], by_model: [], by_resource: [], by_status: [], by_operation: [] }
type Series = { key: keyof AIUsagePoint; label: string; color: string }

function InteractiveLineChart({ points = [], series, locale }: { points?: AIUsagePoint[]; series: Series[]; locale: string }) {
  const axisLabel=(value:string)=>{const parts=value.split('-');return parts.length===3?`${parts[1]}/${parts[2]}`:value}
  return <ProductLineChart className="ai-usage-standard-chart" ariaLabel={series.map(item=>item.label).join(' / ')} points={points.map(point=>({key:point.key,label:point.label,axisLabel:axisLabel(point.label),values:Object.fromEntries(series.map(item=>[String(item.key),Number(point[item.key])||0]))}))} series={series.map(item=>({key:String(item.key),label:item.label,color:item.color}))} formatValue={value=>new Intl.NumberFormat(locale,{notation:'compact',maximumFractionDigits:1}).format(value)}/>
}

function VerticalBars({ title, items = [], onSelect }: { title: string; items?: AIUsagePoint[]; onSelect?: (item: AIUsagePoint) => void }) {
  const max = Math.max(1, ...items.map(item => item.total_tokens)), visible = items.slice(0, 10)
  return <section className="usage-bars-card"><header><strong>{title}</strong><small>{items.length}</small></header><div className="vertical-bars">{visible.map((item,index) => <button key={item.key} onClick={() => onSelect?.(item)} title={`${item.label}: ${item.total_tokens}`}><span><em style={{height:`${Math.max(3,item.total_tokens/max*100)}%`}} className={`tone-${index%5}`} /><b>{item.total_tokens.toLocaleString()}</b></span><small>{item.label}</small></button>)}{!visible.length && <p>—</p>}</div></section>
}

function StatusDonut({ items = [], title }: { items?: AIUsagePoint[]; title: string }) {
  const {t}=useTranslation('admin')
  const success = items.find(item => item.key === 'success')?.requests || 0, failed = items.find(item => item.key === 'failed')?.requests || 0
  return <section className="usage-donut-card"><header><strong>{title}</strong></header><ProductDonut ariaLabel={title} centerLabel={t('usage.requestUnit')} items={[{key:'success',label:t('usage.success'),value:success,color:'#22a660'},{key:'failed',label:t('usage.failed'),value:failed,color:'#e05260'}]}/></section>
}

export default function AdminAIUsage() {
  const { t, i18n } = useTranslation(['admin', 'common']); const locale = normalizeLocale(i18n.language)
  const [summary,setSummary]=useState(emptySummary), [records,setRecords]=useState<AIUsageRecord[]>([]), [models,setModels]=useState<AIModelConfig[]>([]), [users,setUsers]=useState<AdminUser[]>([]), [organizations,setOrganizations]=useState<AdminOrganization[]>([])
  const [days,setDays]=useState(30), [modelId,setModelId]=useState(''), [userId,setUserId]=useState(''), [organizationId,setOrganizationId]=useState(''), [status,setStatus]=useState(''), [query,setQuery]=useState(''), [page,setPage]=useState(1), [pageSize,setPageSize]=useState(10), [total,setTotal]=useState(0), [loading,setLoading]=useState(true), [error,setError]=useState('')
  useEffect(()=>{ Promise.all([api.aiModels(),api.adminUsers({page_size:100}),api.adminOrganizations()]).then(([m,u,o])=>{setModels(m);setUsers(u.items);setOrganizations(o)}).catch(()=>undefined)},[])
  useEffect(()=>{setLoading(true);setError('');Promise.all([api.aiUsageSummary({days,model_id:modelId,user_id:userId,organization_id:organizationId}),api.aiUsageRequests({query,model_id:modelId,user_id:userId,organization_id:organizationId,status,page,page_size:pageSize})]).then(([s,r])=>{setSummary({
    ...emptySummary,
    ...s,
    totals: { ...point, ...s.totals },
    trend: Array.isArray(s.trend) ? s.trend : [],
    by_user: Array.isArray(s.by_user) ? s.by_user : [],
    by_organization: Array.isArray(s.by_organization) ? s.by_organization : [],
    by_model: Array.isArray(s.by_model) ? s.by_model : [],
    by_resource: Array.isArray(s.by_resource) ? s.by_resource : [],
    by_status: Array.isArray(s.by_status) ? s.by_status : [],
    by_operation: Array.isArray(s.by_operation) ? s.by_operation : [],
  });setRecords(Array.isArray(r.items) ? r.items : []);setTotal(r.total || 0)}).catch(value=>setError(value.message)).finally(()=>setLoading(false))},[days,modelId,userId,organizationId,status,query,page,pageSize])
  const metrics=useMemo(()=>[{icon:'database' as const,label:t('usage.metrics.tokens'),value:summary.totals.total_tokens},{icon:'text' as const,label:t('usage.metrics.input'),value:summary.totals.input_tokens},{icon:'ai' as const,label:t('usage.metrics.output'),value:summary.totals.output_tokens},{icon:'clock' as const,label:t('usage.metrics.firstToken'),value:summary.totals.avg_first_token_ms,suffix:' ms'},{icon:'analytics' as const,label:t('usage.metrics.latency'),value:summary.totals.avg_latency_ms,suffix:' ms'}],[summary,t])
  const reset=(setter:(value:string)=>void,value:string)=>{setter(value);setPage(1)}
  return <div className="admin-content-page ai-usage-page"><div className="admin-page-intro"><div><h1>{t('usage.title')}</h1><p>{t('usage.subtitle')}</p></div><span>{t('usage.requests',{count:summary.totals.requests})}</span></div>
    <div className="usage-filters"><select value={days} onChange={event=>setDays(Number(event.target.value))}>{[7,30,90,365].map(value=><option value={value} key={value}>{t('usage.days',{count:value})}</option>)}</select><select value={modelId} onChange={event=>reset(setModelId,event.target.value)}><option value="">{t('usage.allModels')}</option>{models.map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select><select value={organizationId} onChange={event=>reset(setOrganizationId,event.target.value)}><option value="">{t('usage.allTeams')}</option>{organizations.map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select><select value={userId} onChange={event=>reset(setUserId,event.target.value)}><option value="">{t('usage.allUsers')}</option>{users.map(item=><option value={item.id} key={item.id}>{item.name||item.email}</option>)}</select></div>{error&&<div className="error">{error}</div>}
    <div className="usage-metrics">{metrics.map(item=><article key={item.label}><span><Icon name={item.icon}/></span><div><small>{item.label}</small><strong>{item.value==null?'—':`${formatNumber(item.value,locale)}${item.suffix||''}`}</strong></div></article>)}</div>
    <div className="usage-line-grid"><section className="usage-chart-card"><header><div><strong>{t('usage.trend')}</strong><small>{t('usage.trendHint')}</small></div></header><InteractiveLineChart locale={locale} points={summary.trend} series={[{key:'input_tokens',label:t('usage.metrics.input'),color:'#635bff'},{key:'output_tokens',label:t('usage.metrics.output'),color:'#22a660'}]}/></section><section className="usage-chart-card"><header><div><strong>{t('usage.performance')}</strong><small>{t('usage.performanceHint')}</small></div></header><InteractiveLineChart locale={locale} points={summary.trend} series={[{key:'avg_latency_ms',label:t('usage.metrics.latency'),color:'#ef8b3b'},{key:'avg_first_token_ms',label:t('usage.metrics.firstToken'),color:'#e05294'}]}/></section></div>
    <div className="usage-visual-grid"><VerticalBars title={t('usage.byTeam')} items={summary.by_organization} onSelect={item=>reset(setOrganizationId,item.key==='unknown'?'':item.key)}/><VerticalBars title={t('usage.byUser')} items={summary.by_user} onSelect={item=>reset(setUserId,item.key==='unknown'?'':item.key)}/><VerticalBars title={t('usage.byModel')} items={summary.by_model} onSelect={item=>reset(setModelId,item.key==='unknown'?'':item.key)}/><VerticalBars title={t('usage.byResource')} items={summary.by_resource}/><VerticalBars title={t('usage.byOperation')} items={summary.by_operation}/><StatusDonut title={t('usage.statusDistribution')} items={summary.by_status}/></div>
    <section className="admin-list-card usage-detail-card"><header><div><strong>{t('usage.details')}</strong><small>{t('usage.detailsHint')}</small></div><div><label className="admin-search"><Icon name="search"/><input value={query} onChange={event=>reset(setQuery,event.target.value)} placeholder={t('usage.search')}/></label><select value={status} onChange={event=>reset(setStatus,event.target.value)}><option value="">{t('usage.allStatuses')}</option><option value="success">{t('usage.success')}</option><option value="failed">{t('usage.failed')}</option></select></div></header><div className="usage-table-wrap"><table className="usage-table"><thead><tr><th>{t('usage.columns.time')}</th><th>{t('usage.columns.resource')}</th><th>{t('usage.columns.userTeam')}</th><th>{t('usage.columns.model')}</th><th>{t('usage.columns.tokens')}</th><th>{t('usage.columns.firstToken')}</th><th>{t('usage.columns.latency')}</th><th>{t('usage.columns.status')}</th></tr></thead><tbody>{records.map(item=><tr key={item.id}><td><time>{formatDate(item.created_at,locale)}</time><small>{item.operation}</small></td><td><strong>{item.demo_title||'—'}</strong><details><summary>{t('usage.requestDetail')}</summary><pre>{JSON.stringify({request_id:item.request_id,request:item.request_detail,response:item.response_detail,error:item.error||undefined},null,2)}</pre></details></td><td><strong>{item.user_name||item.user_email||'—'}</strong><small>{item.organization_name||'—'}</small></td><td>{item.model_name}</td><td><strong>{formatNumber(item.total_tokens,locale)}</strong><small>↑ {formatNumber(item.input_tokens,locale)} · ↓ {formatNumber(item.output_tokens,locale)}</small></td><td>{item.first_token_ms==null?'—':`${item.first_token_ms} ms`}</td><td>{item.latency_ms} ms</td><td><span className={`usage-status ${item.status}`}>{t(`usage.${item.status}`)}</span></td></tr>)}</tbody></table>{loading&&<div className="admin-table-state"><span className="action-spinner"/>{t('loading')}</div>}{!loading&&!records.length&&<div className="admin-table-state">{t('usage.empty')}</div>}</div><AdminPagination page={page} pageSize={pageSize} total={total} onPage={setPage} onPageSize={size=>{setPageSize(size);setPage(1)}}/></section>
  </div>
}
