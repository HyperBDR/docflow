export default function QuotaDistribution({ title, center, items, labels }: {
  title: string; center: string; items: { key: string; label: string; value: number }[]; labels?: Record<string, string>
}) {
  const colors = ['#635bff', '#22a660', '#ef8b3b', '#e05260', '#3d9be9', '#c45ac6']
  const total = items.reduce((sum, item) => sum + item.value, 0)
  let angle = 0
  const stops = items.map((item, index) => {
    const start = angle, end = angle + item.value / Math.max(1, total) * 360
    angle = end
    return `${colors[index % colors.length]} ${start}deg ${end}deg`
  }).join(',')
  return <section className="quota-distribution-card"><header><strong>{title}</strong></header><div><div className="quota-donut" style={{ background: total ? `conic-gradient(${stops})` : '#edf0f4' }}><span><b>{total}</b><small>{center}</small></span></div><ul>{items.map((item, index) => <li key={item.key}><i style={{ background: colors[index % colors.length] }} /><span>{labels?.[item.key] || item.label}</span><b>{item.value}</b></li>)}</ul></div></section>
}
