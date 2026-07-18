import { useId, useMemo, useState } from 'react'
import FloatingChartTooltip, { type ChartPointer } from './FloatingChartTooltip'
import { chartTickIndices, smoothPath, type ChartCoordinate } from './geometry'
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
  const [pointer, setPointer] = useState<ChartPointer | null>(null)
  const id = useId().replaceAll(':', '')
  const width = 920, height = 250, padX = 48, padY = 26, baseline = height - padY
  const max = useMemo(() => Math.max(1, threshold?.value || 0, ...points.flatMap(point => series.map(item => Number(point.values[item.key]) || 0))), [points, series, threshold])
  const coordinate = (value: number, index: number): ChartCoordinate => ({
    x: padX + index * (width - padX * 2) / Math.max(1, points.length - 1),
    y: baseline - value / max * (height - padY * 2),
  })
  const coordinates = series.map(item => points.map((point, index) => coordinate(Number(point.values[item.key]) || 0, index)))
  const ticks = chartTickIndices(points.length)
  const active = hover == null ? null : points[hover]
  if (!points.length) return <div className="product-chart-empty">—</div>
  return <div className={`product-line-chart ${className}`.trim()}>
    <div className="product-chart-legend">{series.map(item => <span key={item.key}><i style={{ background: item.color }} />{item.label}</span>)}{threshold && <span><i className="threshold" />{threshold.label}</span>}</div>
    <div className="product-chart-stage">
      <div className="product-chart-y-axis">{[1, .75, .5, .25, 0].map(ratio => <span key={ratio}>{formatValue(max * ratio, series[0])}</span>)}</div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={ariaLabel}
        onPointerMove={event => setPointer({ x: event.clientX, y: event.clientY })}
        onPointerLeave={() => { setHover(null); setPointer(null) }}
      >
        <defs>{series.map(item => <linearGradient key={item.key} id={`product-area-${id}-${item.key}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={item.color} stopOpacity=".20" /><stop offset="100%" stopColor={item.color} stopOpacity=".015" /></linearGradient>)}</defs>
        {[0, .25, .5, .75, 1].map(ratio => <line key={ratio} className="product-chart-grid" x1={padX} x2={width - padX} y1={padY + ratio * (height - padY * 2)} y2={padY + ratio * (height - padY * 2)} />)}
        {ticks.map(index => <line key={points[index].key} className="product-chart-grid product-chart-grid-x" x1={coordinate(0, index).x} x2={coordinate(0, index).x} y1={padY} y2={baseline} />)}
        {series.map((item, seriesIndex) => {
          const current = coordinates[seriesIndex], path = smoothPath(current)
          const area = current.length ? `${path} L ${current.at(-1)!.x} ${baseline} L ${current[0].x} ${baseline} Z` : ''
          return <g key={item.key}>{item.area !== false && area && <path className="product-chart-area" d={area} fill={`url(#product-area-${id}-${item.key})`} />}<path className={`product-chart-line${item.dashed ? ' dashed' : ''}`} d={path} stroke={item.color} /></g>
        })}
        {threshold && <line className="product-chart-threshold" x1={padX} x2={width - padX} y1={coordinate(threshold.value, 0).y} y2={coordinate(threshold.value, 0).y} />}
        {active && hover != null && <line className="product-chart-crosshair" x1={coordinate(0, hover).x} x2={coordinate(0, hover).x} y1={padY} y2={baseline} />}
        {points.map((point, index) => { const x = coordinate(0, index).x, hit = Math.max(12, (width - padX * 2) / Math.max(1, points.length)); return <rect key={point.key} x={x - hit / 2} y="0" width={hit} height={height} fill="transparent" onPointerEnter={event => { setHover(index); setPointer({ x: event.clientX, y: event.clientY }) }} /> })}
      </svg>
      <div className="product-chart-point-layer" aria-hidden="true">
        {active && hover != null && series.map((item, seriesIndex) => <i key={item.key} className="product-chart-hover-point" style={{ left: `${coordinates[seriesIndex][hover].x / width * 100}%`, top: `${coordinates[seriesIndex][hover].y / height * 100}%`, borderColor: item.color }} />)}
      </div>
      {active && hover != null && pointer && <FloatingChartTooltip className="product-chart-tooltip" pointer={pointer}><strong>{active.label}</strong>{series.map(item => <span key={item.key}><i style={{ background: item.color }} />{item.label}<b>{formatValue(Number(active.values[item.key]) || 0, item)}</b></span>)}</FloatingChartTooltip>}
    </div>
    <div className="product-chart-x-axis" style={{ gridTemplateColumns: `repeat(${ticks.length}, minmax(0, 1fr))` }}>{ticks.map(index => <span key={points[index].key}>{points[index].axisLabel || points[index].label}</span>)}</div>
  </div>
}
