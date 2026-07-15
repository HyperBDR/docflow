import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import Icon from '../components/Icon'
import type { Analytics as AnalyticsData, Demo, Tag } from '../types'

type Tab = 'general' | 'devices' | 'leads'

function isoDate(offsetDays: number) { const value = new Date(); value.setDate(value.getDate() + offsetDays); return value.toISOString().slice(0, 10) }

export default function Analytics() {
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
  if (!demo) return <main className="analytics-page center-page">{error || '正在加载分析数据…'}</main>

  return <main className="analytics-page">
    <header className="analytics-topbar"><div><Link to="/">← 我的演示</Link><span>/</span><strong>{demo.title}</strong></div><div><Link className="button" to={`/demos/${demo.id}`}>预览演示</Link><Link className="button primary" to={`/demos/${demo.id}?mode=edit`}>编辑</Link></div></header>
    <section className="analytics-hero"><div><span className="analytics-icon"><Icon name="analytics" size={22} /></span><div><h1>分享分析</h1><p>了解观众从进入、互动到完成演示的完整路径。</p></div></div><div className="analytics-filters"><label>开始日期<input type="date" value={from} max={to} onChange={event => setFrom(event.target.value)} /></label><label>结束日期<input type="date" value={to} min={from} onChange={event => setTo(event.target.value)} /></label><label>标签筛选<select value={tag} onChange={event => setTag(event.target.value)}><option value="">全部标签</option>{tags.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div></section>
    <nav className="analytics-tabs"><button className={tab === 'general' ? 'active' : ''} onClick={() => setTab('general')}><Icon name="analytics" />General Data</button><button className={tab === 'devices' ? 'active' : ''} onClick={() => setTab('devices')}><Icon name="device" />Device & Location</button><button className={tab === 'leads' ? 'active' : ''} onClick={() => setTab('leads')}><Icon name="users" />Lead Data & Comments</button></nav>
    {error && <div className="analytics-message error">{error}</div>}{loading && <div className="analytics-loading">正在汇总所选时间范围的数据…</div>}
    {!loading && data?.filtered_out && <div className="analytics-message">当前演示不包含所选标签，因此没有匹配数据。</div>}
    {!loading && data && !data.filtered_out && tab === 'general' && <>
      <section className="metric-grid"><Metric label="Total Views" value={data.summary.total_views.toLocaleString()} note="访问会话数" icon="eye" /><Metric label="Unique Viewers" value={data.summary.unique_viewers.toLocaleString()} note="独立访客数" icon="users" /><Metric label="Engagement" value={`${data.summary.engagement}%`} note="浏览多步或产生互动" icon="target" /><Metric label="Completion" value={`${data.summary.completion}%`} note="到达演示末尾" icon="check" /></section>
      <section className="analytics-card step-chart"><header><div><strong>Viewers By Steps</strong><p>条形图表示到达每个步骤的观众数量，将鼠标悬停查看转化值。</p></div><span>{data.steps.length} 个步骤</span></header><div>{data.steps.map((step, index) => <div className="step-bar-row" key={step.id} title={`${step.viewers} 位观众 · ${step.conversion}% 总访问转化`}><b>{index + 1}</b><span title={step.title}>{step.title}</span><div><i style={{ width: `${step.viewers / maxStep * 100}%` }} /></div><strong>{step.viewers}</strong><em>{step.conversion}%</em></div>)}{!data.steps.length && <Empty text="发布演示并产生访问后，这里会展示每一步的观众数量。" />}</div></section>
    </>}
    {!loading && data && tab === 'devices' && <section className="device-grid"><Distribution title="Operating system" icon="device" items={data.devices.operating_systems} empty="Operating system analytics will appear here once you start receiving views." /><Distribution title="Browser" icon="layout" items={data.devices.browsers} empty="Browser analytics will appear here once you start receiving views." /><Distribution title="Device type" icon="device" items={data.devices.device_types} empty="Device analytics will appear here once you start receiving views." /><Distribution title="Geographic" icon="target" items={data.devices.locations} empty="Geographic analytics will appear here once you start receiving views from different locations." /></section>}
    {!loading && data && tab === 'leads' && <div className="lead-layout"><section className="analytics-card"><header><div><strong>Lead Data</strong><p>访客在评论时留下的联系人信息。</p></div><span>{data.leads.length} 条</span></header><div className="lead-list">{data.leads.map((lead, index) => <article key={`${lead.email}-${index}`}><span><Icon name="users" /></span><div><strong>{lead.name || '访客'}</strong><a href={`mailto:${lead.email}`}>{lead.email || '未留邮箱'}</a><p>{lead.comment}</p></div><time>{new Date(lead.created_at).toLocaleString()}</time></article>)}{!data.leads.length && <Empty text="有访客留下姓名或邮箱后，线索会集中显示在这里。" />}</div></section><section className="analytics-card"><header><div><strong>步骤评论</strong><p>查看观众针对具体步骤提出的建议。</p></div><span>{data.comments.length} 条</span></header><div className="comment-admin-list">{data.comments.map(comment => <article className={comment.status === 'hidden' ? 'hidden' : ''} key={comment.id}><div><strong>{comment.author_name}</strong><span>步骤 {Math.max(1, demo.steps.findIndex(item => item.id === comment.step_id) + 1)}</span><time>{new Date(comment.created_at).toLocaleString()}</time></div><p>{comment.content}</p><button onClick={async () => { const next = comment.status === 'hidden' ? 'published' : 'hidden'; await api.moderateComment(demo.id, comment.id, next); setData(current => current ? { ...current, comments: current.comments.map(item => item.id === comment.id ? { ...item, status: next } : item) } : current) }}>{comment.status === 'hidden' ? '恢复发布' : '隐藏评论'}</button></article>)}{!data.comments.length && <Empty text="分享页收到的逐步骤评论会展示在这里。" />}</div></section></div>}
  </main>
}

function Metric({ label, value, note, icon }: { label: string; value: string; note: string; icon: 'eye' | 'users' | 'target' | 'check' }) { return <article className="metric-card"><span><Icon name={icon} /></span><div><small>{label}</small><strong>{value}</strong><p>{note}</p></div></article> }
function Empty({ text }: { text: string }) { return <div className="analytics-empty"><Icon name="analytics" size={28} /><p>{text}</p></div> }
function Distribution({ title, icon, items = [], empty }: { title: string; icon: 'device' | 'layout' | 'target'; items?: { name: string; value: number }[]; empty: string }) {
  const total = Math.max(1, items.reduce((sum, item) => sum + item.value, 0))
  return <section className="analytics-card distribution-card"><header><div><strong><Icon name={icon} />{title}</strong><p>所选时间范围内的访问分布。</p></div></header>{items.length ? <div>{items.map(item => <div key={item.name}><span>{item.name}</span><div><i style={{ width: `${item.value / total * 100}%` }} /></div><strong>{item.value}</strong><em>{Math.round(item.value / total * 100)}%</em></div>)}</div> : <Empty text={empty} />}</section>
}
