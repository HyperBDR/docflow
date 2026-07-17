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
}
export type QuotaSpaceHistory = { organization_id: string; points: { date: string; metrics: Partial<Record<QuotaMetricKey, { used: number; limit: number | null; percent: number }>> }[] }
