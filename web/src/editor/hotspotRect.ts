import type { Rect } from '../types'

export function resolveHotspotRect(
  mode: 'player' | 'editor',
  useDom: boolean,
  fallback: Rect,
  dynamic?: Rect,
) {
  // Preview/player hotspots stay bound to the reconstructed DOM element, so
  // scrolling either the document or an inner scroll container moves them.
  // Editor mode intentionally keeps the persisted fallback rectangle stable
  // while the user drags or resizes it.
  return mode === 'player' && useDom && dynamic ? dynamic : fallback
}
