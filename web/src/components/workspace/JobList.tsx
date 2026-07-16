import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { formatDate, normalizeLocale } from '../../i18n'
import type { WorkspaceJob } from '../../workspace/types'
import Icon from '../Icon'

export default function JobList({ items, compact = false }: { items: WorkspaceJob[]; compact?: boolean }) {
  const { t, i18n } = useTranslation(['workspace', 'common'])
  const locale = normalizeLocale(i18n.language)
  if (!items.length) return <div className="workspace-empty"><Icon name="clock" size={30} /><p>{t('jobs.empty')}</p></div>
  return <div className={`workspace-job-list ${compact ? 'compact' : ''}`}>{items.map(item => <article key={`${item.job_type}-${item.id}`}>
    <span className={`workspace-job-icon ${item.job_type}`}><Icon name={item.job_type === 'ai' ? 'ai' : 'download'} /></span>
    <div className="workspace-job-main"><div><Link to={`/demos/${item.resource_id}`}>{item.resource_title || t('resources.untitled')}</Link><span className={`workspace-status ${item.status}`}>{t(`common:status.${item.status}`)}</span></div><small>{t(`jobs.types.${item.job_type}`)} · {item.owner_name || '—'} · {formatDate(item.created_at, locale)}</small>{item.error_code && <p>{t(`common:errors.codes.${item.error_code}`, { defaultValue: item.error_code })}</p>}</div>
    <div className="workspace-job-progress"><span><i style={{ width: `${item.progress}%` }} /></span><small>{item.progress}%</small></div>
    {item.download_url && <a className="workspace-job-download" href={item.download_url}><Icon name="download" />{t('jobs.download')}</a>}
  </article>)}</div>
}
