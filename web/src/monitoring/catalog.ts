import type { IconName } from '../components/Icon'
import type { ChartSeries } from '../components/monitoring/InteractiveMetricChart'

export type MonitoringDetailKey = 'postgres' | 'redis' | 'storage' | 'worker' | 'api.requests' | 'api.latency' | 'api.error_rate' | 'jobs.queue' | 'storage.capacity' | 'ai.failure_rate'
export type MetricCatalogItem = { icon: IconName; title: string; unit?: string; series: ChartSeries[]; fields: string[] }

const colors = { purple: '#635bff', green: '#22a660', amber: '#ef8b3b', red: '#e05260', blue: '#3a91d8' }
export const monitoringCatalog: Record<MonitoringDetailKey, MetricCatalogItem> = {
  postgres: { icon: 'database', title: 'services.postgres', unit: ' ms', series: [{ key: 'latency_ms', label: 'details.series.latency', color: colors.purple }], fields: ['status', 'value', 'message', 'collected_at'] },
  redis: { icon: 'database', title: 'services.redis', unit: ' ms', series: [{ key: 'latency_ms', label: 'details.series.latency', color: colors.blue }], fields: ['status', 'value', 'message', 'collected_at'] },
  storage: { icon: 'folder', title: 'services.storage', unit: '%', series: [{ key: 'free_percent', label: 'details.series.freePercent', color: colors.green }], fields: ['total_bytes', 'used_bytes', 'free_bytes', 'free_percent', 'target', 'latency_ms'] },
  worker: { icon: 'clock', title: 'services.worker', series: [{ key: 'available', label: 'details.series.availability', color: colors.green }], fields: ['status', 'collector', 'collected_at'] },
  'api.requests': { icon: 'analytics', title: 'metrics.requests', series: [{ key: 'requests', label: 'details.series.requests', color: colors.purple }, { key: 'status_2xx', label: 'details.series.status2xx', color: colors.green }, { key: 'status_4xx', label: 'details.series.status4xx', color: colors.amber }, { key: 'status_5xx', label: 'details.series.status5xx', color: colors.red }], fields: ['requests', 'status_2xx', 'status_4xx', 'status_5xx'] },
  'api.latency': { icon: 'clock', title: 'metrics.p95', unit: ' ms', series: [{ key: 'avg_latency_ms', label: 'details.series.average', color: colors.blue }, { key: 'p95_latency_ms', label: 'details.series.p95', color: colors.purple }], fields: ['avg_latency_ms', 'p95_latency_ms', 'requests'] },
  'api.error_rate': { icon: 'warning', title: 'metrics.errorRate', unit: '%', series: [{ key: 'error_rate', label: 'details.series.errorRate', color: colors.red }], fields: ['error_rate', 'status_5xx', 'requests'] },
  'jobs.queue': { icon: 'list', title: 'metrics.queue', series: [{ key: 'queued', label: 'details.series.queued', color: colors.amber }, { key: 'running', label: 'details.series.running', color: colors.blue }, { key: 'failed_10m', label: 'details.series.failed', color: colors.red }], fields: ['queued', 'running', 'long_running', 'completed_10m', 'failed_10m', 'failure_rate_10m'] },
  'storage.capacity': { icon: 'database', title: 'metrics.storageFree', unit: '%', series: [{ key: 'free_percent', label: 'details.series.freePercent', color: colors.green }], fields: ['total_bytes', 'used_bytes', 'free_bytes', 'free_percent', 'target', 'latency_ms'] },
  'ai.failure_rate': { icon: 'ai', title: 'metrics.aiFailure', unit: '%', series: [{ key: 'failure_rate_10m', label: 'details.series.failureRate', color: colors.red }, { key: 'requests_10m', label: 'details.series.requests', color: colors.purple }], fields: ['enabled_models', 'requests_10m', 'tokens_10m', 'avg_latency_ms', 'failure_rate_10m'] },
}
