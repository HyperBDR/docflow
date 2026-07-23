import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import type { Demo, Organization } from '../types'
import Icon from './Icon'

type TransferAction = 'copy' | 'move'

export default function SpaceTransferDialog({
  demo,
  busy,
  onClose,
  onTransfer,
  onError,
}: {
  demo: Demo
  busy: boolean
  onClose: () => void
  onTransfer: (action: TransferAction, targetOrganizationId: string) => Promise<void>
  onError: (error: unknown) => void
}) {
  const { t } = useTranslation('dashboard')
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState<TransferAction>('copy')
  const [targetId, setTargetId] = useState('')
  const source = organizations.find(item => item.id === demo.organization_id)
  const targets = useMemo(() => organizations.filter(item =>
    item.id !== demo.organization_id
    && item.status === 'active'
    && item.role === 'owner'
    && item.access_source === 'membership'
  ), [organizations, demo.organization_id])
  const sourceOwned = Boolean(source && source.role === 'owner' && source.access_source === 'membership')

  useEffect(() => {
    api.organizations()
      .then(items => {
        setOrganizations(items)
        const first = items.find(item => item.id !== demo.organization_id && item.status === 'active' && item.role === 'owner' && item.access_source === 'membership')
        setTargetId(first?.id || '')
      })
      .catch(onError)
      .finally(() => setLoading(false))
    // The dialog target is stable for its lifetime; avoid refetching when the
    // parent recreates its toast callback during unrelated renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo.organization_id])

  const unavailable = !loading && (!sourceOwned || !targets.length)
  return <div className="library-dialog-layer" onMouseDown={event => event.target === event.currentTarget && !busy && onClose()}>
    <div className="library-dialog space-transfer-dialog">
      <header><span><Icon name="move" /></span><div><strong>{t('spaceTransfer.title')}</strong><small>{t('spaceTransfer.subtitle')}</small></div><button disabled={busy} onClick={onClose}>×</button></header>
      <div className="library-dialog-body">
        <div className="space-transfer-route">
          <div><small>{t('spaceTransfer.source')}</small><strong>{source?.name || t('spaceTransfer.loading')}</strong></div>
          <Icon name="arrowRight" />
          <div><small>{t('spaceTransfer.target')}</small><strong>{organizations.find(item => item.id === targetId)?.name || '—'}</strong></div>
        </div>

        <div className="space-transfer-actions" role="radiogroup" aria-label={t('spaceTransfer.operation')}>
          {(['copy', 'move'] as const).map(value => <button key={value} type="button" role="radio" aria-checked={action === value} className={action === value ? 'active' : ''} onClick={() => setAction(value)}>
            <span><Icon name={value === 'copy' ? 'copy' : 'move'} /></span><div><strong>{t(`spaceTransfer.${value}`)}</strong><small>{t(`spaceTransfer.${value}Description`)}</small></div>{action === value && <Icon name="check" />}
          </button>)}
        </div>

        {loading ? <p className="space-transfer-notice"><Icon name="clock" />{t('spaceTransfer.loading')}</p> : unavailable ? <p className="space-transfer-notice warning"><Icon name="warning" />{!sourceOwned ? t('spaceTransfer.sourceOwnerRequired') : t('spaceTransfer.noTargets')}</p> : <label className="space-transfer-target">{t('spaceTransfer.selectTarget')}<select value={targetId} onChange={event => setTargetId(event.target.value)}>{targets.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>}

        <div className="space-transfer-impact"><Icon name="warning" /><div><strong>{t('spaceTransfer.beforeYouContinue')}</strong><p>{action === 'move' ? t('spaceTransfer.moveImpact') : t('spaceTransfer.copyImpact')}</p><p>{t('spaceTransfer.taxonomyImpact')}</p><p>{t('spaceTransfer.quotaImpact')}</p></div></div>
        <div className="dialog-actions"><button disabled={busy} onClick={onClose}>{t('common:actions.cancel')}</button><button className="primary" disabled={busy || loading || unavailable || !targetId} onClick={() => onTransfer(action, targetId)}>{busy ? t('spaceTransfer.processing') : t(`spaceTransfer.confirm${action === 'copy' ? 'Copy' : 'Move'}`)}</button></div>
      </div>
    </div>
  </div>
}
