import { useTranslation } from 'react-i18next'
import { formatNumber } from '../../i18n'
import type { Locale } from '../../types'
import ProductLineChart from '../charts/InteractiveLineChart'

export function GovernanceTrendChart({ points, locale }: { points: { date: string; views: number; viewers: number; completions: number }[]; locale: Locale }) {
  const {t}=useTranslation('admin')
  const axisDate=(value:string)=>{const parts=value.split('-');return parts.length===3?`${parts[1]}/${parts[2]}`:value}
  return <ProductLineChart
    className="governance-standard-chart"
    ariaLabel={t('resource.governance.trafficTrend')}
    points={points.map(point=>({key:point.date,label:axisDate(point.date),values:{views:point.views,viewers:point.viewers,completions:point.completions}}))}
    series={[
      {key:'views',label:t('resource.governance.trendSeries.views'),color:'#635bff'},
      {key:'viewers',label:t('resource.governance.trendSeries.viewers'),color:'#22a660'},
      {key:'completions',label:t('resource.governance.trendSeries.completions'),color:'#ef8b3b'},
    ]}
    formatValue={value=>formatNumber(value,locale)}
  />
}

export function GovernanceDistribution({ title, items }: { title: string; items: { name: string; value: number }[] }) {
  const total=Math.max(1,items.reduce((sum,item)=>sum+item.value,0))
  return <section className="governance-distribution"><header><strong>{title}</strong><small>{items.reduce((sum,item)=>sum+item.value,0)}</small></header><div>{items.length?items.slice(0,8).map(item=><div key={item.name}><span title={item.name}>{item.name}</span><i><b style={{width:`${item.value/total*100}%`}}/></i><strong>{item.value}</strong><em>{Math.round(item.value/total*100)}%</em></div>):<p>—</p>}</div></section>
}
