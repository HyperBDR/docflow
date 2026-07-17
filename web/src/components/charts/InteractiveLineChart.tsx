import { useId, useMemo, useState } from 'react'
import { chartTickIndices, sampledPointIndices, smoothPath, type ChartCoordinate } from './geometry'
import '../../styles/charts.css'

export type ProductChartPoint = { key: string; label: string; axisLabel?: string; values: Record<string, number> }
export type ProductChartSeries = { key: string; label: string; color: string; area?: boolean; dashed?: boolean }

export default function InteractiveLineChart({ points, series, formatValue, ariaLabel, threshold, className = '' }: {
  points: ProductChartPoint[]
  series: ProductChartSeries[]
  formatValue: (value: number, series: ProductChartSeries) => string
  ariaLabel: string
  threshold?: { value: number; label: string }
  className?: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const id = useId().replaceAll(':', '')
  const width = 920, height = 250, padX = 48, padY = 26, baseline = height - padY
  const max = useMemo(() => Math.max(1, threshold?.value || 0, ...points.flatMap(point => series.map(item => Number(point.values[item.key]) || 0))), [points, series, threshold])
  const coordinate = (value: number, index: number): ChartCoordinate => ({
    x: padX + index * (width - padX * 2) / Math.max(1, points.length - 1),
    y: baseline - value / max * (height - padY * 2),
  })
  const coordinates = series.map(item => points.map((point, index) => coordinate(Number(point.values[item.key]) || 0, index)))
  const ticks = chartTickIndices(points.length), samples = sampledPointIndices(points.length)
  const active = hover == null ? null : points[hover]
  if (!points.length) return <div className="product-chart-empty">—</div>
  return <div className={`product-line-chart ${className}`.trim()}>
    <div className="product-chart-legend">{series.map(item => <span key={item.key}><i style={{ background: item.color }} />{item.label}</span>)}{threshold && <span><i className="threshold" />{threshold.label}</span>}</div>
    <div className="product-chart-stage">
      <div className="product-chart-y-axis">{[1, .75, .5, .25, 0].map(ratio => <span key={ratio}>{formatValue(max * ratio, series[0])}</span>)}</div>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={ariaLabel}>
        <defs>{series.map(item => <linearGradient key={item.key} id={`product-area-${id}-${item.key}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={item.color} stopOpacity=".20" /><stop offset="100%" stopColor={item.color} stopOpacity=".015" /></linearGradient>)}</defs>
        {[0, .25, .5, .75, 1].map(ratio => <line key={ratio} className="product-chart-grid" x1={padX} x2={width - padX} y1={padY + ratio * (height - padY * 2)} y2={padY + ratio * (height - padY * 2)} />)}
        {ticks.map(index => <line key={points[index].key} className="product-chart-grid product-chart-grid-x" x1={coordinate(0, index).x} x2={coordinate(0, index).x} y1={padY} y2={baseline} />)}
        {series.map((item, seriesIndex) => {
          const current = coordinates[seriesIndex], path = smoothPath(current)
          const area = current.length ? `${path} L ${current.at(-1)!.x} ${baseline} L ${current[0].x} ${baseline} Z` : ''
          return <g key={item.key}>{item.area !== false && area && <path className="product-chart-area" d={area} fill={`url(#product-area-${id}-${item.key})`} />}<path className={`product-chart-line${item.dashed ? ' dashed' : ''}`} d={path} stroke={item.color} />{samples.map(index => <circle key={points[index].key} className="product-chart-point" cx={current[index].x} cy={current[index].y} r="3.3" style={{ stroke: item.color }} />)}</g>
        })}
        {threshold && <line className="product-chart-threshold" x1={padX} x2={width - padX} y1={coordinate(threshold.value, 0).y} y2={coordinate(threshold.value, 0).y} />}
        {active && hover != null && <><line className="product-chart-crosshair" x1={coordinate(0, hover).x} x2={coordinate(0, hover).x} y1={padY} y2={baseline} />{series.map((item, seriesIndex) => <circle key={item.key} className="product-chart-hover-point" cx={coordinates[seriesIndex][hover].x} cy={coordinates[seriesIndex][hover].y} r="5.5" style={{ stroke: item.color }} />)}</>}
        {points.map((point, index) => { const x = coordinate(0, index).x, hit = Math.max(12, (width - padX * 2) / Math.max(1, points.length)); return <rect key={point.key} x={x - hit / 2} y="0" width={hit} height={height} fill="transparent" onMouseEnter={() => setHover(index)} onMouseLeave={() => setHover(null)} /> })}
      </svg>
      {active && hover != null && <div className="product-chart-tooltip" style={{ left: `${Math.min(86, Math.max(14, hover / Math.max(1, points.length - 1) * 100))}%` }}><strong>{active.label}</strong>{series.map(item => <span key={item.key}><i style={{ background: item.color }} />{item.label}<b>{formatValue(Number(active.values[item.key]) || 0, item)}</b></span>)}</div>}
    </div>
    <div className="product-chart-x-axis" style={{ gridTemplateColumns: `repeat(${ticks.length}, minmax(0, 1fr))` }}>{ticks.map(index => <span key={points[index].key}>{points[index].axisLabel || points[index].label}</span>)}</div>
  </div>
}
