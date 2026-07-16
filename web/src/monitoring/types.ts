export type HealthStatus = 'healthy' | 'warning' | 'critical' | 'unknown'
export type AlertSeverity = 'info' | 'warning' | 'critical'
export type AlertStatus = 'active' | 'acknowledged' | 'resolved'

export type MonitoringService = { key: string; status: HealthStatus; value: number; unit: string; message: string; metrics: Record<string, number | string | boolean>; collected_at?: string | null }
export type MonitoringTrendPoint = { collected_at: string; requests: number; status_2xx: number; status_4xx: number; status_5xx: number; error_rate: number; avg_latency_ms: number; p95_latency_ms: number; queued_jobs: number; failed_jobs: number; ai_failure_rate: number }
export type MonitoringOverview = {
  overall_status: HealthStatus
  services: MonitoringService[]
  api: Record<string, number>
  jobs: Record<string, number>
  storage: Record<string, number | string>
  ai: Record<string, number>
  active_alerts: Record<AlertSeverity, number>
  trend: MonitoringTrendPoint[]
  thresholds: Record<string, number>
  updated_at?: string | null
  next_collection_at?: string | null
  interval_seconds: number
  collector_stale: boolean
}
export type MetricHistoryPoint = { collected_at: string; status: HealthStatus; values: Record<string, number> }
export type MonitoringMetricDetail = {
  key: string; snapshot_key: string; category: string; status: HealthStatus; unit: string
  summary: Record<string, unknown>; points: MetricHistoryPoint[]; breakdown: Record<string, unknown>[]; alerts: AlertEvent[]
}
export type AlertRule = {
  id: string; name: string; metric_key: string; operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq'; threshold: number
  severity: AlertSeverity; consecutive_periods: number; cooldown_minutes: number; enabled: boolean; built_in: boolean
  failure_count: number; last_value?: number | null; last_evaluated_at?: string | null; last_triggered_at?: string | null; created_at: string; updated_at: string
}
export type AlertRuleInput = Pick<AlertRule, 'name' | 'metric_key' | 'operator' | 'threshold' | 'severity' | 'consecutive_periods' | 'cooldown_minutes' | 'enabled'>
export type AlertEvent = {
  id: string; rule_id?: string | null; metric_key: string; severity: AlertSeverity; status: AlertStatus; title: string; message: string
  current_value: number; threshold: number; started_at: string; last_seen_at: string; acknowledged_at?: string | null; acknowledged_by_name: string; resolved_at?: string | null
}
export type AlertEventPage = { items: AlertEvent[]; total: number; page: number; page_size: number }
export type MetricDefinition = { key: string; unit: string; recommended_operator: string; recommended_threshold: number }
export type NotificationChannel = {
  id: string; name: string; kind: 'webhook' | 'email'; target_masked: string; target_configured: boolean
  minimum_severity: AlertSeverity; enabled: boolean; last_status: string; last_error: string; last_sent_at?: string | null; created_at: string; updated_at: string
}
export type NotificationChannelInput = { name: string; kind: 'webhook' | 'email'; target: string; minimum_severity: AlertSeverity; enabled: boolean }
