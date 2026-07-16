import type { MonitoringTrendPoint } from '../../monitoring/types'
import InteractiveMetricChart, { type ChartSeries } from './InteractiveMetricChart'

export default function MetricChart({ points, series, unit, threshold }: { points: MonitoringTrendPoint[]; series: ChartSeries[]; unit?: string; threshold?: number }) {
  return <div className="monitor-metric-chart"><InteractiveMetricChart points={points.map(({ collected_at, ...values }) => ({ collected_at, values }))} series={series} unit={unit} threshold={threshold} /></div>
}
