import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import { formatDate, formatNumber } from '../i18n'
import Icon from '../components/Icon'
import HelpLink from '../components/HelpLink'
import type { Analytics as AnalyticsData, Demo, Tag } from '../types'

type Tab = 'general' | 'devices' | 'leads'

function isoDate(offsetDays: number) { const value = new Date(); value.setDate(value.getDate() + offsetDays); return value.toISOString().slice(0, 10) }

export default function Analytics() {
  const { t } = useTranslation('analytics')
  const { id = '' } = useParams()
  const [demo, setDemo] = useState<Demo | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [tab, setTab] = useState<Tab>('general')
  const [from, setFrom] = useState(isoDate(-30))
  const [to, setTo] = useState(isoDate(0))
  const [tag, setTag] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = () => { setLoading(true); setError(''); api.analytics(id, from, to, tag ? [tag] : []).then(setData).catch(value => setError(value.message)).finally(() => setLoading(false)) }
  useEffect(() => { Promise.all([api.demo(id), api.tags()]).then(([demoValue, tagValues]) => { setDemo(demoValue); setTags(tagValues) }).catch(value => setError(value.message)) }, [id])
  useEffect(load, [id, from, to, tag])
  const maxStep = useMemo(() => Math.max(1, ...(data?.steps.map(item => item.viewers) || [])), [data])
  if (!demo) return <main className="analytics-page center-page">{error || t('loading')}</main>

  return <main className="analytics-page">
    <header className="analytics-topbar"><div><Link to="/">{t('back')}</Link><span>/</span><strong>{demo.title}</strong></div><div><HelpLink/><Link className="button" to={`/demos/${demo.id}`}>{t('preview')}</Link><Link className="button primary" to={`/demos/${demo.id}?mode=edit`}>{t('common:actions.edit')}</Link></div></header>
    <section className="analytics-hero"><div><span className="analytics-icon"><Icon name="analytics" size={22} /></span><div><h1>{t('title')}</h1><p>{t('subtitle')}</p></div></div><div className="analytics-filters"><label>{t('from')}<input type="date" value={from} max={to} onChange={event => setFrom(event.target.value)} /></label><label>{t('to')}<input type="date" value={to} min={from} onChange={event => setTo(event.target.value)} /></label><label>{t('tagFilter')}<select value={tag} onChange={event => setTag(event.target.value)}><option value="">{t('allTags')}</option>{tags.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div></section>
    <nav className="analytics-tabs"><button className={tab === 'general' ? 'active' : ''} onClick={() => setTab('general')}><Icon name="analytics" />{t('tabs.general')}</button><button className={tab === 'devices' ? 'active' : ''} onClick={() => setTab('devices')}><Icon name="device" />{t('tabs.devices')}</button><button className={tab === 'leads' ? 'active' : ''} onClick={() => setTab('leads')}><Icon name="users" />{t('tabs.leads')}</button></nav>
    {error && <div className="analytics-message error">{error}</div>}{loading && <div className="analytics-loading">{t('aggregating')}</div>}
    {!loading && data?.filtered_out && <div className="analytics-message">{t('filteredOut')}</div>}
    {!loading && data && !data.filtered_out && tab === 'general' && <>
      <section className="metric-grid"><Metric label={t('metrics.views')} value={formatNumber(data.summary.total_views)} note={t('metrics.viewsNote')} icon="eye" /><Metric label={t('metrics.viewers')} value={formatNumber(data.summary.unique_viewers)} note={t('metrics.viewersNote')} icon="users" /><Metric label={t('metrics.engagement')} value={`${data.summary.engagement}%`} note={t('metrics.engagementNote')} icon="target" /><Metric label={t('metrics.completion')} value={`${data.summary.completion}%`} note={t('metrics.completionNote')} icon="check" /></section>
      <section className="analytics-card step-chart"><header><div><strong>{t('steps.title')}</strong><p>{t('steps.description')}</p></div><span>{t('common:units.steps', { count: data.steps.length })}</span></header><div>{data.steps.map((step, index) => <div className="step-bar-row" key={step.id} title={t('steps.tooltip', { viewers: step.viewers, conversion: step.conversion })}><b>{index + 1}</b><span title={step.title}>{step.title}</span><div><i style={{ width: `${step.viewers / maxStep * 100}%` }} /></div><strong>{step.viewers}</strong><em>{step.conversion}%</em></div>)}{!data.steps.length && <Empty text={t('steps.empty')} />}</div></section>
    </>}
    {!loading && data && tab === 'devices' && <section className="device-grid"><Distribution title={t('devices.os')} icon="device" items={data.devices.operating_systems} empty={t('devices.osEmpty')} /><Distribution title={t('devices.browser')} icon="layout" items={data.devices.browsers} empty={t('devices.browserEmpty')} /><Distribution title={t('devices.type')} icon="device" items={data.devices.device_types} empty={t('devices.typeEmpty')} /><Distribution title={t('devices.location')} icon="target" items={data.devices.locations} empty={t('devices.locationEmpty')} /></section>}
    {!loading && data && tab === 'leads' && <div className="lead-layout"><section className="analytics-card"><header><div><strong>{t('leads.title')}</strong><p>{t('leads.description')}</p></div><span>{t('common:units.records', { count: data.leads.length })}</span></header><div className="lead-list">{data.leads.map((lead, index) => <article key={`${lead.email}-${index}`}><span><Icon name="users" /></span><div><strong>{lead.name || t('leads.guest')}</strong><a href={`mailto:${lead.email}`}>{lead.email || t('leads.noEmail')}</a><p>{lead.comment}</p></div><time>{formatDate(lead.created_at)}</time></article>)}{!data.leads.length && <Empty text={t('leads.empty')} />}</div></section><section className="analytics-card"><header><div><strong>{t('comments.title')}</strong><p>{t('comments.description')}</p></div><span>{t('common:units.records', { count: data.comments.length })}</span></header><div className="comment-admin-list">{data.comments.map(comment => <article className={comment.status === 'hidden' ? 'hidden' : ''} key={comment.id}><div><strong>{comment.author_name}</strong><span>{t('steps.label', { index: Math.max(1, demo.steps.findIndex(item => item.id === comment.step_id) + 1) })}</span><time>{formatDate(comment.created_at)}</time></div><p>{comment.content}</p><button onClick={async () => { const next = comment.status === 'hidden' ? 'published' : 'hidden'; await api.moderateComment(demo.id, comment.id, next); setData(current => current ? { ...current, comments: current.comments.map(item => item.id === comment.id ? { ...item, status: next } : item) } : current) }}>{comment.status === 'hidden' ? t('comments.restore') : t('comments.hide')}</button></article>)}{!data.comments.length && <Empty text={t('comments.empty')} />}</div></section></div>}
  </main>
}

function Metric({ label, value, note, icon }: { label: string; value: string; note: string; icon: 'eye' | 'users' | 'target' | 'check' }) { return <article className="metric-card"><span><Icon name={icon} /></span><div><small>{label}</small><strong>{value}</strong><p>{note}</p></div></article> }
function Empty({ text }: { text: string }) { return <div className="analytics-empty"><Icon name="analytics" size={28} /><p>{text}</p></div> }
function Distribution({ title, icon, items = [], empty }: { title: string; icon: 'device' | 'layout' | 'target'; items?: { name: string; value: number }[]; empty: string }) {
  const { t } = useTranslation('analytics')
  const total = Math.max(1, items.reduce((sum, item) => sum + item.value, 0))
  const label = (name: string) => ({ mobile: t('devices.mobile'), desktop: t('devices.desktop'), '移动设备': t('devices.mobile'), '桌面设备': t('devices.desktop'), Other: t('devices.other'), '其他': t('devices.other') }[name] || name)
  return <section className="analytics-card distribution-card"><header><div><strong><Icon name={icon} />{title}</strong><p>{t('devices.distribution')}</p></div></header>{items.length ? <div>{items.map(item => <div key={item.name}><span>{label(item.name)}</span><div><i style={{ width: `${item.value / total * 100}%` }} /></div><strong>{item.value}</strong><em>{Math.round(item.value / total * 100)}%</em></div>)}</div> : <Empty text={empty} />}</section>
}
