import type { IconName } from '../components/Icon'
import type { QuotaMetricKey } from './types'

export type QuotaMetricDefinition = { key: QuotaMetricKey; icon: IconName; tone: string; byte?: boolean; inputUnit?: 'MB' }

const MEGABYTE = 1024 ** 2

export const QUOTA_METRICS: QuotaMetricDefinition[] = [
  { key: 'storage_bytes', icon: 'database', tone: 'violet', byte: true, inputUnit: 'MB' },
  { key: 'resources', icon: 'folder', tone: 'blue' },
  { key: 'max_steps_per_resource', icon: 'list', tone: 'cyan' },
  { key: 'members', icon: 'users', tone: 'green' },
  { key: 'active_shares', icon: 'share', tone: 'pink' },
  { key: 'monthly_ai_tokens', icon: 'ai', tone: 'purple' },
  { key: 'monthly_exports', icon: 'publish', tone: 'orange' },
  { key: 'monthly_video_minutes', icon: 'play', tone: 'red' },
  { key: 'monthly_public_views', icon: 'eye', tone: 'teal' },
  { key: 'monthly_download_bytes', icon: 'download', tone: 'gold', byte: true, inputUnit: 'MB' },
]

export function quotaMetric(key: string) { return QUOTA_METRICS.find(item => item.key === key) || QUOTA_METRICS[0] }

export function formatQuotaValue(key: string, value: number | null | undefined, locale: string) {
  if (value == null) return '—'
  if (quotaMetric(key).byte) {
    if (!value) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB'], index = Math.min(4, Math.floor(Math.log(value) / Math.log(1024)))
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1024 ** index)} ${units[index]}`
  }
  return new Intl.NumberFormat(locale, { notation: value >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value)
}

export function quotaLimitInputValue(key: string, value: number | null | undefined): number | '' {
  if (value == null) return ''
  return quotaMetric(key).inputUnit === 'MB' ? Number((value / MEGABYTE).toFixed(2)) : value
}

export function quotaLimitStorageValue(key: string, value: string): number | null {
  if (value === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  return quotaMetric(key).inputUnit === 'MB' ? Math.round(parsed * MEGABYTE) : parsed
}
