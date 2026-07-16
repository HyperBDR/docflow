import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { formatDate, normalizeLocale } from '../../i18n'
import type { WorkspaceResource } from '../../workspace/types'
import Icon from '../Icon'

export default function ResourceSummary({ items }: { items: WorkspaceResource[] }) {
  const { t, i18n } = useTranslation(['workspace', 'common'])
  const locale = normalizeLocale(i18n.language)
  if (!items.length) return <div className="workspace-empty"><Icon name="folder" size={30} /><p>{t('resources.empty')}</p></div>
  return <div className="workspace-resource-summary">{items.map(item => <Link to={`/demos/${item.id}`} key={item.id}>
    <span><Icon name="layout" /></span><div><strong>{item.title || t('resources.untitled')}</strong><small>{formatDate(item.updated_at, locale)}</small></div>
    <em className={item.status}>{t(`common:status.${item.status}`)}</em><b>{t('resources.steps', { count: item.step_count })}</b><b><Icon name="eye" size={13} />{item.views}</b>
  </Link>)}</div>
}
