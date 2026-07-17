import InteractiveLineChart from '../charts/InteractiveLineChart'

export type QuotaTrendPoint = { date: string; used: number; limit: number; percent: number }

function axisDate(value: string) {
  const parts = value.split('-')
  return parts.length === 3 ? `${parts[1]}/${parts[2]}` : value
}

export default function QuotaTrendChart({ points, formatValue, usedLabel, limitLabel }: {
  points: QuotaTrendPoint[]; formatValue: (value: number) => string; usedLabel: string; limitLabel: string
}) {
  return <InteractiveLineChart
    className="quota-standard-chart"
    ariaLabel={`${usedLabel} / ${limitLabel}`}
    points={points.map(point => ({ key: point.date, label: axisDate(point.date), values: { used: point.used, limit: point.limit } }))}
    series={[{ key: 'used', label: usedLabel, color: '#635bff' }, { key: 'limit', label: limitLabel, color: '#aeb6c4', area: false, dashed: true }]}
    formatValue={value => formatValue(value)}
  />
}
