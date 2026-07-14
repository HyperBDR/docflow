import { captureDom, captureWarnings, normalized, pageContext, passwordRects, targetInfo } from './snapshot'
import type { CapturedSnapshot, RecordingMode } from './types'

type RecorderState = { active?: boolean; paused?: boolean; capturing?: boolean; phase?: '' | 'uploading'; steps?: number; mode?: RecordingMode }

let active = false
let paused = false
let capturing = false
let phase: '' | 'uploading' = ''
let steps = 0
let mode: RecordingMode = 'html'
let currentSnapshot: CapturedSnapshot | null = null
let refreshTimer: number | undefined
let hudHost: HTMLDivElement | null = null
let highlight: HTMLDivElement | null = null
let statusText: HTMLDivElement | null = null
let countText: HTMLDivElement | null = null
let modeText: HTMLDivElement | null = null
let lastError = ''
let awaitingOriginalClick = false
let lockTimer: number | undefined

function selectableTarget(raw: HTMLElement | null): HTMLElement | null {
  if (!raw || raw.closest('.docflow-recorder-ui')) return null
  const semantic = raw.closest<HTMLElement>('button,a,input,select,textarea,label,[role="button"],[role="link"],[onclick],[tabindex]')
  const target = semantic || raw
  return target === document.documentElement || target === document.body ? null : target
}

function ensureHud() {
  if (hudHost?.isConnected || !active) return
  const parent = document.documentElement || document.body
  if (!parent) { window.setTimeout(ensureHud, 50); return }
  hudHost = document.createElement('div')
  hudHost.className = 'docflow-recorder-ui'
  const shadow = hudHost.attachShadow({ mode: 'closed' })
  shadow.innerHTML = `<style>
    :host{all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;font-family:Inter,system-ui,-apple-system,"PingFang SC",sans-serif}
    .hud{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);display:flex;align-items:center;gap:12px;padding:10px 14px;background:#111827;color:#fff;border-radius:12px;box-shadow:0 12px 35px #0005;font-size:13px;line-height:1.2}
    .dot{width:9px;height:9px;border-radius:50%;background:#ef4444;box-shadow:0 0 0 4px #ef444433}.paused .dot{background:#f59e0b;box-shadow:none}.capturing .dot{background:#8b5cf6;animation:pulse .8s infinite alternate}
    .copy{display:grid;gap:3px;white-space:nowrap}.status{font-weight:700}.meta{color:#cbd5e1;font-size:11px}.count{padding:6px 9px;background:#ffffff14;border-radius:8px;font-weight:700;white-space:nowrap}
    .lock{position:fixed;inset:0;display:none;background:#0f172a14;cursor:progress}.capturing~.lock{display:block}.outline{position:fixed;border:3px solid #7c3aed;border-radius:7px;background:#7c3aed18;box-shadow:0 0 0 2px #fff8;transition:all 60ms linear;display:none}
    @keyframes pulse{to{transform:scale(1.35);opacity:.65}}
  </style><div class="outline"></div><div class="hud"><span class="dot"></span><div class="copy"><div class="status"></div><div class="meta"></div></div><div class="count"></div></div><div class="lock"></div>`
  highlight = shadow.querySelector('.outline')
  statusText = shadow.querySelector('.status')
  modeText = shadow.querySelector('.meta')
  countText = shadow.querySelector('.count')
  parent.appendChild(hudHost)
  renderHud()
}

function clearHighlight() {
  if (highlight) highlight.style.display = 'none'
}

function renderHud() {
  if (!active) { hudHost?.remove(); hudHost = highlight = statusText = countText = modeText = null; return }
  ensureHud()
  const hud = statusText?.closest('.hud')
  hud?.classList.toggle('paused', paused)
  hud?.classList.toggle('capturing', capturing)
  if (hudHost) hudHost.style.pointerEvents = capturing && !awaitingOriginalClick ? 'auto' : 'none'
  if (statusText) statusText.textContent = lastError || (capturing ? 'Capturing, please wait…' : paused ? 'Recording paused' : 'Select an element to capture')
  if (modeText) modeText.textContent = capturing
    ? 'Uploading HTML, CSS and screenshot…'
    : mode === 'html' ? 'HTML Cloning · hover and click an element' : 'Screenshot mode · click an element'
  if (countText) countText.textContent = `${steps} ${steps === 1 ? 'Step' : 'Steps'} Recorded`
  if (paused || capturing || mode !== 'html') clearHighlight()
}

function applyState(state: RecorderState) {
  active = Boolean(state.active)
  paused = Boolean(state.paused)
  capturing = Boolean(state.capturing)
  phase = state.phase || ''
  steps = Number(state.steps || 0)
  mode = state.mode || 'html'
  if (!capturing) lastError = ''
  if (capturing && !awaitingOriginalClick) clearInteractionDelay()
  renderHud()
  if (active && !paused && mode === 'html') window.setTimeout(refreshSnapshot, document.readyState === 'complete' ? 0 : 500)
  else currentSnapshot = null
}

function lockInteraction() {
  awaitingOriginalClick = false
  window.clearTimeout(lockTimer)
  renderHud()
}

function clearInteractionDelay() {
  if (!capturing) return
  window.clearTimeout(lockTimer)
  lockTimer = window.setTimeout(lockInteraction, 0)
}

function refreshSnapshot() {
  if (!active || paused || mode !== 'html' || window.top !== window) return
  try { currentSnapshot = captureDom() } catch { currentSnapshot = null }
}

function scheduleRefresh() {
  window.clearTimeout(refreshTimer)
  refreshTimer = window.setTimeout(refreshSnapshot, 600)
}

function onPointerMove(event: PointerEvent) {
  if (!active || paused || capturing || mode !== 'html' || window.top !== window || !highlight) return
  const target = selectableTarget(event.target as HTMLElement | null)
  if (!target) { clearHighlight(); return }
  const rect = target.getBoundingClientRect()
  if (rect.width < 2 || rect.height < 2) { clearHighlight(); return }
  Object.assign(highlight.style, {
    display: 'block', left: `${Math.max(0, rect.left)}px`, top: `${Math.max(0, rect.top)}px`,
    width: `${Math.min(innerWidth, rect.right) - Math.max(0, rect.left)}px`,
    height: `${Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top)}px`,
  })
}

async function onPointer(event: PointerEvent) {
  if (!active || paused || capturing || event.button !== 0 || window.top !== window) return
  const target = selectableTarget(event.target as HTMLElement | null)
  if (!target?.getBoundingClientRect) return

  // Capture synchronously during pointerdown, before the page's click handler
  // changes the DOM or navigates away.
  const snapshot = mode === 'html' ? (captureDom() || currentSnapshot) : undefined
  const info = targetInfo(target)
  const isInput = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
  const label = info.text || info.aria_label || info.tag || '目标元素'
  const body = isInput ? `在「${label}」中输入或选择内容` : `点击「${label}」`
  const data = {
    event_id: crypto.randomUUID(), title: body, body,
    viewport_width: innerWidth, viewport_height: innerHeight,
    hotspot: normalized(target.getBoundingClientRect()), target: info,
    page_context: pageContext(target), scroll_state: { x: scrollX, y: scrollY },
    password_rects: passwordRects(), capture_warnings: captureWarnings(), duration: 3, terminal: false,
  }
  // Let the selected element finish its real click once, then place a full-page
  // interaction shield until upload and per-step AI processing are complete.
  awaitingOriginalClick = true
  window.addEventListener('click', () => queueMicrotask(lockInteraction), { once: true })
  lockTimer = window.setTimeout(lockInteraction, 700)
  capturing = true; phase = 'uploading'; clearHighlight(); renderHud()
  try {
    const result = await chrome.runtime.sendMessage({ type: 'STEP_EVENT', data, snapshot })
    if (result?.error) throw new Error(result.error)
    if (typeof result?.steps === 'number') steps = result.steps
  } catch (error) {
    lastError = `Capture failed: ${(error as Error).message}`
  } finally {
    capturing = false; phase = ''; awaitingOriginalClick = false; window.clearTimeout(lockTimer); renderHud(); scheduleRefresh()
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'RECORDING_STATE') applyState(message)
  if (message.type === 'RECORDER_UI_VISIBILITY') {
    if (hudHost) hudHost.style.display = message.hidden ? 'none' : ''
    requestAnimationFrame(() => sendResponse({ ok: true }))
    return true
  }
  if (message.type === 'CAPTURE_FINAL') {
    if (mode === 'html') refreshSnapshot()
    sendResponse({
      snapshot: mode === 'html' ? currentSnapshot : undefined,
      data: {
        event_id: crypto.randomUUID(), title: '流程完成', body: '已完成此操作流程。',
        viewport_width: innerWidth, viewport_height: innerHeight,
        page_context: pageContext(), scroll_state: { x: scrollX, y: scrollY },
        password_rects: passwordRects(), capture_warnings: captureWarnings(), duration: 3, terminal: true,
      },
    })
    return true
  }
  return undefined
})

chrome.runtime.sendMessage({ type: 'IS_RECORDING' }).then(applyState).catch(() => {})
document.addEventListener('pointermove', onPointerMove, true)
document.addEventListener('pointerdown', onPointer, true)
