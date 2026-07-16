import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { normalizeLocale } from '../../i18n'

export type ChartPoint = { collected_at: string; values: Record<string, number> }
export type ChartSeries = { key: string; label: string; color: string }

function compact(value: number, locale: string) {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

export default function InteractiveMetricChart({ points, series, unit = '', threshold }: { points: ChartPoint[]; series: ChartSeries[]; unit?: string; threshold?: number }) {
  const { i18n } = useTranslation()
  const locale = normalizeLocale(i18n.language)
  const [hover, setHover] = useState<number | null>(null)
  const width = 920, height = 240, padX = 48, padY = 24
  const max = useMemo(() => Math.max(1, threshold || 0, ...points.flatMap(point => series.map(item => Number(point.values[item.key]) || 0))), [points, series, threshold])
  const xy = (value: number, index: number) => ({
    x: padX + index * (width - padX * 2) / Math.max(1, points.length - 1),
    y: height - padY - value / max * (height - padY * 2),
  })
  const formatTime = (value: string) => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
  const hoverPoint = hover == null ? null : points[hover]
  const hoverX = hover == null ? 0 : xy(0, hover).x
  if (!points.length) return <div className="monitor-chart-empty">—</div>
  return <div className="interactive-monitor-chart">
    <div className="monitor-chart-legend">{series.map(item => <span key={item.key}><i style={{ background: item.color }} />{item.label}</span>)}{threshold != null && <span><i className="threshold" />{threshold}{unit}</span>}</div>
    <div className="monitor-chart-stage">
      <div className="monitor-chart-y-axis">{[1,.75,.5,.25,0].map(ratio=><span key={ratio}>{compact(max*ratio,locale)}</span>)}</div>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        {[0, .25, .5, .75, 1].map(ratio => <line key={ratio} className="monitor-chart-gridline" x1={padX} x2={width - padX} y1={padY + ratio * (height - padY * 2)} y2={padY + ratio * (height - padY * 2)} />)}
        {threshold != null && <line className="monitor-chart-threshold" x1={padX} x2={width - padX} y1={xy(threshold, 0).y} y2={xy(threshold, 0).y} />}
        {series.map(item => <polyline key={item.key} stroke={item.color} points={points.map((point, index) => { const p = xy(Number(point.values[item.key]) || 0, index); return `${p.x},${p.y}` }).join(' ')} />)}
        {hoverPoint && <><line className="monitor-chart-crosshair" x1={hoverX} x2={hoverX} y1={padY} y2={height - padY} />{series.map(item => { const point = xy(Number(hoverPoint.values[item.key]) || 0, hover!); return <circle key={item.key} cx={point.x} cy={point.y} r="5" fill="#fff" stroke={item.color} /> })}</>}
        {points.map((_, index) => { const x = xy(0, index).x, hit = Math.max(12, (width - padX * 2) / Math.max(1, points.length)); return <rect key={index} x={x - hit / 2} y="0" width={hit} height={height} fill="transparent" onMouseEnter={() => setHover(index)} onMouseLeave={() => setHover(null)} /> })}
      </svg>
      {hoverPoint && <div className="monitor-chart-tooltip" style={{ left: `${Math.min(86, Math.max(14, hover! / Math.max(1, points.length - 1) * 100))}%` }}><strong>{formatTime(hoverPoint.collected_at)}</strong>{series.map(item => <span key={item.key}><i style={{ background: item.color }} />{item.label}<b>{Number(hoverPoint.values[item.key] || 0).toLocaleString(locale)}{unit}</b></span>)}</div>}
    </div>
    <footer><span>{formatTime(points[0].collected_at)}</span><span>{formatTime(points.at(-1)!.collected_at)}</span></footer>
  </div>
}
