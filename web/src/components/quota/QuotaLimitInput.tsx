import { quotaLimitInputValue, quotaLimitStorageValue, quotaMetric } from '../../quota/catalog'
import type { QuotaMetricKey } from '../../quota/types'
import '../../styles/quota-controls.css'

export default function QuotaLimitInput({ metric, value, placeholder, disabled = false, onChange }: {
  metric: QuotaMetricKey
  value: number | null | undefined
  placeholder?: string
  disabled?: boolean
  onChange: (value: number | null) => void
}) {
  const unit = quotaMetric(metric).inputUnit
  return <span className={`quota-limit-input${unit ? ' quota-limit-input--unit' : ''}`}>
    <input
      type="number"
      min="0"
      step={unit === 'MB' ? '1' : '1'}
      disabled={disabled}
      value={quotaLimitInputValue(metric, value)}
      placeholder={placeholder}
      onChange={event => onChange(quotaLimitStorageValue(metric, event.target.value))}
    />
    {unit && <em>{unit}</em>}
  </span>
}
