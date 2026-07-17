import InteractiveDonut from '../charts/InteractiveDonut'

export default function QuotaDistribution({ title, center, items, labels }: {
  title: string; center: string; items: { key: string; label: string; value: number }[]; labels?: Record<string, string>
}) {
  return <section className="quota-distribution-card"><header><strong>{title}</strong></header><InteractiveDonut
    ariaLabel={title}
    centerLabel={center}
    items={items.map(item => ({ ...item, label: labels?.[item.key] || item.label }))}
  /></section>
}
