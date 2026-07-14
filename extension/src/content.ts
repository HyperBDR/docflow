import type { Rect } from './types'

let active = false

function normalized(rect: DOMRect): Rect {
  return {
    x: Math.max(0, Math.min(1, (rect.left + rect.width / 2) / window.innerWidth)),
    y: Math.max(0, Math.min(1, (rect.top + rect.height / 2) / window.innerHeight)),
    w: Math.max(.01, Math.min(1, rect.width / window.innerWidth)),
    h: Math.max(.01, Math.min(1, rect.height / window.innerHeight)),
  }
}

function label(element: HTMLElement): string {
  const aria = element.getAttribute('aria-label') || element.getAttribute('title') || element.getAttribute('placeholder')
  if (aria) return aria.trim().slice(0, 80)
  if (element instanceof HTMLInputElement && element.labels?.length) return element.labels[0].innerText.trim().slice(0, 80)
  const text = (element.innerText || element.textContent || '').trim().replace(/\s+/g, ' ')
  return text.slice(0, 80) || element.tagName.toLowerCase()
}

function onPointer(event: PointerEvent) {
  if (!active || event.button !== 0 || window.top !== window) return
  const target = (event.target as HTMLElement)?.closest<HTMLElement>('button,a,input,select,textarea,[role="button"],[onclick]') || event.target as HTMLElement
  if (!target || !target.getBoundingClientRect) return
  const name = label(target)
  const isPassword = target instanceof HTMLInputElement && target.type === 'password'
  const verb = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? '在' : '点击'
  const body = verb === '在' ? `在「${name}」中输入内容` : `点击「${name}」`
  const data: Record<string, unknown> = {
    event_id: crypto.randomUUID(), title: body, body,
    viewport_width: window.innerWidth, viewport_height: window.innerHeight,
    hotspot: normalized(target.getBoundingClientRect()), duration: 3,
  }
  if (isPassword) data.password_rect = normalized(target.getBoundingClientRect())
  chrome.runtime.sendMessage({ type: 'STEP_EVENT', data })
}

chrome.runtime.onMessage.addListener(message => { if (message.type === 'RECORDING_STATE') active = message.active })
chrome.runtime.sendMessage({ type: 'IS_RECORDING' }).then(state => { active = Boolean(state?.active) }).catch(() => {})
document.addEventListener('pointerdown', onPointer, true)
