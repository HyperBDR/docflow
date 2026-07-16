import { useTranslation } from 'react-i18next'
import { formatDate, normalizeLocale } from '../../i18n'
import type { MonitoringService } from '../../monitoring/types'
import Icon, { type IconName } from '../Icon'

const ICONS: Record<string, IconName> = { postgres: 'database', redis: 'database', storage: 'folder', worker: 'clock' }

export default function HealthCard({ value, onOpen }: { value: MonitoringService; onOpen?: () => void }) {
  const { t, i18n } = useTranslation(['monitoring', 'common'])
  return <article className={`monitor-health-card ${value.status} ${onOpen ? 'clickable' : ''}`} role={onOpen ? 'button' : undefined} tabIndex={onOpen ? 0 : undefined} onClick={onOpen} onKeyDown={event => { if (onOpen && (event.key === 'Enter' || event.key === ' ')) onOpen() }}><header><span><Icon name={ICONS[value.key] || 'analytics'} /></span><em>{t(`common:status.${value.status}`, { defaultValue: t(`status.${value.status}`) })}</em></header><strong>{t(`services.${value.key}`)}</strong><p>{value.message || t(`services.${value.key}Hint`)}</p><footer><span>{value.unit === 'ms' ? `${value.value.toFixed(1)} ms` : value.unit === 'percent' ? `${value.value.toFixed(1)}%` : '—'}</span><time>{value.collected_at ? formatDate(value.collected_at, normalizeLocale(i18n.language)) : t('never')}</time></footer></article>
}
