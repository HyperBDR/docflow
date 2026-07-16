import Icon, { type IconName } from '../Icon'

export default function MetricCard({ icon, label, value, detail, tone = '' }: { icon: IconName; label: string; value: string; detail: string; tone?: 'success' | 'warning' | 'danger' | '' }) {
  return <article className={`workspace-metric ${tone}`}>
    <span><Icon name={icon} size={20} /></span>
    <div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div>
  </article>
}
