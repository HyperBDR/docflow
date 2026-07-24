import type { AnnotationRect } from '../types'

export type AnnotationResizeEdge = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value))

export function moveAnnotation(rect: AnnotationRect, dx: number, dy: number): AnnotationRect {
  return {
    ...rect,
    x: clamp(rect.x + dx, 0, 1 - rect.w),
    y: clamp(rect.y + dy, 0, 1 - rect.h),
  }
}

export function resizeAnnotation(rect: AnnotationRect, edge: AnnotationResizeEdge, dx: number, dy: number, minimum = .006): AnnotationRect {
  let left = rect.x, right = rect.x + rect.w, top = rect.y, bottom = rect.y + rect.h
  if (edge.includes('w')) left = clamp(left + dx, 0, right - minimum)
  if (edge.includes('e')) right = clamp(right + dx, left + minimum, 1)
  if (edge.includes('n')) top = clamp(top + dy, 0, bottom - minimum)
  if (edge.includes('s')) bottom = clamp(bottom + dy, top + minimum, 1)
  return { ...rect, x: left, y: top, w: right - left, h: bottom - top }
}
