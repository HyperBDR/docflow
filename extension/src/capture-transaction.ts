const blockedEvents = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'touchstart', 'touchend'] as const

export type CaptureGuard = {
  lock: () => void
  unlock: () => void
  active: () => boolean
  dispose: () => void
}

/**
 * Blocks every page interaction while pixels and DOM are being copied. The
 * listeners live outside the recorder shadow root, so the page stays frozen
 * even while recorder UI nodes are detached for a clean screenshot.
 */
export function installCaptureGuard(): CaptureGuard {
  let locked = false
  const suppress = (event: Event) => {
    if (!locked || !event.isTrusted) return
    if (event.cancelable) event.preventDefault()
    event.stopImmediatePropagation()
  }
  blockedEvents.forEach(type => window.addEventListener(type, suppress, { capture: true, passive: false }))
  window.addEventListener('submit', suppress, { capture: true })
  window.addEventListener('keydown', suppress, { capture: true })
  return {
    lock: () => { locked = true },
    unlock: () => { locked = false },
    active: () => locked,
    dispose: () => {
      locked = false
      blockedEvents.forEach(type => window.removeEventListener(type, suppress, true))
      window.removeEventListener('submit', suppress, true)
      window.removeEventListener('keydown', suppress, true)
    },
  }
}

export function replayCapturedAction(target: HTMLElement) {
  if (!target.isConnected) return
  target.focus({ preventScroll: true })
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return
  if (target instanceof HTMLInputElement && !['button', 'submit', 'image', 'reset', 'checkbox', 'radio'].includes(target.type)) return
  target.click()
}
