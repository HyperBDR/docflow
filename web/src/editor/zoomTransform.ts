import type { Rect } from '../types'

export type ZoomTransform = {
  scale: number
  x: number
  y: number
  css: string
}

const clampOffset = (value: number, scale: number) => Math.max(1 - scale, Math.min(0, value))

export function calculateZoomTransform(rect: Rect | undefined, progress: number): ZoomTransform {
  const normalizedProgress = Math.max(0, Math.min(1, progress))
  if (!rect || normalizedProgress <= 0) return { scale: 1, x: 0, y: 0, css: 'translate(0, 0) scale(1)' }

  const targetScale = Math.max(1, Math.min(4, Math.min(1 / rect.w, 1 / rect.h) * .94))
  const targetX = clampOffset(.5 - rect.x * targetScale, targetScale)
  const targetY = clampOffset(.5 - rect.y * targetScale, targetScale)
  const scale = 1 + (targetScale - 1) * normalizedProgress
  const x = targetX * normalizedProgress
  const y = targetY * normalizedProgress

  return { scale, x, y, css: `translate(${x * 100}%, ${y * 100}%) scale(${scale})` }
}

export function transformRect(rect: Rect, transform: Pick<ZoomTransform, 'scale' | 'x' | 'y'>): Rect {
  return {
    x: rect.x * transform.scale + transform.x,
    y: rect.y * transform.scale + transform.y,
    w: rect.w * transform.scale,
    h: rect.h * transform.scale,
  }
}
