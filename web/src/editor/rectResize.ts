import type { Rect } from '../types'

export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'se'

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value))

/** Resize a center-based rectangle while keeping every non-dragged edge fixed. */
export function resizeCenteredRect(rect: Rect, edge: ResizeEdge, dx: number, dy: number, minimum = .015): Rect {
  const left = rect.x - rect.w / 2
  const right = rect.x + rect.w / 2
  const top = rect.y - rect.h / 2
  const bottom = rect.y + rect.h / 2
  let nextLeft = left, nextRight = right, nextTop = top, nextBottom = bottom

  if (edge === 'w') nextLeft = clamp(left + dx, 0, right - minimum)
  if (edge === 'e' || edge === 'se') nextRight = clamp(right + dx, left + minimum, 1)
  if (edge === 'n') nextTop = clamp(top + dy, 0, bottom - minimum)
  if (edge === 's' || edge === 'se') nextBottom = clamp(bottom + dy, top + minimum, 1)

  return {
    x: (nextLeft + nextRight) / 2,
    y: (nextTop + nextBottom) / 2,
    w: nextRight - nextLeft,
    h: nextBottom - nextTop,
  }
}
