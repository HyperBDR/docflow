import type { QuotaLimits } from '../types'

export type QuotaMetricKey = 'storage_bytes' | 'resources' | 'max_steps_per_resource' | 'members' | 'active_shares' | 'monthly_ai_tokens' | 'monthly_exports' | 'monthly_video_minutes' | 'monthly_public_views' | 'monthly_download_bytes'
export type QuotaHealth = 'normal' | 'warning' | 'exceeded'
export type QuotaMetricItem = { key: QuotaMetricKey; used: number; limit: number | null; percent: number; status: QuotaHealth; enforcement: 'hard' | 'soft' }
export type QuotaSpace = {
  id: string; name: string; slug: string; kind: 'team' | 'personal'; owner_name: string; owner_email: string; created_at: string
  plan: { id: string; name: string; description: string }
  assignment?: { plan_id: string; overrides: QuotaLimits } | null
  has_overrides: boolean; health: QuotaHealth; highest_metric: QuotaMetricKey; highest_percent: number; growth_percent: number; items: QuotaMetricItem[]
}
export type QuotaPlanStatistics = {
  id: string; name: string; description: string; is_default: boolean; limits: QuotaLimits; created_at: string; updated_at: string
  can_delete: boolean; delete_blocker: 'default' | 'in_use' | null
  statistics: { spaces: number; team_spaces: number; personal_spaces: number; normal: number; warning: number; exceeded: number; overrides: number }
}
export type QuotaOverview = {
  summary: Record<string, number>
  spaces: QuotaSpace[]
  trend: { date: string; used: number; limit: number; percent: number }[]
  by_kind: { key: string; label: string; value: number }[]
  by_plan: { key: string; label: string; value: number }[]
  by_health: { key: string; label: string; value: number }[]
  ranking: QuotaSpace[]
  filters: { days: number; metric: QuotaMetricKey; kind: string; plan_id: string; health: string }
  collected_at?: string | null
  automatic_collection: boolean
  interval_seconds: number
  next_collection_at?: string | null
}
export type QuotaSpaceHistory = { organization_id: string; points: { date: string; metrics: Partial<Record<QuotaMetricKey, { used: number; limit: number | null; percent: number }>> }[] }
export type PlatformQuotaImpact = {
  affected_plans: { id: string; name: string; metrics: QuotaMetricKey[] }[]
  affected_spaces: { id: string; name: string; kind: 'team' | 'personal'; plan_name: string; metrics: QuotaMetricKey[] }[]
  affected_plan_count: number
  affected_space_count: number
  metric_plan_counts: Record<QuotaMetricKey, number>
  metric_space_counts: Record<QuotaMetricKey, number>
}
export type PlatformQuotaMetric = {
  key: QuotaMetricKey; maximum: number; allow_unlimited: boolean
  default_plan_value: number | null; highest_plan_value: number; affected_plans: number; affected_spaces: number
  total_used: number; capacity_percent: number; growth_percent: number; trend: { date: string; used: number }[]
}
export type PlatformQuotaLimits = {
  maximums: Record<QuotaMetricKey, number>
  allow_unlimited: Record<QuotaMetricKey, boolean>
  metrics: PlatformQuotaMetric[]
  impact: PlatformQuotaImpact
  updated_at?: string | null
}
export type PlatformQuotaPreview = PlatformQuotaImpact & {
  maximums: Record<QuotaMetricKey, number>
  allow_unlimited: Record<QuotaMetricKey, boolean>
}
