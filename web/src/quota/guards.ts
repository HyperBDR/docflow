import { formatQuotaValue } from './catalog'
import type { QuotaActionKey, WorkspaceCapabilities } from '../workspace/types'

export function quotaAllowed(value: WorkspaceCapabilities | null, action: QuotaActionKey) {
  return value?.actions[action]?.allowed !== false
}

export function quotaGuardTitle(
  value: WorkspaceCapabilities | null,
  action: QuotaActionKey,
  translate: (key: string, options?: Record<string, unknown>) => string,
  locale: string,
) {
  const blockers = value?.actions[action]?.blockers || []
  if (!blockers.length) return ''
  return blockers.map(blocker => {
    const reason = translate(`common:errors.codes.${blocker.code}`)
    return `${reason} ${translate('common:quotaGuard.usage', {
      used: formatQuotaValue(blocker.metric, blocker.used, locale),
      limit: formatQuotaValue(blocker.metric, blocker.limit, locale),
    })}`
  }).join('\n')
}
