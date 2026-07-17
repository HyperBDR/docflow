import { formatNumber, type Locale } from '../../i18n'
import type { WorkspaceTrendPoint } from '../../workspace/types'
import ProductLineChart from '../charts/InteractiveLineChart'

export type WorkspaceTrendMetric = 'resources' | 'views' | 'ai_tokens' | 'jobs'

function axisDate(value: string) {
  const parts = value.split('-')
  return parts.length === 3 ? `${parts[1]}/${parts[2]}` : value
}

export default function TrendChart({ points, metric, label, locale }: { points: WorkspaceTrendPoint[]; metric: WorkspaceTrendMetric; label: string; locale: Locale }) {
  return <ProductLineChart
    className="workspace-standard-chart"
    ariaLabel={label}
    points={points.map(point => ({ key: point.date, label: axisDate(point.date), values: { [metric]: point[metric] } }))}
    series={[{ key: metric, label, color: '#635bff' }]}
    formatValue={value => formatNumber(value, locale)}
  />
}
