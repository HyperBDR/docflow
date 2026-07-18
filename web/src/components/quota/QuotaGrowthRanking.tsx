import { useTranslation } from 'react-i18next'
import { normalizeLocale } from '../../i18n'
import { formatQuotaValue } from '../../quota/catalog'
import type { QuotaMetricKey, QuotaSpace } from '../../quota/types'

const colors = ['#6257e7', '#2875bd', '#16839b', '#188052', '#ba477f', '#b96925', '#7b4eb8', '#178078', '#bd4150', '#9a7112']

export default function QuotaGrowthRanking({ spaces, metric }: { spaces: QuotaSpace[]; metric: QuotaMetricKey }) {
  const { i18n } = useTranslation(), locale = normalizeLocale(i18n.language)
  const values = spaces.map(space => Number(space.items.find(item => item.key === metric)?.used || 0))
  const maximum = Math.max(1, ...values)
  return <div className="quota-ranking-bars">{spaces.map((space, index) => {
    const item = space.items.find(current => current.key === metric), used = Number(item?.used || 0)
    const width = used ? Math.max(3, used / maximum * 100) : 0
    return <article key={space.id}>
      <b className={index < 3 ? 'top' : ''}>{index + 1}</b>
      <span><strong title={space.name}>{space.name}</strong><small title={`${space.owner_name || space.owner_email} · ${space.plan.name}`}>{space.owner_name || space.owner_email} · {space.plan.name}</small></span>
      <div className="quota-ranking-bar"><i><em style={{ width: `${width}%`, background: colors[index % colors.length] }} /></i><strong>{formatQuotaValue(metric, used, locale)}</strong></div>
      <em className={space.growth_percent > 0 ? 'up' : space.growth_percent < 0 ? 'down' : ''}>{space.growth_percent > 0 ? '+' : ''}{space.growth_percent}%</em>
    </article>
  })}</div>
}
