import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import '../../styles/quota-controls.css'

type TooltipPosition = {
  left: number
  top: number
  maxWidth: number
  placement: 'above' | 'below'
}

export default function QuotaGuard({ message, children, fill = false }: { message?: string; children: ReactNode; fill?: boolean }) {
  const controlRef = useRef<HTMLSpanElement>(null)
  const tooltipId = useId()
  const [tooltipVisible, setTooltipVisible] = useState(false)
  const [tooltipPosition, setTooltipPosition] = useState<TooltipPosition | null>(null)

  const updateTooltipPosition = useCallback(() => {
    const control = controlRef.current
    if (!control) return
    const rect = control.getBoundingClientRect()
    const maxWidth = Math.min(320, window.innerWidth - 24)
    const halfWidth = maxWidth / 2
    const left = Math.min(window.innerWidth - halfWidth - 12, Math.max(halfWidth + 12, rect.left + rect.width / 2))
    const placement = rect.top >= 120 ? 'above' : 'below'
    setTooltipPosition({
      left,
      top: placement === 'above' ? rect.top - 9 : rect.bottom + 9,
      maxWidth,
      placement,
    })
  }, [])

  const showTooltip = () => {
    if (!message) return
    updateTooltipPosition()
    setTooltipVisible(true)
  }

  useEffect(() => {
    if (!tooltipVisible) return
    const update = () => updateTooltipPosition()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [tooltipVisible, updateTooltipPosition])

  return <span ref={controlRef} className={`quota-guard-control${message ? ' blocked' : ''}${fill ? ' fill' : ''}`} tabIndex={message ? 0 : -1} aria-label={message || undefined} aria-describedby={message ? tooltipId : undefined} onMouseEnter={showTooltip} onMouseLeave={() => setTooltipVisible(false)} onFocusCapture={showTooltip} onBlurCapture={() => setTooltipVisible(false)}>
    {children}
    {message && tooltipVisible && tooltipPosition && typeof document !== 'undefined' && createPortal(<span id={tooltipId} className={`quota-guard-tooltip ${tooltipPosition.placement}`} role="tooltip" style={{ left: tooltipPosition.left, top: tooltipPosition.top, maxWidth: tooltipPosition.maxWidth }}>{message}</span>, document.body)}
  </span>
}
