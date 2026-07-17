import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDate, formatNumber } from '../../i18n'
import type { Locale } from '../../types'

export function GovernanceTrendChart({ points, locale }: { points: { date: string; views: number; viewers: number; completions: number }[]; locale: Locale }) {
  const {t}=useTranslation('admin'),[hover, setHover] = useState<number | null>(null), width=900,height=220,padding=28,max=Math.max(1,...points.flatMap(item=>[item.views,item.viewers,item.completions]))
  const x=(index:number)=>padding+(width-padding*2)*(points.length<2?0.5:index/(points.length-1)),y=(value:number)=>height-padding-(height-padding*2)*value/max
  const line=(key:'views'|'viewers'|'completions')=>points.map((item,index)=>`${x(index)},${y(item[key])}`).join(' ')
  const active=hover===null?null:points[hover]
  return <div className="governance-trend"><div className="governance-chart-legend"><span><i style={{background:'#635bff'}}/>Views</span><span><i style={{background:'#22a660'}}/>Visitors</span><span><i style={{background:'#ef8b3b'}}/>Completed</span></div><div className="governance-chart-stage">{active&&<div className="chart-tooltip governance-tooltip" style={{left:`${x(hover!)/width*100}%`}}><strong>{formatDate(active.date,locale)}</strong><span>{formatNumber(active.views,locale)} views</span><span>{formatNumber(active.viewers,locale)} visitors</span><span>{formatNumber(active.completions,locale)} completed</span></div>}<svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">{[0,.25,.5,.75,1].map(value=><line key={value} x1={padding} x2={width-padding} y1={padding+(height-padding*2)*value} y2={padding+(height-padding*2)*value} className="chart-grid-line"/>)}<polyline points={line('views')} stroke="#635bff"/><polyline points={line('viewers')} stroke="#22a660"/><polyline points={line('completions')} stroke="#ef8b3b"/>{points.map((item,index)=><rect key={item.date} x={Math.max(0,x(index)-width/Math.max(1,points.length)/2)} y={0} width={Math.max(8,width/Math.max(1,points.length))} height={height} fill="transparent" onMouseEnter={()=>setHover(index)} onMouseLeave={()=>setHover(null)}/>)}</svg></div><footer><span>{points[0]?.date||'—'}</span><span>{points.at(-1)?.date||'—'}</span></footer></div>
}

export function GovernanceDistribution({ title, items }: { title: string; items: { name: string; value: number }[] }) {
  const total=Math.max(1,items.reduce((sum,item)=>sum+item.value,0))
  return <section className="governance-distribution"><header><strong>{title}</strong><small>{items.reduce((sum,item)=>sum+item.value,0)}</small></header><div>{items.length?items.slice(0,8).map(item=><div key={item.name}><span title={item.name}>{item.name}</span><i><b style={{width:`${item.value/total*100}%`}}/></i><strong>{item.value}</strong><em>{Math.round(item.value/total*100)}%</em></div>):<p>—</p>}</div></section>
}
