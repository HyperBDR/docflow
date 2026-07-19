import { tr } from './locale'
import type { Locale } from './types'

export type QuotaMetric = 'storage_bytes'|'resources'|'max_steps_per_resource'|'members'|'active_shares'|'monthly_ai_tokens'|'monthly_exports'|'monthly_video_minutes'|'monthly_public_views'|'monthly_download_bytes'
export type QuotaAction = 'create_resource'|'duplicate_resource'|'merge_resources'|'record_step'|'use_ai'|'create_share'|'publish'|'export'|'export_video'|'invite_member'
export type QuotaBlocker = { metric: QuotaMetric; code: string; used: number; limit: number; remaining: number; resets_at: string }
export type WorkspaceCapabilities = {
  organization_id: string
  generated_at: string
  demo_step_count: number
  items: WorkspaceQuotaItem[]
  actions: Record<QuotaAction, { allowed: boolean; blockers: QuotaBlocker[] }>
}
export type WorkspaceQuotaItem = { key: QuotaMetric; used: number; limit: number | null; percent: number; status: 'normal'|'warning'|'exceeded'; enforcement: 'soft'|'hard' }
export type WorkspaceQuotaSummary = {
  organization_id: string
  plan: { id: string; name: string; description: string }
  items: WorkspaceQuotaItem[]
  period: { starts_at: string; resets_at: string }
  has_overrides: boolean
}

const messageKeys: Record<QuotaMetric, 'quotaStorageExceeded'|'quotaResourcesExceeded'|'quotaStepsExceeded'|'quotaMembersExceeded'|'quotaSharesExceeded'|'quotaAIExceeded'|'quotaExportsExceeded'|'quotaVideoExceeded'|'quotaViewsExceeded'|'quotaDownloadsExceeded'> = {
  storage_bytes: 'quotaStorageExceeded', resources: 'quotaResourcesExceeded', max_steps_per_resource: 'quotaStepsExceeded',
  members: 'quotaMembersExceeded', active_shares: 'quotaSharesExceeded', monthly_ai_tokens: 'quotaAIExceeded',
  monthly_exports: 'quotaExportsExceeded', monthly_video_minutes: 'quotaVideoExceeded', monthly_public_views: 'quotaViewsExceeded',
  monthly_download_bytes: 'quotaDownloadsExceeded',
}

const recovery: Partial<Record<QuotaMetric, Record<Locale, string>>> = {
  storage_bytes: {
    'zh-CN': '请删除不再需要的资源或导出文件释放空间，或联系空间管理员提升存储配额。',
    en: 'Delete unused resources or exports to free storage, or ask a workspace administrator to increase the storage quota.',
  },
  resources: {
    'zh-CN': '请删除不再需要的资源，或联系空间管理员提高资源数量配额。',
    en: 'Delete resources you no longer need, or ask a workspace administrator to increase the resource quota.',
  },
  max_steps_per_resource: {
    'zh-CN': '请删除该演示中不再需要的步骤，或联系空间管理员提高单资源步骤上限。',
    en: 'Delete unnecessary steps from this demo, or ask a workspace administrator to increase the per-resource step limit.',
  },
}

const quotaEndCopy = {
  'zh-CN': {
    title: '录制已自动结束',
    saved: '达到配额上限前已完成的步骤均已保存。处理配额问题后，可以从编辑器继续录制。',
    open: '打开演示',
    close: '知道了',
  },
  en: {
    title: 'Recording ended automatically',
    saved: 'All steps completed before the quota limit were saved. Resolve the quota issue, then continue recording from the editor.',
    open: 'Open demo',
    close: 'Got it',
  },
} as const satisfies Record<Locale, Record<string, string>>

export function quotaEndedText(locale: Locale) {
  return quotaEndCopy[locale]
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
  return blockers.map(blocker => {
    const message = `${tr(locale, messageKeys[blocker.metric])} ${tr(locale, 'quotaUsage', {
      used: formatValue(blocker.metric, blocker.used, locale), limit: formatValue(blocker.metric, blocker.limit, locale),
    })}`
    return recovery[blocker.metric]?.[locale] ? `${message}\n${recovery[blocker.metric]![locale]}` : message
  }).join('\n')
}

export function quotaMetricMessage(metric: QuotaMetric, used: number, limit: number, locale: Locale) {
  const message = `${tr(locale, messageKeys[metric])} ${tr(locale, 'quotaUsage', {
    used: formatValue(metric, used, locale), limit: formatValue(metric, limit, locale),
  })}`
  return recovery[metric]?.[locale] ? `${message}\n${recovery[metric]![locale]}` : message
}

export function quotaApiError(payload: { code?: string; detail?: string; quota?: { metric?: QuotaMetric; used?: number; limit?: number } }, locale: Locale) {
  const metric = payload.quota?.metric
  if (!metric || !messageKeys[metric]) return payload.detail || tr(locale, 'serviceUnavailable')
  return `${tr(locale, messageKeys[metric])} ${tr(locale, 'quotaUsage', {
    used: formatValue(metric, Number(payload.quota?.used || 0), locale),
    limit: formatValue(metric, Number(payload.quota?.limit || 0), locale),
  })}`
}
