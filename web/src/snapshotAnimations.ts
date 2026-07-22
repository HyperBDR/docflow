export type SnapshotAnimationResult = {
  finished: number
  cancelled: number
}

/**
 * Settle replayed CSS animations without freezing entrance animations on
 * their invisible first frame. Finite animations retain their final fill
 * state; infinite or invalid animations fall back to the element's base CSS.
 */
export function settleSnapshotAnimations(
  document: Pick<Document, 'getAnimations'>,
): SnapshotAnimationResult {
  const result: SnapshotAnimationResult = { finished: 0, cancelled: 0 }

  for (const animation of document.getAnimations()) {
    const endTime = Number(animation.effect?.getComputedTiming().endTime)
    if (!Number.isFinite(endTime)) {
      animation.cancel()
      result.cancelled += 1
      continue
    }

    try {
      animation.finish()
      result.finished += 1
    } catch {
      // finish() can reject zero-playback-rate and browser-specific animation
      // implementations. Cancelling is safer than leaving the page at frame 0.
      animation.cancel()
      result.cancelled += 1
    }
  }

  return result
}
