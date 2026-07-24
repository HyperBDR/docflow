import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { createCache, createMirror, rebuildIntoSandboxedIframe } from 'rrweb-snapshot'
import { settleSnapshotAnimations } from '../snapshotAnimations'
import type { HotspotData } from '../types'

type LoadMessage =
  | {
      type: 'DOCFLOW_LOAD'
      snapshot: { snapshot: Record<string, unknown> }
      hotspots: HotspotData[]
      mode: 'player' | 'editor'
      hotspotMode?: 'independent' | 'sequence'
      scroll?: { x?: number; y?: number }
    }
  | { type: 'DOCFLOW_FOCUS_HOTSPOT'; hotspotId: string }

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

function repairLegacySnapshot(node: Record<string, any>, parentTag = '') {
  const tag = node.type === 2 ? String(node.tagName || '').toLowerCase() : parentTag
  if (!Array.isArray(node.childNodes)) return
  node.childNodes = node.childNodes.filter((child: Record<string, any>) => !isInjectedNode(child, tag))
  node.childNodes.forEach((child: Record<string, any>) => repairLegacySnapshot(child, tag))
}

function selectorFor(element: HTMLElement, doc: Document): string {
  for (const name of ['data-testid', 'data-test', 'data-cy']) {
    const value = element.getAttribute(name)
    if (value) return `[${name}="${CSS.escape(value)}"]`
  }
  if (element.id) return `#${CSS.escape(element.id)}`
  const parts: string[] = []
  let current: HTMLElement | null = element
  while (current && current !== doc.body && parts.length < 7) {
    const siblings = current.parentElement ? Array.from(current.parentElement.children).filter(item => item.tagName === current!.tagName) : []
    parts.unshift(`${current.tagName.toLowerCase()}${siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : ''}`)
    current = current.parentElement
  }
  return `body > ${parts.join(' > ')}`
}

function rectFor(element: HTMLElement, view: Window) {
  const rect = element.getBoundingClientRect()
  return { x: (rect.left + rect.width / 2) / view.innerWidth, y: (rect.top + rect.height / 2) / view.innerHeight, w: rect.width / view.innerWidth, h: rect.height / view.innerHeight }
}

function normalizedText(value?: string | null) {
  return (value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function elementText(element: HTMLElement) {
  return normalizedText(
    element.getAttribute('aria-label')
    || element.getAttribute('placeholder')
    || element.getAttribute('title')
    || (element instanceof HTMLInputElement ? element.value : '')
    || element.innerText
    || element.textContent,
  )
}

function expectedText(hotspot: HotspotData) {
  if (hotspot.selector?.text) return normalizedText(hotspot.selector.text)
  const content = hotspot.tooltip?.content || ''
  for (const [open, close] of [['「', '」'], ['“', '”'], ['"', '"']]) {
    const start = content.indexOf(open), end = start >= 0 ? content.indexOf(close, start + 1) : -1
    if (start >= 0 && end > start + 1) return normalizedText(content.slice(start + 1, end))
  }
  return normalizedText(content.replace(/^(点击|选择|打开|在)\s*/, '').replace(/(中输入或选择内容|继续|按钮)$/g, ''))
}

function usable(element: HTMLElement) {
  const rect = element.getBoundingClientRect(), style = element.ownerDocument.defaultView?.getComputedStyle(element)
  return rect.width > 1 && rect.height > 1 && style?.display !== 'none' && style?.visibility !== 'hidden'
}

function semanticScore(element: HTMLElement, hotspot: HotspotData, view: Window) {
  if (!usable(element)) return Number.NEGATIVE_INFINITY
  const selector = hotspot.selector || {}, expected = expectedText(hotspot), actual = elementText(element)
  let score = 0
  if (selector.tag) score += element.tagName.toLowerCase() === selector.tag.toLowerCase() ? 24 : -30
  if (selector.role) score += element.getAttribute('role') === selector.role ? 18 : -8
  if (selector.aria_label) score += normalizedText(element.getAttribute('aria-label')) === normalizedText(selector.aria_label) ? 35 : -15
  if (expected) {
    if (actual === expected) score += 120
    else if (actual && (actual.startsWith(expected) || expected.startsWith(actual))) score += 75
    else if (actual && actual.includes(expected)) score += 55
    else return Number.NEGATIVE_INFINITY
    const sameTextChild = Array.from(element.children).some(child => elementText(child as HTMLElement) === expected && usable(child as HTMLElement))
    if (sameTextChild) score -= 90
  }
  const rect = rectFor(element, view), fallback = hotspot.fallback_rect
  if (element.matches('button,a,input,select,textarea,label,[role="button"],[role="link"],[tabindex]')) score += 55
  score -= Math.hypot(rect.x - fallback.x, rect.y - fallback.y) * 12
  // Prefer the smallest matching element instead of a large ancestor whose
  // innerText happens to include the target label.
  score -= Math.min(45, rect.w * rect.h * 500)
  return score
}

function findTarget(hotspot: HotspotData, doc: Document, view: Window) {
  const css = hotspot.selector?.css
  if (css) {
    try {
      const exact = doc.querySelector<HTMLElement>(css)
      if (exact && semanticScore(exact, hotspot, view) > 0) return exact
    } catch { /* continue with semantic resolution */ }
  }
  const expected = expectedText(hotspot)
  if (!expected && !hotspot.selector?.aria_label && !hotspot.selector?.role) return null
  const query = hotspot.selector?.tag || 'button,a,input,select,textarea,label,[role],span,div'
  let candidates: HTMLElement[] = []
  try { candidates = Array.from(doc.querySelectorAll<HTMLElement>(query)) } catch { candidates = Array.from(doc.querySelectorAll<HTMLElement>('*')) }
  let best: HTMLElement | null = null, bestScore = Number.NEGATIVE_INFINITY
  for (const candidate of candidates) {
    const score = semanticScore(candidate, hotspot, view)
    if (score > bestScore) { best = candidate; bestScore = score }
  }
  return bestScore > 20 ? best : null
}

export default function SnapshotFrame() {
  const { t } = useTranslation('player')
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let hotspots: HotspotData[] = []
    let mode: 'player' | 'editor' = 'player'
    let hotspotMode: 'independent' | 'sequence' = 'independent'
    let activeHotspotId = ''
    let frame: HTMLIFrameElement | null = null
    let cleanupFrame = () => {}
    let disposed = false
    let loadVersion = 0
    let rectsEnabled = false
    let scheduleRectRefresh = () => {}

    const connectedRoot = async () => {
      // React StrictMode mounts, cleans up and mounts effects once more in
      // development. Messages already queued by the first effect can otherwise
      // retain a detached element. Always read the live ref and wait until it
      // belongs to the active document before asking rrweb to create its iframe.
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const root = rootRef.current
        if (root?.isConnected && root.ownerDocument === document) return root
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      }
      throw new Error(t('guide.rebuildFailed'))
    }

    const sendRects = () => {
      if (!rectsEnabled) return
      const doc = frame?.contentDocument, view = frame?.contentWindow
      if (!doc || !view) return
      const rects: Record<string, ReturnType<typeof rectFor>> = {}
      const resolved: Record<string, { tag: string; text: string; expected: string }> = {}
      for (const hotspot of hotspots) {
        const element = findTarget(hotspot, doc, view)
        if (element) {
          rects[hotspot.id] = rectFor(element, view)
          resolved[hotspot.id] = { tag: element.tagName.toLowerCase(), text: elementText(element).slice(0, 160), expected: expectedText(hotspot) }
        }
      }
      parent.postMessage({ type: 'DOCFLOW_RECTS', rects, resolved }, '*')
    }

    const attachFrameAgent = () => {
      const doc = frame?.contentDocument, view = frame?.contentWindow
      if (!doc || !view) return
      const style = doc.createElement('style')
      style.textContent = `html,body{margin:0!important;min-height:100%;scroll-behavior:auto!important}*{transition:none!important}.docflow-editor-hover{outline:3px solid #635bff!important;outline-offset:2px!important;cursor:crosshair!important}`
      doc.head.appendChild(style)
      // rrweb restarts CSS animations when rebuilding a snapshot. Finishing
      // finite animations keeps cards and dialogs at their visible end state;
      // cancelling infinite animations prevents cursors and spinners moving.
      const settlePage = () => settleSnapshotAnimations(doc)
      settlePage()
      doc.querySelectorAll('form').forEach(form => form.addEventListener('submit', event => event.preventDefault()))
      doc.querySelectorAll('a').forEach(anchor => anchor.addEventListener('click', event => event.preventDefault()))
      const onClick = (event: MouseEvent) => {
        const target = event.target as HTMLElement | null
        if (!target) return
        if (mode === 'editor') {
          event.preventDefault(); event.stopPropagation()
          parent.postMessage({ type: 'DOCFLOW_TARGET', selector: {
            css: selectorFor(target, doc), tag: target.tagName.toLowerCase(), role: target.getAttribute('role') || undefined,
            aria_label: target.getAttribute('aria-label') || undefined,
            text: (target.innerText || target.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 160),
          }, rect: rectFor(target, view) }, '*')
          return
        }
        for (const hotspot of hotspots) {
          if (hotspotMode === 'sequence' && hotspot.id !== activeHotspotId) continue
          if (hotspot.trigger !== 'click' || !hotspot.selector?.css) continue
          try {
            if (target.matches(hotspot.selector.css) || target.closest(hotspot.selector.css)) {
              event.preventDefault(); event.stopPropagation(); parent.postMessage({ type: 'DOCFLOW_HOTSPOT', hotspotId: hotspot.id }, '*'); return
            }
          } catch { /* fallback overlay handles it */ }
        }
        if (target.closest('a,button,input[type="submit"]')) event.preventDefault()
      }
      const onOver = (event: PointerEvent) => {
        const target = event.target as HTMLElement | null
        if (!target) return
        if (mode === 'editor') target.classList.add('docflow-editor-hover')
        for (const hotspot of hotspots) {
          if (hotspotMode === 'sequence' && hotspot.id !== activeHotspotId) continue
          if (hotspot.trigger !== 'hover' || !hotspot.selector?.css) continue
          try { if (target.matches(hotspot.selector.css) || target.closest(hotspot.selector.css)) parent.postMessage({ type: 'DOCFLOW_HOTSPOT', hotspotId: hotspot.id }, '*') } catch { /* noop */ }
        }
      }
      const onOut = (event: PointerEvent) => (event.target as HTMLElement | null)?.classList.remove('docflow-editor-hover')
      doc.addEventListener('click', onClick, true); doc.addEventListener('pointerover', onOver, true); doc.addEventListener('pointerout', onOut, true)
      let rectFrame = 0
      const scheduleRects = () => { cancelAnimationFrame(rectFrame); rectFrame = requestAnimationFrame(sendRects) }
      scheduleRectRefresh = scheduleRects
      const resizeObserver = new ResizeObserver(scheduleRects)
      resizeObserver.observe(doc.documentElement)
      if (doc.body) resizeObserver.observe(doc.body)
      const mutationObserver = new MutationObserver(scheduleRects)
      mutationObserver.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, characterData: true })
      doc.querySelectorAll('img').forEach(image => image.addEventListener('load', scheduleRects))
      doc.fonts?.ready.then(scheduleRects).catch(() => {})
      const settleTimers = [80, 300, 900].map(delay => window.setTimeout(() => { settlePage(); scheduleRects() }, delay))
      view.addEventListener('resize', scheduleRects); doc.addEventListener('scroll', scheduleRects, true)
      cleanupFrame = () => {
        doc.removeEventListener('click', onClick, true); doc.removeEventListener('pointerover', onOver, true); doc.removeEventListener('pointerout', onOut, true)
        cancelAnimationFrame(rectFrame); settleTimers.forEach(clearTimeout); resizeObserver.disconnect(); mutationObserver.disconnect()
        view.removeEventListener('resize', scheduleRects); doc.removeEventListener('scroll', scheduleRects, true)
        scheduleRectRefresh = () => {}
      }
    }

    const onMessage = async (event: MessageEvent<LoadMessage>) => {
      if (event.source !== parent) return
      const message = event.data
      if (!message) return
      if (message.type === 'DOCFLOW_FOCUS_HOTSPOT') {
        activeHotspotId = message.hotspotId
        const doc = frame?.contentDocument, view = frame?.contentWindow
        const hotspot = hotspots.find(item => item.id === message.hotspotId)
        if (!doc || !view || !hotspot) return
        const element = findTarget(hotspot, doc, view)
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
          window.setTimeout(scheduleRectRefresh, 80)
          window.setTimeout(scheduleRectRefresh, 320)
        }
        return
      }
      if (message.type !== 'DOCFLOW_LOAD') return
      const currentLoad = ++loadVersion
      hotspots = message.hotspots || []; mode = message.mode
      hotspotMode = message.hotspotMode || 'independent'
      activeHotspotId = hotspotMode === 'sequence'
        ? [...hotspots].sort((a, b) => a.position - b.position)[0]?.id || ''
        : ''
      try {
        rectsEnabled = false
        repairLegacySnapshot(message.snapshot.snapshot as Record<string, any>)
        const root = await connectedRoot()
        if (disposed || currentLoad !== loadVersion) return
        cleanupFrame(); root.replaceChildren()
        const rebuilt = rebuildIntoSandboxedIframe(message.snapshot.snapshot as any, {
          root, cache: createCache(), mirror: createMirror(), hackCss: true,
          iframeAttributes: { style: 'display:block;width:100%;height:100%;border:0;background:white' },
        })
        frame = rebuilt.iframe
        attachFrameAgent()
        frame.contentWindow?.scrollTo(message.scroll?.x || 0, message.scroll?.y || 0)
        requestAnimationFrame(() => {
          // The fallback hotspot rect is immediately usable. Do not keep the
          // whole slide blocked while semantic target resolution scans the DOM.
          parent.postMessage({ type: 'DOCFLOW_LOADED' }, '*')
          window.setTimeout(() => { rectsEnabled = true; scheduleRectRefresh() }, 50)
        })
      } catch (error) {
        if (!disposed && currentLoad === loadVersion) parent.postMessage({ type: 'DOCFLOW_ERROR', error: String(error) }, '*')
      }
    }
    window.addEventListener('message', onMessage)
    parent.postMessage({ type: 'DOCFLOW_READY' }, '*')
    return () => { disposed = true; loadVersion += 1; cleanupFrame(); window.removeEventListener('message', onMessage) }
  }, [])
  return <div ref={rootRef} id="snapshot-frame-root" className="snapshot-frame-root"><div className="snapshot-loading">{t('guide.loadingPage')}</div></div>
}
