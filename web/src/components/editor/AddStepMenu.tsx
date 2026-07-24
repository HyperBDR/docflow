import { useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Icon from '../Icon'

export default function AddStepMenu({ open, busy, canDuplicate, onToggle, onUpload, onDuplicate, onRecord }: {
  open: boolean
  busy: boolean
  canDuplicate: boolean
  onToggle: () => void
  onUpload: () => void
  onDuplicate: () => void
  onRecord: () => void
}) {
  const { t } = useTranslation('editor')
  const controlRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const control = controlRef.current, menu = menuRef.current
    if (!open || !control || !menu) return
    const reserveSpace = () => control.style.setProperty('--add-step-menu-space', `${Math.ceil(menu.getBoundingClientRect().height) + 7}px`)
    reserveSpace()
    const observer = new ResizeObserver(reserveSpace)
    observer.observe(menu)
    const frame = requestAnimationFrame(() => menu.scrollIntoView({ block: 'nearest', inline: 'nearest' }))
    return () => { cancelAnimationFrame(frame); observer.disconnect(); control.style.removeProperty('--add-step-menu-space') }
  }, [open])

  return <div ref={controlRef} className={`add-step-control ${open ? 'open' : ''}`}>
    <button className="add-step-divider" type="button" onClick={onToggle} aria-expanded={open}>
      <i /><span><Icon name="plus" size={12} />{t('steps.addStep')}</span><i />
    </button>
    {open && <div ref={menuRef} className="add-step-menu">
      <button disabled={busy} onClick={onUpload}><span><Icon name="image" /></span><div><strong>{t('steps.uploadImages')}</strong><small>{t('steps.uploadImagesHint')}</small></div></button>
      <button disabled={busy || !canDuplicate} onClick={onDuplicate}><span><Icon name="copy" /></span><div><strong>{t('steps.duplicatePrevious')}</strong><small>{t('steps.duplicatePreviousHint')}</small></div></button>
      <button disabled={busy} onClick={onRecord}><span><Icon name="record" /></span><div><strong>{t('steps.continueRecording')}</strong><small>{t('steps.continueRecordingHint')}</small></div></button>
    </div>}
  </div>
}
