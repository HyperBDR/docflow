import { useTranslation } from 'react-i18next'
import Icon from './Icon'

export default function AdminPagination({ page, pageSize, total, onPage, onPageSize }: {
  page: number; pageSize: number; total: number; onPage: (page: number) => void; onPageSize: (size: number) => void
}) {
  const { t } = useTranslation('admin')
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return <div className="admin-pagination">
    <span>{t('pagination.range', { from: total ? (page - 1) * pageSize + 1 : 0, to: Math.min(page * pageSize, total), total })}</span>
    <label>{t('pagination.perPage')}<select value={pageSize} onChange={event => onPageSize(Number(event.target.value))}>{[10, 20, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}</select></label>
    <div><button disabled={page <= 1} onClick={() => onPage(page - 1)}><Icon name="chevronLeft" /></button><b>{page} / {pages}</b><button disabled={page >= pages} onClick={() => onPage(page + 1)}><Icon name="chevronRight" /></button></div>
  </div>
}
