import { tr } from './locale'
import type { Locale } from './types'

export type QuotaMetric = 'storage_bytes'|'resources'|'max_steps_per_resource'|'members'|'active_shares'|'monthly_ai_tokens'|'monthly_exports'|'monthly_video_minutes'|'monthly_public_views'|'monthly_download_bytes'
export type QuotaAction = 'create_resource'|'duplicate_resource'|'merge_resources'|'record_step'|'use_ai'|'create_share'|'publish'|'export'|'export_video'|'invite_member'
export type QuotaBlocker = { metric: QuotaMetric; code: string; used: number; limit: number; remaining: number; resets_at: string }
export type WorkspaceCapabilities = { organization_id: string; generated_at: string; actions: Record<QuotaAction, { allowed: boolean; blockers: QuotaBlocker[] }> }

const messageKeys: Record<QuotaMetric, 'quotaStorageExceeded'|'quotaResourcesExceeded'|'quotaStepsExceeded'|'quotaMembersExceeded'|'quotaSharesExceeded'|'quotaAIExceeded'|'quotaExportsExceeded'|'quotaVideoExceeded'|'quotaViewsExceeded'|'quotaDownloadsExceeded'> = {
  storage_bytes: 'quotaStorageExceeded', resources: 'quotaResourcesExceeded', max_steps_per_resource: 'quotaStepsExceeded',
  members: 'quotaMembersExceeded', active_shares: 'quotaSharesExceeded', monthly_ai_tokens: 'quotaAIExceeded',
  monthly_exports: 'quotaExportsExceeded', monthly_video_minutes: 'quotaVideoExceeded', monthly_public_views: 'quotaViewsExceeded',
  monthly_download_bytes: 'quotaDownloadsExceeded',
}

function formatValue(metric: QuotaMetric, value: number, locale: Locale) {
  if (metric === 'storage_bytes' || metric === 'monthly_download_bytes') {
    if (!value) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)))
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1024 ** index)} ${units[index]}`
  }
  return new Intl.NumberFormat(locale, { notation: value >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value)
}

export function quotaAllowed(value: WorkspaceCapabilities | null | undefined, action: QuotaAction) {
  return value?.actions[action]?.allowed === true
}

export function quotaMessage(value: WorkspaceCapabilities | null | undefined, action: QuotaAction, locale: Locale) {
  const blockers = value?.actions[action]?.blockers || []
  return blockers.map(blocker => `${tr(locale, messageKeys[blocker.metric])} ${tr(locale, 'quotaUsage', {
    used: formatValue(blocker.metric, blocker.used, locale), limit: formatValue(blocker.metric, blocker.limit, locale),
  })}`).join('\n')
}

export function quotaApiError(payload: { code?: string; detail?: string; quota?: { metric?: QuotaMetric; used?: number; limit?: number } }, locale: Locale) {
  const metric = payload.quota?.metric
  if (!metric || !messageKeys[metric]) return payload.detail || tr(locale, 'serviceUnavailable')
  return `${tr(locale, messageKeys[metric])} ${tr(locale, 'quotaUsage', {
    used: formatValue(metric, Number(payload.quota?.used || 0), locale),
    limit: formatValue(metric, Number(payload.quota?.limit || 0), locale),
  })}`
}
