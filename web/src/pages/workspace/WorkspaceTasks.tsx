import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import JobList from '../../components/workspace/JobList'
import Icon from '../../components/Icon'
import { workspaceApi } from '../../workspace/api'
import type { WorkspaceJobPage, WorkspaceJobStatus } from '../../workspace/types'

const STATUSES: (WorkspaceJobStatus | '')[] = ['', 'queued', 'running', 'complete', 'failed', 'cancelled']
const JOB_STATUSES: WorkspaceJobStatus[] = ['queued', 'running', 'complete', 'failed', 'cancelled']

export default function WorkspaceTasks() {
  const { t } = useTranslation(['workspace', 'common'])
  const [status, setStatus] = useState<WorkspaceJobStatus | ''>('')
  const [type, setType] = useState<'ai' | 'export' | ''>('')
  const [page, setPage] = useState(1)
  const [value, setValue] = useState<WorkspaceJobPage | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(() => workspaceApi.jobs({ status, job_type: type, page }).then(setValue).catch(reason => setError(reason.message)), [status, type, page])
  useEffect(() => { setError(''); load() }, [load])
  useEffect(() => {
    if (!value?.items.some(item => item.status === 'queued' || item.status === 'running')) return
    const timer = window.setInterval(load, 4000)
    return () => window.clearInterval(timer)
  }, [value?.items, load])
  return <main className="workspace-page workspace-tasks">
    <header className="workspace-page-heading"><div><h1>{t('tasks.title')}</h1><p>{t('tasks.subtitle')}</p></div><button onClick={load}><Icon name="clock" />{t('actions.refresh')}</button></header>
    <section className="workspace-task-summary">{JOB_STATUSES.map(key => <button key={key} className={status === key ? `active ${key}` : key} onClick={() => { setStatus(status === key ? '' : key); setPage(1) }}><small>{t(`common:status.${key}`)}</small><strong>{value?.summary[key] ?? 0}</strong></button>)}</section>
    <section className="workspace-panel workspace-task-center"><header><div className="workspace-task-filters"><select value={type} onChange={event => { setType(event.target.value as typeof type); setPage(1) }}><option value="">{t('jobs.allTypes')}</option><option value="ai">{t('jobs.types.ai')}</option><option value="export">{t('jobs.types.export')}</option></select><select value={status} onChange={event => { setStatus(event.target.value as WorkspaceJobStatus | ''); setPage(1) }}>{STATUSES.map(key => <option key={key || 'all'} value={key}>{key ? t(`common:status.${key}`) : t('jobs.allStatuses')}</option>)}</select></div><span>{t('jobs.total', { count: value?.total ?? 0 })}</span></header>
      {error ? <div className="workspace-state error">{error}</div> : !value ? <div className="workspace-state">{t('loading')}</div> : <JobList items={value.items} />}
      {value && value.total > value.page_size && <footer className="workspace-pagination"><button disabled={page === 1} onClick={() => setPage(value => value - 1)}><Icon name="chevronLeft" />{t('actions.previous')}</button><span>{t('jobs.page', { page, pages: Math.ceil(value.total / value.page_size) })}</span><button disabled={page >= Math.ceil(value.total / value.page_size)} onClick={() => setPage(value => value + 1)}>{t('actions.next')}<Icon name="chevronRight" /></button></footer>}
    </section>
  </main>
}
