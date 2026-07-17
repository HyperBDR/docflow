import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import Icon from '../components/Icon'
import SlideStage from '../components/SlideStage'
import UserAvatar from '../components/UserAvatar'
import ResourceShareAnalytics from '../components/resource-governance/ResourceShareAnalytics'
import ResourceDownloads from '../components/resource-governance/ResourceDownloads'
import ResourceAuditTrail from '../components/resource-governance/ResourceAuditTrail'
import { formatDate, normalizeLocale } from '../i18n'
import type { AdminResourceDetail as Resource, ResourceGovernance } from '../types'

function bytes(value: number, locale: string) {
  if (!value) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB'], index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 4)
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1024 ** index)} ${units[index]}`
}

export default function AdminResourceDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { t, i18n } = useTranslation(['admin', 'common'])
  const locale = normalizeLocale(i18n.language)
  const [resource, setResource] = useState<Resource | null>(null)
  const [index, setIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = (searchParams.get('tab') || 'overview') as 'overview'|'shares'|'downloads'|'audit'
  const requestedReturnTo=searchParams.get('return_to')||''
  const returnTo=/^\/admin\/resources(?:\?|$)/.test(requestedReturnTo)?requestedReturnTo:'/admin/resources'
  const backLabel=returnTo.includes('tab=shares')?t('resource.governance.backToShares'):returnTo.includes('tab=downloads')?t('resource.governance.backToDownloads'):t('nav.resources')
  const [days,setDays]=useState(30)
  const [governance,setGovernance]=useState<ResourceGovernance|null>(null)
  const [governanceLoading,setGovernanceLoading]=useState(false)
  const previewRef=useRef<HTMLElement|null>(null)
  const [previewFullscreen,setPreviewFullscreen]=useState(false)
  useEffect(() => { api.adminResource(id).then(setResource).catch(value => setError(value.message)).finally(() => setLoading(false)) }, [id])
  useEffect(()=>{if(tab==='overview')return;setGovernanceLoading(true);api.resourceGovernance(id,days).then(setGovernance).catch(value=>setError(value.message)).finally(()=>setGovernanceLoading(false))},[id,tab,days])
  useEffect(()=>{const update=()=>setPreviewFullscreen(document.fullscreenElement===previewRef.current);document.addEventListener('fullscreenchange',update);return()=>document.removeEventListener('fullscreenchange',update)},[])
  async function togglePreviewFullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await previewRef.current?.requestFullscreen()}catch{setError(t('resource.governance.fullscreenFailed'))}}
  async function remove() {
    if (!resource || !window.confirm(t('resource.deleteConfirm', { title: resource.title }))) return
    setDeleting(true)
    try { await api.deleteAdminResource(resource.id); navigate(returnTo) }
    catch (value) { setError(value instanceof Error ? value.message : t('common:errors.operationFailed')); setDeleting(false) }
  }
  if (loading) return <div className="admin-detail-loading"><span className="action-spinner" />{t('loading')}</div>
  if (!resource) return <div className="admin-content-page"><div className="error">{error}</div></div>
  const steps = resource.demo.steps
  const step = steps[index]
  const changeTab=(value:typeof tab)=>{const next=new URLSearchParams(searchParams);if(value==='overview')next.delete('tab');else next.set('tab',value);setSearchParams(next)}
  return <div className="admin-content-page resource-detail-page">
    <div className="resource-detail-heading"><div><Link to={returnTo}><Icon name="chevronLeft" />{backLabel}</Link><h1>{resource.title}</h1><p>{resource.description || t('resource.noDescription')}</p></div><button className="danger icon-button" disabled={deleting} onClick={remove}><Icon name="delete" />{deleting ? t('resource.deleting') : t('resource.delete')}</button></div>
    {error && <div className="error">{error}</div>}
    <div className="resource-detail-tabs-row"><nav className="monitoring-tabs resource-governance-tabs">{(['overview','shares','downloads','audit'] as const).map(value=><button key={value} className={tab===value?'active':''} onClick={()=>changeTab(value)}><Icon name={value==='overview'?'grid':value==='shares'?'analytics':value==='downloads'?'download':'list'}/>{t(`resource.governance.detailTabs.${value}`)}</button>)}</nav>{tab==='shares'&&<select value={days} onChange={event=>setDays(Number(event.target.value))}>{[7,30,90,365].map(value=><option key={value} value={value}>{t('resource.governance.days',{count:value})}</option>)}</select>}</div>
    {governanceLoading&&tab!=='overview'&&<div className="admin-detail-loading"><span className="action-spinner"/>{t('loading')}</div>}
    {!governanceLoading&&tab==='shares'&&governance&&<ResourceShareAnalytics value={governance} locale={locale}/>} {!governanceLoading&&tab==='downloads'&&governance&&<ResourceDownloads value={governance} locale={locale}/>} {!governanceLoading&&tab==='audit'&&governance&&<ResourceAuditTrail value={governance} locale={locale}/>} {tab==='overview'&&<div className="resource-detail-layout">
      <section ref={previewRef} className="resource-preview-card"><header><span className={`status ${resource.status}`}>{t(`common:status.${resource.status}`)}</span><b>{t('resource.readOnly')}</b><small>{index + 1} / {steps.length}</small><button className="preview-fullscreen-button icon-button" onClick={togglePreviewFullscreen} title={t(previewFullscreen?'resource.governance.exitFullscreen':'resource.governance.fullscreenPreview')}><Icon name={previewFullscreen?'close':'layout'}/>{t(previewFullscreen?'resource.governance.exitFullscreen':'resource.governance.fullscreenPreview')}</button></header>
        <div className="admin-resource-stage">{step ? <SlideStage key={step.id} step={step} mode="player" fit="viewport" activeHotspotId={step.hotspots[0]?.id} theme={resource.demo.theme} navigation={resource.demo.navigation} stepIndex={index} stepCount={steps.length} onHotspot={() => setIndex(value => Math.min(steps.length - 1, value + 1))} onGuidePrevious={() => setIndex(value => Math.max(0, value - 1))} onGuideNext={() => setIndex(value => Math.min(steps.length - 1, value + 1))} /> : <div className="empty"><Icon name="image" size={32} /><p>{t('resource.noSteps')}</p></div>}</div>
        <footer><button disabled={index <= 0} onClick={() => setIndex(value => value - 1)}><Icon name="chevronLeft" />{t('common:actions.previous')}</button><button disabled={index >= steps.length - 1} onClick={() => setIndex(value => value + 1)}>{t('common:actions.next')}<Icon name="chevronRight" /></button></footer>
      </section>
      <aside className="resource-info-panel"><section><div className="resource-owner-summary"><UserAvatar user={{ name: resource.owner.name, email: resource.owner.email }} size={46} /><div><strong>{resource.owner.name || resource.owner.email.split('@')[0]}</strong><small>{resource.owner.email}</small></div></div></section>
        <section><h3>{t('resource.usage')}</h3><div className="resource-info-stats"><div><Icon name="list" /><span><small>{t('detail.steps')}</small><b>{resource.step_count}</b></span></div><div><Icon name="eye" /><span><small>{t('detail.views')}</small><b>{resource.views}</b></span></div><div><Icon name="users" /><span><small>{t('detail.viewers')}</small><b>{resource.unique_viewers}</b></span></div><div><Icon name="database" /><span><small>{t('detail.storage')}</small><b>{bytes(resource.storage_bytes, locale)}</b></span></div></div></section>
        <section><h3>{t('resource.metadata')}</h3><dl><div><dt>{t('detail.language')}</dt><dd>{resource.content_locale === 'en' ? 'English' : '简体中文'}</dd></div><div><dt>{t('resource.created')}</dt><dd>{formatDate(resource.created_at, locale)}</dd></div><div><dt>{t('resource.updated')}</dt><dd>{formatDate(resource.updated_at, locale)}</dd></div></dl></section>
      </aside>
    </div>}
  </div>
}
