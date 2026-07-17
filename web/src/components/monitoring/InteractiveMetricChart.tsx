import { useTranslation } from 'react-i18next'
import { normalizeLocale } from '../../i18n'
import ProductLineChart from '../charts/InteractiveLineChart'

export type ChartPoint = { collected_at: string; values: Record<string, number> }
export type ChartSeries = { key: string; label: string; color: string }

export default function InteractiveMetricChart({ points, series, unit = '', threshold }: { points: ChartPoint[]; series: ChartSeries[]; unit?: string; threshold?: number }) {
  const { i18n } = useTranslation(), locale = normalizeLocale(i18n.language)
  const formatTime = (value: string) => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
  const formatAxisTime = (value: string) => new Intl.DateTimeFormat(locale, { month: '2-digit', day: '2-digit', hour: '2-digit' }).format(new Date(value))
  const formatValue = (value: number) => `${new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value)}${unit}`
  return <ProductLineChart
    className="interactive-monitor-chart"
    ariaLabel={series.map(item => item.label).join(' / ')}
    points={points.map(point => ({ key: point.collected_at, label: formatTime(point.collected_at), axisLabel: formatAxisTime(point.collected_at), values: point.values }))}
    series={series}
    threshold={threshold == null ? undefined : { value: threshold, label: formatValue(threshold) }}
    formatValue={formatValue}
  />
}
