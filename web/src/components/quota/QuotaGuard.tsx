import type { ReactNode } from 'react'
import '../../styles/quota-controls.css'

export default function QuotaGuard({ message, children, fill = false }: { message?: string; children: ReactNode; fill?: boolean }) {
  return <span className={`quota-guard-control${message ? ' blocked' : ''}${fill ? ' fill' : ''}`} tabIndex={message ? 0 : -1} aria-label={message || undefined}>
    {children}
    {message && <span className="quota-guard-tooltip" role="tooltip">{message}</span>}
  </span>
}
