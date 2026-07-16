import { useState } from 'react'
import { formatNumber, type Locale } from '../../i18n'
import type { WorkspaceTrendPoint } from '../../workspace/types'

export type WorkspaceTrendMetric = 'resources' | 'views' | 'ai_tokens' | 'jobs'

export default function TrendChart({ points, metric, label, locale }: { points: WorkspaceTrendPoint[]; metric: WorkspaceTrendMetric; label: string; locale: Locale }) {
  const [hover, setHover] = useState<number | null>(null)
  const width = 900, height = 230, pad = 28
  const max = Math.max(1, ...points.map(item => item[metric]))
  const coordinate = (item: WorkspaceTrendPoint, index: number) => ({
    x: pad + index * (width - pad * 2) / Math.max(1, points.length - 1),
    y: height - pad - item[metric] / max * (height - pad * 2),
  })
  const polyline = points.map((item, index) => { const point = coordinate(item, index); return `${point.x},${point.y}` }).join(' ')
  const selected = hover === null ? null : points[hover]
  return <div className="workspace-trend-chart">
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={label}>
      {[0, .25, .5, .75, 1].map(line => <line key={line} x1={pad} x2={width-pad} y1={pad + line * (height-pad*2)} y2={pad + line * (height-pad*2)} />)}
      {points.length > 1 && <path d={`M ${pad} ${height-pad} L ${polyline.replaceAll(' ', ' L ')} L ${width-pad} ${height-pad} Z`} />}
      <polyline points={polyline} />
      {points.map((item, index) => { const point = coordinate(item, index); return <rect key={item.date} x={point.x-14} y="0" width="28" height={height} onMouseEnter={() => setHover(index)} onMouseLeave={() => setHover(null)} /> })}
      {selected && (() => { const point = coordinate(selected, hover!); return <circle cx={point.x} cy={point.y} r="6" /> })()}
    </svg>
    {selected && <div className="workspace-chart-tooltip" style={{ left: `${Math.min(88, Math.max(12, hover! / Math.max(1, points.length - 1) * 100))}%` }}><strong>{selected.date}</strong><span>{label}<b>{formatNumber(selected[metric], locale)}</b></span></div>}
    <footer><span>{points[0]?.date || '—'}</span><span>{points.at(-1)?.date || '—'}</span></footer>
  </div>
}
