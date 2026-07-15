import { captureDom, captureWarnings, normalized, pageContext, passwordRects, targetInfo } from './snapshot'
import { browserLocale, tr } from './locale'
import type { CapturedSnapshot, Locale, RecordingMode } from './types'

type RecorderState = {
  active?: boolean
  paused?: boolean
  capturing?: boolean
  phase?: '' | 'uploading'
  steps?: number
  mode?: RecordingMode
  aiEnabled?: boolean
  locale?: Locale
}

let active = false
let paused = false
let capturing = false
let phase: '' | 'uploading' = ''
let steps = 0
let mode: RecordingMode = 'html'
let aiEnabled = false
let locale: Locale = browserLocale()
let currentSnapshot: CapturedSnapshot | null = null
let refreshTimer: number | undefined
let hudHost: HTMLDivElement | null = null
let setupHost: HTMLDivElement | null = null
let highlight: HTMLDivElement | null = null
let statusText: HTMLSpanElement | null = null
let modeText: HTMLSpanElement | null = null
let countText: HTMLSpanElement | null = null
let pauseButton: HTMLButtonElement | null = null
let lockLayer: HTMLDivElement | null = null
let lastError = ''
let blockedClickTarget: HTMLElement | null = null
let replayingClick = false
let lockTimer: number | undefined

const icon = (name: 'clone' | 'image' | 'ai' | 'cursor' | 'clock' | 'stop' | 'pause' | 'play' | 'camera' | 'steps' | 'drag') => {
  const paths = {
    clone: '<rect x="4" y="4" width="13" height="13" rx="2"/><path d="M8 17v3h12V8h-3"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m3 17 5-5 4 4 3-3 6 6"/>',
    ai: '<path d="m12 3 1.3 4.2 4.2 1.3-4.2 1.3L12 14l-1.3-4.2-4.2-1.3 4.2-1.3L12 3Z"/><path d="m19 14 .8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14Z"/>',
    cursor: '<path d="m5 3 13 9-6 1.5L9 19 5 3Z"/><path d="m13 14 4 5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    pause: '<path d="M9 6v12M15 6v12"/>',
    play: '<path d="m9 6 9 6-9 6V6Z"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4V8Z"/><circle cx="12" cy="13" r="3"/>',
    steps: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
    drag: '<path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01"/>',
  }
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`
}

function selectableTarget(raw: Element | null): HTMLElement | null {
  if (!raw || raw.closest('.docflow-recorder-ui')) return null
  const semantic = raw.closest<HTMLElement>('button,a,input,select,textarea,label,[role="button"],[role="link"],[onclick],[tabindex]')
  const target = semantic || (raw instanceof HTMLElement ? raw : raw.parentElement)
  return !target || target === document.documentElement || target === document.body ? null : target
}

function showRecordingSetup(message: { demoId: string; aiAvailable?: boolean; locale?: Locale }) {
  if (window.top !== window || active) return
  setupHost?.remove()
  locale = message.locale || browserLocale()
  const host = document.createElement('div')
  host.className = 'docflow-recorder-ui'
  const shadow = host.attachShadow({ mode: 'closed' })
  setupHost = host
  let selectedMode: RecordingMode = 'html'
  let selectedAI = Boolean(message.aiAvailable)
  let tutorialIndex = 0
  shadow.innerHTML = `<style>
    :host{all:initial;position:fixed;inset:0;z-index:2147483647;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#182033}
    *{box-sizing:border-box}.backdrop{position:fixed;inset:0;display:grid;place-items:center;padding:24px;background:#0b1020a8;backdrop-filter:blur(5px)}
    .modal{width:min(620px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto;border:1px solid #ffffff30;border-radius:20px;background:#fff;box-shadow:0 30px 90px #0007}
    .head{padding:24px 26px 16px}.brand{display:flex;align-items:center;gap:8px;margin-bottom:15px;color:#635bff;font-size:12px;font-weight:800;letter-spacing:.05em}.brand i{width:9px;height:9px;border-radius:50%;background:#635bff;box-shadow:0 0 0 5px #635bff1c}
    h2{margin:0 0 7px;font-size:22px;line-height:1.25}p{margin:0;color:#6b768a;font-size:13px;line-height:1.55}.body{display:grid;gap:12px;padding:4px 26px 22px}
    .modes{display:grid;grid-template-columns:1fr 1fr;gap:12px}.mode{position:relative;display:grid;grid-template-columns:38px 1fr;gap:11px;padding:15px;border:1px solid #dfe3eb;border-radius:13px;background:#fff;text-align:left;cursor:pointer}.mode.active{border-color:#635bff;box-shadow:0 0 0 3px #635bff1a;background:#faf9ff}.mode svg,.step-icon svg,.ai-icon svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.mode>span:first-child{width:38px;height:38px;display:grid;place-items:center;border-radius:10px;color:#554ae8;background:#eeedff}.mode strong{display:block;margin-bottom:4px;font-size:13px}.mode small{display:block;color:#748095;font-size:11px;line-height:1.4}.badge{position:absolute;right:10px;top:9px;padding:3px 6px;border-radius:10px;color:#4f46e5;background:#ecebff;font-size:8px;font-style:normal}
    .ai-row{display:grid;grid-template-columns:36px 1fr auto;align-items:center;gap:11px;padding:13px 14px;border:1px solid #e3e6ed;border-radius:12px;background:#f8f9fc}.ai-icon{width:36px;height:36px;display:grid;place-items:center;border-radius:10px;color:#7357df;background:#eee9ff}.ai-row strong{display:block;margin-bottom:2px;font-size:12px}.ai-row small{display:block;color:#7c8799;font-size:10px;line-height:1.35}.switch{position:relative;width:42px;height:24px}.switch input{position:absolute;opacity:0}.switch span{position:absolute;inset:0;border-radius:20px;background:#cbd2dd;transition:.2s}.switch span:after{content:"";position:absolute;left:3px;top:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 4px #0003;transition:.2s}.switch input:checked+span{background:#635bff}.switch input:checked+span:after{transform:translateX(18px)}.switch input:disabled+span{opacity:.45}
    .actions{display:flex;justify-content:flex-end;gap:9px;padding:15px 26px 22px;border-top:1px solid #edf0f4}.btn{min-width:100px;padding:10px 15px;border:1px solid #d8dde7;border-radius:10px;background:#fff;color:#38445a;font:600 12px inherit;cursor:pointer}.btn.primary{border-color:#635bff;background:#635bff;color:#fff}.btn:hover{filter:brightness(.98)}
    .tutorial{padding:6px 26px 24px}.progress{display:flex;gap:6px;margin:0 0 19px}.progress i{height:4px;flex:1;border-radius:4px;background:#e5e7ec}.progress i.done{background:#635bff}.step-card{min-height:205px;display:grid;place-items:center;align-content:center;gap:14px;padding:28px;border:1px solid #e2e5ec;border-radius:16px;text-align:center;background:linear-gradient(145deg,#fafaff,#f5f6fa);animation:enter .25s ease}.step-icon{width:60px;height:60px;display:grid;place-items:center;border-radius:18px;color:#5b50e5;background:#eae8ff;box-shadow:0 8px 24px #635bff20}.step-icon svg{width:29px;height:29px}.step-card h3{margin:0;font-size:17px}.step-card p{max-width:450px}.step-number{color:#8a94a6;font-size:10px;font-weight:700;letter-spacing:.08em}@keyframes enter{from{opacity:.2;transform:translateY(5px)}}
    @media(max-width:560px){.modes{grid-template-columns:1fr}.modal{border-radius:15px}.head,.body,.tutorial{padding-left:18px;padding-right:18px}.actions{padding-left:18px;padding-right:18px}}
  </style><div class="backdrop"><section class="modal"><div id="view"></div></section></div>`
  const view = shadow.querySelector<HTMLDivElement>('#view')!

  const renderConfig = () => {
    view.innerHTML = `<div class="head"><div class="brand"><i></i>DOCFLOW RECORDER</div><h2>${tr(locale, 'setupTitle')}</h2><p>${tr(locale, 'setupDescription')}</p></div><div class="body"><div class="modes">
      <button class="mode ${selectedMode === 'html' ? 'active' : ''}" data-mode="html"><span>${icon('clone')}</span><span><strong>${tr(locale, 'htmlTitle')}</strong><small>${tr(locale, 'htmlDescription')}</small></span><em class="badge">${tr(locale, 'htmlBadge')}</em></button>
      <button class="mode ${selectedMode === 'screenshot' ? 'active' : ''}" data-mode="screenshot"><span>${icon('image')}</span><span><strong>${tr(locale, 'screenshotTitle')}</strong><small>${tr(locale, 'screenshotDescription')}</small></span></button></div>
      <div class="ai-row"><span class="ai-icon">${icon('ai')}</span><span><strong>${tr(locale, 'aiTitle')}</strong><small>${message.aiAvailable ? tr(locale, 'aiDescription') : tr(locale, 'aiUnavailable')}</small></span><label class="switch"><input id="ai-toggle" type="checkbox" ${selectedAI ? 'checked' : ''} ${message.aiAvailable ? '' : 'disabled'}><span></span></label></div></div>
      <div class="actions"><button class="btn" id="cancel">${tr(locale, 'cancel')}</button><button class="btn primary" id="continue">${tr(locale, 'startSetup')}</button></div>`
    view.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => button.addEventListener('click', () => { selectedMode = button.dataset.mode as RecordingMode; renderConfig() }))
    view.querySelector<HTMLInputElement>('#ai-toggle')?.addEventListener('change', event => { selectedAI = (event.currentTarget as HTMLInputElement).checked })
    view.querySelector('#cancel')?.addEventListener('click', () => { host.remove(); setupHost = null })
    view.querySelector('#continue')?.addEventListener('click', () => { tutorialIndex = 0; renderTutorial() })
  }

  const tutorial = [
    { icon: 'cursor' as const, title: tr(locale, 'hoverTitle'), description: tr(locale, 'hoverDescription') },
    { icon: 'clock' as const, title: tr(locale, 'pauseTitle'), description: tr(locale, 'pauseDescription') },
    { icon: 'stop' as const, title: tr(locale, 'stopTitle'), description: tr(locale, 'stopDescription') },
  ]
  const renderTutorial = () => {
    const step = tutorial[tutorialIndex]
    view.innerHTML = `<div class="head"><div class="brand"><i></i>DOCFLOW RECORDER</div><h2>${tr(locale, 'tutorialTitle')}</h2></div><div class="tutorial"><div class="progress">${tutorial.map((_, index) => `<i class="${index <= tutorialIndex ? 'done' : ''}"></i>`).join('')}</div><div class="step-card"><span class="step-number">${tutorialIndex + 1} / ${tutorial.length}</span><span class="step-icon">${icon(step.icon)}</span><h3>${step.title}</h3><p>${step.description}</p></div></div><div class="actions"><button class="btn" id="back">${tutorialIndex ? tr(locale, 'back') : tr(locale, 'cancel')}</button><button class="btn primary" id="next">${tutorialIndex === tutorial.length - 1 ? tr(locale, 'getStarted') : tr(locale, 'next')}</button></div>`
    view.querySelector('#back')?.addEventListener('click', () => { if (tutorialIndex) { tutorialIndex -= 1; renderTutorial() } else renderConfig() })
    view.querySelector('#next')?.addEventListener('click', async () => {
      if (tutorialIndex < tutorial.length - 1) { tutorialIndex += 1; renderTutorial(); return }
      host.remove(); setupHost = null
      const result = await chrome.runtime.sendMessage({ type: 'START', demoId: message.demoId, mode: selectedMode, aiEnabled: selectedAI })
      if (result?.error) { window.alert(result.error); showRecordingSetup(message) }
    })
  }
  renderConfig()
  ;(document.documentElement || document.body).appendChild(host)
}

function ensureHud() {
  if (hudHost?.isConnected || !active || window.top !== window) return
  const parent = document.documentElement || document.body
  if (!parent) { window.setTimeout(ensureHud, 50); return }
  const host = document.createElement('div')
  host.className = 'docflow-recorder-ui'
  const shadow = host.attachShadow({ mode: 'closed' })
  shadow.innerHTML = `<style>
    :host{all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"PingFang SC",sans-serif}
    *{box-sizing:border-box}.lock{position:fixed;z-index:1;inset:0;display:none;pointer-events:auto;background:#0f172a12;cursor:progress}.lock.active{display:block}
    .outline{position:fixed;z-index:2;display:none;border:3px solid #6d5dfc;border-radius:8px;background:#6d5dfc18;box-shadow:0 0 0 2px #fff9;transition:all 55ms linear}
    .hud{position:fixed;z-index:3;left:20px;bottom:20px;display:flex;align-items:center;gap:5px;padding:6px;border:1px solid #ffffff24;border-radius:13px;background:#101725f2;color:#fff;box-shadow:0 14px 38px #0006;pointer-events:auto;backdrop-filter:blur(16px);user-select:none}
    .drag{width:23px;height:34px;display:grid;place-items:center;border:0;color:#7f8ba0;background:transparent;cursor:move}.drag svg{width:18px;height:18px}
    .state{display:grid;gap:2px;min-width:100px;padding:0 8px 0 4px}.state strong{display:flex;align-items:center;gap:7px;font-size:11px;white-space:nowrap}.state strong:before{content:"";width:7px;height:7px;border-radius:50%;background:#ef4444;box-shadow:0 0 0 3px #ef444432}.state small{max-width:145px;overflow:hidden;color:#9da9bb;font-size:8px;white-space:nowrap;text-overflow:ellipsis}.hud.paused .state strong:before{background:#f59e0b;box-shadow:none}.hud.capturing .state strong:before{background:#8b5cf6;animation:pulse .7s infinite alternate}
    button.control,.count{position:relative;height:34px;display:inline-flex;align-items:center;justify-content:center;gap:5px;border:1px solid #ffffff17;border-radius:8px;color:#d9e0eb;background:#ffffff0b;font:600 10px inherit;cursor:pointer}.control{width:34px}.control:hover{color:#fff;background:#ffffff18}.control.stop{color:#fff;background:#dc3e50;border-color:#dc3e50}.control:disabled{opacity:.4;cursor:progress}.count{min-width:48px;padding:0 8px;color:#fff}.count svg,.control svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
    [data-tip]:hover:after{content:attr(data-tip);position:absolute;left:50%;bottom:calc(100% + 9px);transform:translateX(-50%);width:max-content;max-width:250px;padding:6px 8px;border-radius:6px;color:#fff;background:#080d17;font:10px/1.35 system-ui;box-shadow:0 4px 15px #0005;white-space:nowrap;pointer-events:none}.drag[data-tip]:hover:after{left:0;transform:none}
    @keyframes pulse{to{transform:scale(1.35);opacity:.65}}
  </style><div class="outline"></div><div class="lock"></div><div class="hud"><button class="drag" data-tip="">${icon('drag')}</button><div class="state"><strong></strong><small></small></div><button class="control pause" data-tip="">${icon('pause')}</button><span class="count">${icon('steps')}<b>0</b></span><button class="control manual" data-tip="">${icon('camera')}</button><button class="control stop" data-tip="">${icon('stop')}</button></div>`
  hudHost = host
  highlight = shadow.querySelector('.outline')
  lockLayer = shadow.querySelector('.lock')
  statusText = shadow.querySelector('.state strong')
  modeText = shadow.querySelector('.state small')
  countText = shadow.querySelector('.count b')
  const pauseControl = shadow.querySelector<HTMLButtonElement>('.pause')!
  pauseButton = pauseControl
  const hud = shadow.querySelector<HTMLDivElement>('.hud')!
  const drag = shadow.querySelector<HTMLButtonElement>('.drag')!
  const manual = shadow.querySelector<HTMLButtonElement>('.manual')!
  const stop = shadow.querySelector<HTMLButtonElement>('.stop')!

  drag.addEventListener('pointerdown', event => {
    event.preventDefault(); event.stopPropagation()
    const rect = hud.getBoundingClientRect(), startX = event.clientX, startY = event.clientY
    drag.setPointerCapture(event.pointerId)
    const move = (next: PointerEvent) => {
      const left = Math.max(8, Math.min(innerWidth - rect.width - 8, rect.left + next.clientX - startX))
      const top = Math.max(8, Math.min(innerHeight - rect.height - 8, rect.top + next.clientY - startY))
      Object.assign(hud.style, { left: `${left}px`, top: `${top}px`, right: 'auto', bottom: 'auto' })
    }
    const up = () => { drag.removeEventListener('pointermove', move); drag.removeEventListener('pointerup', up) }
    drag.addEventListener('pointermove', move); drag.addEventListener('pointerup', up)
  })
  pauseControl.addEventListener('click', event => { event.stopPropagation(); chrome.runtime.sendMessage({ type: 'PAUSE' }).catch(() => {}) })
  stop.addEventListener('click', event => { event.stopPropagation(); capturing = true; renderHud(); chrome.runtime.sendMessage({ type: 'STOP' }).catch(() => {}) })
  manual.addEventListener('click', async event => {
    event.stopPropagation()
    if (!active || paused || capturing) return
    const snapshot = mode === 'html' ? (captureDom() || currentSnapshot) : undefined
    const data = {
      event_id: crypto.randomUUID(), title: tr(locale, 'manualTitle'), body: tr(locale, 'manualBody'),
      viewport_width: innerWidth, viewport_height: innerHeight, page_context: { ...pageContext(), manual_capture: true },
      scroll_state: { x: scrollX, y: scrollY }, password_rects: passwordRects(),
      capture_warnings: captureWarnings(), duration: 3, terminal: false,
    }
    capturing = true; phase = 'uploading'; renderHud()
    try {
      const result = await chrome.runtime.sendMessage({ type: 'MANUAL_STEP', data, snapshot })
      if (result?.error) throw new Error(result.error)
      if (typeof result?.steps === 'number') steps = result.steps
    } catch (error) { lastError = `${tr(locale, 'captureFailed')}: ${(error as Error).message}` }
    finally { capturing = false; phase = ''; renderHud(); scheduleRefresh() }
  })
  parent.appendChild(host)
  renderHud()
}

function clearHighlight() { if (highlight) highlight.style.display = 'none' }

function renderHud() {
  if (!active) {
    hudHost?.remove(); hudHost = highlight = null; statusText = modeText = countText = null; pauseButton = null; lockLayer = null
    return
  }
  ensureHud()
  const hud = statusText?.closest('.hud')
  hud?.classList.toggle('paused', paused)
  hud?.classList.toggle('capturing', capturing)
  lockLayer?.classList.toggle('active', capturing)
  if (statusText) statusText.textContent = lastError || (capturing ? tr(locale, 'capturing') : paused ? tr(locale, 'paused') : tr(locale, 'recording'))
  if (modeText) modeText.textContent = capturing ? tr(locale, 'uploading') : `${mode === 'html' ? tr(locale, 'htmlMode') : tr(locale, 'screenshotMode')}${aiEnabled ? ' · AI' : ''}`
  if (countText) countText.textContent = String(steps)
  if (pauseButton) {
    pauseButton.innerHTML = icon(paused ? 'play' : 'pause')
    pauseButton.dataset.tip = tr(locale, 'pauseTooltip')
    pauseButton.disabled = capturing
  }
  const shadow = hudHost?.shadowRoot
  // The shadow root is closed; tooltips are assigned when controls are found
  // during creation and refreshed through the retained element references.
  const controls = hud?.querySelectorAll<HTMLElement>('[data-tip]') || []
  controls.forEach(control => {
    if (control.classList.contains('drag')) control.dataset.tip = tr(locale, 'dragTooltip')
    if (control.classList.contains('manual')) control.dataset.tip = tr(locale, 'manualTooltip')
    if (control.classList.contains('stop')) control.dataset.tip = tr(locale, 'stopTooltip')
  })
  void shadow
  if (paused || capturing || mode !== 'html') clearHighlight()
}

function applyState(state: RecorderState) {
  active = Boolean(state.active); paused = Boolean(state.paused); capturing = Boolean(state.capturing)
  phase = state.phase || ''; steps = Number(state.steps || 0); mode = state.mode || 'html'
  aiEnabled = Boolean(state.aiEnabled); locale = state.locale || locale
  if (!capturing) lastError = ''
  renderHud()
  if (active && !paused && mode === 'html') window.setTimeout(refreshSnapshot, document.readyState === 'complete' ? 0 : 500)
  else currentSnapshot = null
}

function refreshSnapshot() {
  if (!active || paused || mode !== 'html' || window.top !== window) return
  try { currentSnapshot = captureDom() } catch { currentSnapshot = null }
}
function scheduleRefresh() { window.clearTimeout(refreshTimer); refreshTimer = window.setTimeout(refreshSnapshot, 600) }

function shouldFreezeClick(target: HTMLElement) {
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return false
  if (target instanceof HTMLInputElement) return ['button', 'submit', 'image', 'reset', 'checkbox', 'radio'].includes(target.type)
  return true
}

function clearBlockedClick() {
  blockedClickTarget = null
  window.clearTimeout(lockTimer)
}

function suppressBlockedClick(event: MouseEvent) {
  if (!blockedClickTarget || replayingClick || !event.isTrusted) return
  const raw = event.target
  if (!(raw instanceof Node) || !(raw === blockedClickTarget || blockedClickTarget.contains(raw) || (raw instanceof Element && raw.contains(blockedClickTarget)))) return
  event.preventDefault()
  event.stopImmediatePropagation()
  clearBlockedClick()
}

function replayClick(target: HTMLElement) {
  if (!target.isConnected) { clearBlockedClick(); return }
  capturing = false; phase = ''; renderHud()
  replayingClick = true
  try {
    target.focus({ preventScroll: true })
    target.click()
  } finally {
    replayingClick = false
    window.clearTimeout(lockTimer)
    lockTimer = window.setTimeout(clearBlockedClick, 900)
  }
}

function onPointerMove(event: PointerEvent) {
  if (!active || paused || capturing || mode !== 'html' || window.top !== window || !highlight) return
  const target = selectableTarget(event.target as Element | null)
  if (!target) { clearHighlight(); return }
  const rect = target.getBoundingClientRect()
  if (rect.width < 2 || rect.height < 2) { clearHighlight(); return }
  Object.assign(highlight.style, {
    display: 'block', left: `${Math.max(0, rect.left)}px`, top: `${Math.max(0, rect.top)}px`,
    width: `${Math.min(innerWidth, rect.right) - Math.max(0, rect.left)}px`, height: `${Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top)}px`,
  })
}

async function onPointer(event: PointerEvent) {
  if (!active || paused || capturing || event.button !== 0 || window.top !== window) return
  const target = selectableTarget(event.target as Element | null)
  if (!target?.getBoundingClientRect) return
  // The authoritative DOM snapshot is requested by the background immediately
  // before captureVisibleTab while this click remains blocked. Keep only the
  // cached value as a fallback for restricted pages or extension messaging.
  const snapshot = mode === 'html' ? (currentSnapshot || undefined) : undefined
  const info = targetInfo(target), isInput = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
  const label = info.text || info.aria_label || info.tag || (locale === 'zh' ? '目标元素' : 'target element')
  const body = locale === 'zh'
    ? (isInput ? `在「${label}」中输入或选择内容` : `点击「${label}」`)
    : (isInput ? `Enter or select a value in “${label}”` : `Click “${label}”`)
  const data = {
    event_id: crypto.randomUUID(), title: body, body, viewport_width: innerWidth, viewport_height: innerHeight,
    hotspot: normalized(target.getBoundingClientRect()), target: info, page_context: pageContext(target),
    scroll_state: { x: scrollX, y: scrollY }, password_rects: passwordRects(), capture_warnings: captureWarnings(), duration: 3, terminal: false,
  }
  const freezeClick = shouldFreezeClick(target)
  if (freezeClick) {
    blockedClickTarget = target
    window.clearTimeout(lockTimer)
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  capturing = true; phase = 'uploading'; clearHighlight(); renderHud()
  try {
    const result = await chrome.runtime.sendMessage({ type: 'STEP_EVENT', data, snapshot })
    if (result?.error) throw new Error(result.error)
    if (typeof result?.steps === 'number') steps = result.steps
  } catch (error) { lastError = `${tr(locale, 'captureFailed')}: ${(error as Error).message}` }
  finally {
    capturing = false; phase = ''; renderHud(); scheduleRefresh()
    if (freezeClick) replayClick(target)
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'SHOW_RECORDING_SETUP') { showRecordingSetup(message); sendResponse({ ok: true }); return }
  if (message.type === 'RECORDING_STATE') applyState(message)
  if (message.type === 'RECORDER_UI_VISIBILITY') {
    let synchronizedSnapshot: CapturedSnapshot | undefined
    if (message.hidden && message.captureSnapshot && mode === 'html') {
      try { synchronizedSnapshot = captureDom() || undefined } catch { synchronizedSnapshot = currentSnapshot || undefined }
    }
    if (hudHost) hudHost.style.display = message.hidden ? 'none' : ''
    if (setupHost) setupHost.style.display = message.hidden ? 'none' : ''
    requestAnimationFrame(() => sendResponse({ ok: true, snapshot: synchronizedSnapshot })); return true
  }
  if (message.type === 'CAPTURE_FINAL') {
    if (mode === 'html') refreshSnapshot()
    sendResponse({
      snapshot: mode === 'html' ? currentSnapshot : undefined,
      data: {
        event_id: crypto.randomUUID(), title: locale === 'zh' ? '流程完成' : 'Flow complete', body: locale === 'zh' ? '已完成此操作流程。' : 'This walkthrough is complete.',
        viewport_width: innerWidth, viewport_height: innerHeight, page_context: pageContext(), scroll_state: { x: scrollX, y: scrollY },
        password_rects: passwordRects(), capture_warnings: captureWarnings(), duration: 3, terminal: true,
      },
    }); return true
  }
  return undefined
})

chrome.runtime.sendMessage({ type: 'IS_RECORDING' }).then(applyState).catch(() => {})
window.addEventListener('click', suppressBlockedClick, true)
document.addEventListener('pointermove', onPointerMove, true)
document.addEventListener('pointerdown', onPointer, true)
