import { useTranslation } from 'react-i18next'
import type { AlertSeverity } from '../../monitoring/types'

export default function SeverityBadge({ value }: { value: AlertSeverity }) {
  const { t } = useTranslation('monitoring')
  return <span className={`monitor-severity ${value}`}><i />{t(`severity.${value}`)}</span>
}
