import { useState } from 'react'
import FloatingChartTooltip, { type ChartPointer } from './FloatingChartTooltip'
import '../../styles/charts.css'

export type ProductDonutItem = { key: string; label: string; value: number; color?: string }

export default function InteractiveDonut({ items, centerLabel, ariaLabel, className = '' }: { items: ProductDonutItem[]; centerLabel: string; ariaLabel: string; className?: string }) {
  const [hovered, setHovered] = useState<string | null>(null), [selected, setSelected] = useState<string | null>(null)
  const [pointer, setPointer] = useState<ChartPointer | null>(null)
  const colors = ['#635bff', '#22a660', '#ef8b3b', '#e05260', '#3d9be9', '#c45ac6']
  const total = items.reduce((sum, item) => sum + item.value, 0), radius = 48, circumference = 2 * Math.PI * radius
  let consumed = 0
  const segments = items.map((item, index) => { const ratio = item.value / Math.max(1, total), value = { ...item, color: item.color || colors[index % colors.length], ratio, length: ratio * circumference, offset: consumed * circumference }; consumed += ratio; return value })
  const activeKey = hovered || selected, active = segments.find(item => item.key === activeKey) || null
  const hoveredSegment = segments.find(item => item.key === hovered) || null
  const toggle = (key: string) => setSelected(current => current === key ? null : key)
  return <div className={`product-donut-layout ${className}`.trim()}>
    <div className="product-donut" onPointerMove={event => setPointer({ x: event.clientX, y: event.clientY })} onPointerLeave={() => { setHovered(null); setPointer(null) }}><svg viewBox="0 0 120 120" role="img" aria-label={ariaLabel}><circle className="product-donut-track" cx="60" cy="60" r={radius} />{segments.map(item => item.value > 0 && <circle key={item.key} className={`product-donut-segment${activeKey === item.key ? ' active' : ''}${activeKey && activeKey !== item.key ? ' muted' : ''}`} cx="60" cy="60" r={radius} stroke={item.color} strokeDasharray={`${item.length} ${circumference - item.length}`} strokeDashoffset={-item.offset} onPointerEnter={event => { setHovered(item.key); setPointer({ x: event.clientX, y: event.clientY }) }} onClick={() => toggle(item.key)} />)}</svg><span><b>{active ? active.value : total}</b><small>{active ? active.label : centerLabel}</small>{active && <em>{(active.ratio * 100).toFixed(1)}%</em>}</span></div>
    <ul className="product-donut-legend">{segments.map(item => <li key={item.key} className={activeKey === item.key ? 'active' : ''}><button type="button" onPointerEnter={event => { setHovered(item.key); setPointer({ x: event.clientX, y: event.clientY }) }} onPointerMove={event => setPointer({ x: event.clientX, y: event.clientY })} onPointerLeave={() => { setHovered(null); setPointer(null) }} onClick={() => toggle(item.key)}><i style={{ background: item.color }} /><span>{item.label}</span><b>{item.value}</b><em>{(item.ratio * 100).toFixed(1)}%</em></button></li>)}</ul>
    {hoveredSegment && pointer && <FloatingChartTooltip className="product-chart-tooltip product-donut-tooltip" pointer={pointer}><strong>{hoveredSegment.label}</strong><span><i style={{ background: hoveredSegment.color }} />{centerLabel}<b>{hoveredSegment.value}</b></span><span className="product-donut-tooltip-percent">{(hoveredSegment.ratio * 100).toFixed(1)}%</span></FloatingChartTooltip>}
  </div>
}
