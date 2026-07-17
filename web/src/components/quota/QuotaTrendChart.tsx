import { useState } from 'react'

export type QuotaTrendPoint = { date: string; used: number; limit: number; percent: number }

export default function QuotaTrendChart({ points, formatValue, usedLabel, limitLabel }: {
  points: QuotaTrendPoint[]; formatValue: (value: number) => string; usedLabel: string; limitLabel: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const width = 900, height = 250, pad = 34
  const values = points.flatMap(item => [item.used, item.limit])
  const max = Math.max(1, ...values)
  const coordinate = (value: number, index: number) => ({
    x: pad + index * (width - pad * 2) / Math.max(1, points.length - 1),
    y: height - pad - value / max * (height - pad * 2),
  })
  const active = hover == null ? null : points[hover]
  return <div className="quota-trend-chart">
    <div className="quota-chart-y-axis">{[1, .75, .5, .25, 0].map(value => <span key={value}>{formatValue(max * value)}</span>)}</div>
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      {[0, .25, .5, .75, 1].map(value => <line key={value} className="quota-chart-grid" x1={pad} x2={width - pad} y1={pad + value * (height - pad * 2)} y2={pad + value * (height - pad * 2)} />)}
      <polyline className="quota-chart-limit" points={points.map((item, index) => { const p = coordinate(item.limit, index); return `${p.x},${p.y}` }).join(' ')} />
      <polyline className="quota-chart-used" points={points.map((item, index) => { const p = coordinate(item.used, index); return `${p.x},${p.y}` }).join(' ')} />
      {points.map((item, index) => { const p = coordinate(item.used, index), hitWidth = Math.max(12, (width - pad * 2) / Math.max(1, points.length)); return <rect key={item.date} x={p.x - hitWidth / 2} y="0" width={hitWidth} height={height} fill="transparent" onMouseEnter={() => setHover(index)} onMouseLeave={() => setHover(null)} /> })}
      {hover != null && active && <><line className="quota-chart-hover" x1={coordinate(active.used, hover).x} x2={coordinate(active.used, hover).x} y1={pad} y2={height - pad} /><circle cx={coordinate(active.used, hover).x} cy={coordinate(active.used, hover).y} r="6" className="quota-chart-dot" /></>}
    </svg>
    {active && hover != null && <div className="quota-chart-tooltip" style={{ left: `${Math.min(86, Math.max(14, hover / Math.max(1, points.length - 1) * 100))}%` }}><strong>{active.date}</strong><span><i className="used" />{usedLabel}<b>{formatValue(active.used)}</b></span><span><i className="limit" />{limitLabel}<b>{formatValue(active.limit)}</b></span><span><i className="percent" />{active.percent.toFixed(1)}%</span></div>}
    <div className="quota-chart-axis"><span>{points[0]?.date || '—'}</span><span>{points.at(-1)?.date || '—'}</span></div>
    <div className="quota-chart-legend"><span><i className="used" />{usedLabel}</span><span><i className="limit" />{limitLabel}</span></div>
  </div>
}
