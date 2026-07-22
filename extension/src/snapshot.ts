import { snapshot as rrwebSnapshot } from 'rrweb-snapshot'
import type { CapturedSnapshot, Rect } from './types'

export type TargetInfo = {
  css?: string
  node_id?: number
  tag?: string
  role?: string
  aria_label?: string
  text?: string
}

const sensitiveControlSelector = [
  'input[type="password"]', 'input[type="email"]', 'input[autocomplete="one-time-code"]',
  'input[autocomplete="current-password"]', 'input[autocomplete="username"]',
  'input[name*="token" i]', 'input[name*="secret" i]', 'input[name*="api_key" i]', '[data-docflow-redact]',
].join(',')

export function sensitiveFormDetected() {
  return Boolean(document.querySelector(sensitiveControlSelector))
}

/** Keep form geometry intact in pixel captures while removing entered secrets. */
export function concealSensitiveFormValues() {
  if (!sensitiveFormDetected()) return () => {}
  const controls = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input:not([type="button"]):not([type="submit"]):not([type="reset"]),textarea'))
  const values = controls.map(control => ({ control, value: control.value, placeholder: control.placeholder, caretColor: control.style.caretColor }))
  controls.forEach(control => {
    control.value = ''
    control.placeholder = ''
    control.style.caretColor = 'transparent'
  })
  return () => values.forEach(({ control, value, placeholder, caretColor }) => {
    control.value = value
    control.placeholder = placeholder
    control.style.caretColor = caretColor
  })
}

function escapeAttribute(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function selectorFor(element: HTMLElement): string {
  for (const attribute of ['data-testid', 'data-test', 'data-cy']) {
    const value = element.getAttribute(attribute)
    if (value) return `[${attribute}="${escapeAttribute(value)}"]`
  }
  if (element.id) return `#${CSS.escape(element.id)}`
  const aria = element.getAttribute('aria-label')
  if (aria) return `${element.tagName.toLowerCase()}[aria-label="${escapeAttribute(aria)}"]`
  const name = element.getAttribute('name')
  if (name) return `${element.tagName.toLowerCase()}[name="${escapeAttribute(name)}"]`
  const parts: string[] = []
  let current: HTMLElement | null = element
  while (current && current !== document.body && parts.length < 7) {
    const tag = current.tagName.toLowerCase()
    const siblings = current.parentElement ? Array.from(current.parentElement.children).filter(item => item.tagName === current!.tagName) : []
    const suffix = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : ''
    parts.unshift(`${tag}${suffix}`)
    current = current.parentElement
  }
  return `body > ${parts.join(' > ')}`
}

export function elementLabel(element: HTMLElement): string {
  const aria = element.getAttribute('aria-label') || element.getAttribute('title') || element.getAttribute('placeholder')
  if (aria) return aria.trim().slice(0, 160)
  if (element instanceof HTMLInputElement && element.labels?.length) return element.labels[0].innerText.trim().slice(0, 160)
  return (element.innerText || element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 160) || element.tagName.toLowerCase()
}

export function normalized(rect: DOMRect): Rect {
  return {
    x: Math.max(0, Math.min(1, (rect.left + rect.width / 2) / window.innerWidth)),
    y: Math.max(0, Math.min(1, (rect.top + rect.height / 2) / window.innerHeight)),
    w: Math.max(.01, Math.min(1, rect.width / window.innerWidth)),
    h: Math.max(.01, Math.min(1, rect.height / window.innerHeight)),
  }
}

export function targetInfo(element: HTMLElement): TargetInfo {
  return {
    css: selectorFor(element),
    tag: element.tagName.toLowerCase(),
    role: element.getAttribute('role') || undefined,
    aria_label: element.getAttribute('aria-label') || undefined,
    text: elementLabel(element),
  }
}

export function pageContext(element?: HTMLElement) {
  const nearby = element?.parentElement?.innerText || element?.innerText || ''
  return {
    page_title: document.title,
    url: location.href,
    target_text: element ? elementLabel(element) : '',
    target_role: element?.getAttribute('role') || '',
    target_aria: element?.getAttribute('aria-label') || '',
    nearby_text: nearby.trim().replace(/\s+/g, ' ').slice(0, 1500),
    visible_text: (document.body?.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 6000),
    raster_regions: rasterFallbackRegions(),
    sensitive_form: sensitiveFormDetected(),
  }
}

function rasterFallbackRegions() {
  return Array.from(document.querySelectorAll<HTMLElement>('iframe,frame,video,canvas')).flatMap(element => {
    const rect = element.getBoundingClientRect()
    const left = Math.max(0, rect.left), top = Math.max(0, rect.top)
    const right = Math.min(innerWidth, rect.right), bottom = Math.min(innerHeight, rect.bottom)
    if (right - left < 2 || bottom - top < 2) return []
    const style = getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return []
    const tag = element.tagName.toLowerCase()
    return [{
      x: left / innerWidth, y: top / innerHeight,
      w: (right - left) / innerWidth, h: (bottom - top) / innerHeight,
      kind: tag === 'frame' ? 'iframe' : tag,
    }]
  }).slice(0, 40)
}

export function passwordRects(): Rect[] {
  return Array.from(document.querySelectorAll<HTMLElement>(sensitiveControlSelector))
    .filter(input => {
      const rect = input.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.right >= 0 && rect.top <= innerHeight && rect.left <= innerWidth
    })
    .map(input => normalized(input.getBoundingClientRect()))
}

export function captureWarnings(): string[] {
  const warnings: string[] = []
  if (document.querySelector('canvas')) warnings.push('Canvas content may use a raster fallback')
  if (document.querySelector('video')) warnings.push('Video playback is not included; a raster fallback is used')
  return warnings
}

function isInjectedNode(node: Record<string, any>, parentTag = '') {
  if (node.type !== 2) return false
  const tag = String(node.tagName || '').toLowerCase()
  const attributes = node.attributes || {}
  const id = String(attributes.id || '').toLowerCase()
  const classes = new Set(String(attributes.class || '').split(/\s+/))
  return (
    (parentTag === 'html' && tag !== 'head' && tag !== 'body')
    || (tag === 'body' && parentTag !== 'html')
    || tag === 'chatgpt-sidebar'
    || tag === 'doubao-ai-csui'
    || tag.startsWith('sider-')
    || id.startsWith('aix-')
    || id.startsWith('doubao-ai-')
    || id.startsWith('cici-')
    || id.startsWith('sider-')
    || id === 'host-style-container'
    || id === 'cici-inline-container'
    || classes.has('mamba-table-floating-scroll')
    || classes.has('docflow-recorder-ui')
  )
}

function pruneInjectedNodes(node: Record<string, any>, parentTag = '') {
  const tag = node.type === 2 ? String(node.tagName || '').toLowerCase() : parentTag
  if (!Array.isArray(node.childNodes)) return
  node.childNodes = node.childNodes.filter((child: Record<string, any>) => !isInjectedNode(child, tag))
  node.childNodes.forEach((child: Record<string, any>) => pruneInjectedNodes(child, tag))
}

export function captureDom(): CapturedSnapshot | null {
  // rrweb's blockClass intentionally creates a same-sized placeholder. Since
  // the recorder HUD is attached to <html>, that placeholder can be rebuilt
  // before <body> and push the captured application below the viewport. Remove
  // the HUD briefly instead, preserving its shadow root when it is reattached.
  const recorderNodes = Array.from(document.querySelectorAll<HTMLElement>('.docflow-recorder-ui')).map(node => ({
    node, parent: node.parentNode, next: node.nextSibling,
  }))
  recorderNodes.forEach(item => item.node.remove())
  let result
  try {
    result = rrwebSnapshot(document, {
      inlineStylesheet: true,
      inlineImages: true,
      recordCanvas: true,
      maskAllInputs: true,
      slimDOM: false,
    })
  } finally {
    recorderNodes.forEach(({ node, parent, next }) => parent?.insertBefore(node, next))
  }
  if (!result) return null
  pruneInjectedNodes(result as unknown as Record<string, any>)
  return {
    version: 1,
    snapshot: result as unknown as Record<string, unknown>,
    captured_at: new Date().toISOString(),
    viewport: { width: innerWidth, height: innerHeight },
  }
}
