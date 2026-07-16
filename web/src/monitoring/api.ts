import { request } from '../api'
import type { AlertEvent, AlertEventPage, AlertRule, AlertRuleInput, MetricDefinition, MonitoringOverview, NotificationChannel, NotificationChannelInput } from './types'

const params = (values: Record<string, string | number | undefined>) => {
  const result = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) if (value !== '' && value !== undefined) result.set(key, String(value))
  return result.toString()
}

export const monitoringApi = {
  overview: () => request<MonitoringOverview>('/api/admin/monitoring/overview'),
  collect: () => request<{ observations: Record<string, number>; collected_at: string }>('/api/admin/monitoring/collect', { method: 'POST' }),
  metrics: () => request<MetricDefinition[]>('/api/admin/monitoring/metrics'),
  rules: () => request<AlertRule[]>('/api/admin/monitoring/rules'),
  createRule: (value: AlertRuleInput) => request<AlertRule>('/api/admin/monitoring/rules', { method: 'POST', body: JSON.stringify(value) }),
  updateRule: (id: string, value: Partial<AlertRuleInput>) => request<AlertRule>(`/api/admin/monitoring/rules/${id}`, { method: 'PATCH', body: JSON.stringify(value) }),
  deleteRule: (id: string) => request<void>(`/api/admin/monitoring/rules/${id}`, { method: 'DELETE' }),
  alerts: (filters: { status?: string; severity?: string; page?: number; page_size?: number } = {}) => request<AlertEventPage>(`/api/admin/monitoring/alerts?${params(filters)}`),
  acknowledge: (id: string) => request<AlertEvent>(`/api/admin/monitoring/alerts/${id}/acknowledge`, { method: 'POST' }),
  channels: () => request<NotificationChannel[]>('/api/admin/monitoring/channels'),
  createChannel: (value: NotificationChannelInput) => request<NotificationChannel>('/api/admin/monitoring/channels', { method: 'POST', body: JSON.stringify(value) }),
  updateChannel: (id: string, value: Partial<NotificationChannelInput>) => request<NotificationChannel>(`/api/admin/monitoring/channels/${id}`, { method: 'PATCH', body: JSON.stringify(value) }),
  testChannel: (id: string) => request<NotificationChannel>(`/api/admin/monitoring/channels/${id}/test`, { method: 'POST' }),
  deleteChannel: (id: string) => request<void>(`/api/admin/monitoring/channels/${id}`, { method: 'DELETE' }),
}
