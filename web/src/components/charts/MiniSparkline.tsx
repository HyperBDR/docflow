import { useId, useState } from 'react'
import FloatingChartTooltip, { type ChartPointer } from './FloatingChartTooltip'
import { smoothPath } from './geometry'

export type MiniSparklinePoint = { key: string; label: string; value: number }

export default function MiniSparkline({ ariaLabel, color, formatValue, points }: {
  ariaLabel: string
  color: string
  formatValue: (value: number) => string
  points: MiniSparklinePoint[]
}) {
  const [active, setActive] = useState<number | null>(null)
  const [pointer, setPointer] = useState<ChartPointer | null>(null)
  const id = useId().replaceAll(':', '')
  const width = 180, height = 54, pad = 4
  const values = points.map(point => point.value)
  const min = Math.min(...values), max = Math.max(...values), range = Math.max(1, max - min), flat = max === min
  const coordinates = points.map((point, index) => ({
    x: pad + index * (width - pad * 2) / Math.max(1, points.length - 1),
    y: flat ? height / 2 : height - pad - (point.value - min) / range * (height - pad * 2),
  }))
  const path = smoothPath(coordinates)
  const area = coordinates.length ? `${path} L ${coordinates.at(-1)!.x} ${height - pad} L ${coordinates[0].x} ${height - pad} Z` : ''

  if (!points.length) return <span className="quota-sparkline-empty">—</span>
  return <span className="quota-sparkline">
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={ariaLabel}
      onPointerMove={event => {
        const bounds = event.currentTarget.getBoundingClientRect()
        const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width))
        setActive(Math.round(ratio * Math.max(0, points.length - 1)))
        setPointer({ x: event.clientX, y: event.clientY })
      }}
      onPointerLeave={() => { setActive(null); setPointer(null) }}>
      <defs><linearGradient id={`sparkline-${id}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".20" /><stop offset="100%" stopColor={color} stopOpacity=".02" /></linearGradient></defs>
      {area && <path className="quota-sparkline-area" d={area} fill={`url(#sparkline-${id})`} />}
      <path className="quota-sparkline-line" d={path} stroke={color} />
      {active != null && <circle cx={coordinates[active].x} cy={coordinates[active].y} r="3.5" stroke={color} />}
    </svg>
    {active != null && pointer && <FloatingChartTooltip className="product-chart-tooltip quota-sparkline-tooltip" pointer={pointer}><strong>{points[active].label}</strong><span><i style={{ background: color }} />{ariaLabel}<b>{formatValue(points[active].value)}</b></span></FloatingChartTooltip>}
  </span>
}
