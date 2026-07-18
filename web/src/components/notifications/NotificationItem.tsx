import { useTranslation } from 'react-i18next'
import Icon, { type IconName } from '../Icon'
import type { InAppNotification } from '../../notifications/types'

function relativeTime(value: string, locale: string) {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000)
  const ranges: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]]
  const [unit, divisor] = ranges.find(([, size]) => Math.abs(seconds) >= size) || ['second', 1]
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(Math.round(seconds / divisor), unit)
}

const icons: Record<string, IconName> = { task: 'clock', quota: 'database', alert: 'warning', security: 'shield', team: 'users', system: 'bell' }

export function notificationCopy(item: InAppNotification, t: ReturnType<typeof useTranslation>['t']) {
  const metricKey = String(item.data.metric_key || '')
  const values = {
    ...item.data,
    title: item.title,
    metric: metricKey ? t(`workspace:quotas.metrics.${metricKey}`, { defaultValue: metricKey }) : '',
  }
  const key = `events.${item.event_type}`
  return {
    title: t(`${key}.title`, { ...values, defaultValue: item.title || item.event_type }),
    message: t(`${key}.message`, { ...values, defaultValue: item.message }),
  }
}

export default function NotificationItem({ item, compact = false, onOpen }: { item: InAppNotification; compact?: boolean; onOpen: (item: InAppNotification) => void }) {
  const { t, i18n } = useTranslation(['notifications', 'workspace'])
  const copy = notificationCopy(item, t)
  return <button type="button" className={`notification-item ${item.read_at ? 'read' : 'unread'} ${item.severity}${compact ? ' compact' : ''}`} onClick={() => onOpen(item)}>
    <span className="notification-item-icon"><Icon name={icons[item.category] || 'bell'} /></span>
    <span className="notification-item-copy"><strong>{copy.title}</strong><small>{copy.message}</small><time>{relativeTime(item.created_at, i18n.language)}</time></span>
    {!item.read_at && <i className="notification-unread-dot" />}
    {item.action_url && <Icon name="chevronRight" />}
  </button>
}
