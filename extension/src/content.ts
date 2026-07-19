import { captureDom, captureWarnings, normalized, pageContext, passwordRects, targetInfo } from './snapshot'
import { browserLocale, tr } from './locale'
import type { CapturedSnapshot, Locale, RecordingMode } from './types'
import { isConfiguredWebPage } from './config'
import { quotaAllowed, quotaEndedText, quotaMessage, type WorkspaceCapabilities, type WorkspaceQuotaSummary } from './quota'
import { aiSettingsStyles, aiSettingsView, aiText } from './ai-settings'

type RecorderState = {
  active?: boolean
  paused?: boolean
  capturing?: boolean
  phase?: '' | 'uploading'
  steps?: number
  mode?: RecordingMode
  aiEnabled?: boolean
  error?: string
  locale?: Locale
  contentLocale?: Locale
}

let active = false
let paused = false
let capturing = false
let phase: '' | 'uploading' = ''
let steps = 0
let mode: RecordingMode = 'html'
let aiEnabled = false
let locale: Locale = browserLocale()
let contentLocale: Locale = locale
let currentSnapshot: CapturedSnapshot | null = null
let refreshTimer: number | undefined
let hudHost: HTMLDivElement | null = null
let setupHost: HTMLDivElement | null = null
let quotaEndHost: HTMLDivElement | null = null
let setupCleanup: (() => void) | null = null
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

function eventId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

const icon = (name: 'clone' | 'image' | 'ai' | 'cursor' | 'clock' | 'stop' | 'pause' | 'play' | 'camera' | 'steps' | 'drag' | 'team' | 'user' | 'warning' | 'resize' | 'tabs') => {
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
    team: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2"/><path d="M3 19c0-3.3 2.7-6 6-6s6 2.7 6 6M15 14c3 0 5 2 5 5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>',
    warning: '<path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v5M12 17h.01"/>',
    resize: '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/><path d="m3 8 6-6M21 8l-6-6M3 16l6 6M21 16l-6 6"/>',
    tabs: '<rect x="3" y="5" width="14" height="14" rx="2"/><path d="M7 5V3h14v14h-4"/>',
  }
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}

function showQuotaEnded(message: { message?: string; editorUrl?: string }) {
  if (window.top !== window) return
  quotaEndHost?.remove()
  const copy = quotaEndedText(locale)
  const host = document.createElement('div')
  host.className = 'docflow-recorder-ui'
  const shadow = host.attachShadow({ mode: 'closed' })
  shadow.innerHTML = `<style>
    :host{all:initial;position:fixed;inset:0;z-index:2147483647;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#1f2937}
    *{box-sizing:border-box}.backdrop{position:fixed;inset:0;display:grid;place-items:center;padding:24px;background:#0b1020a8;backdrop-filter:blur(5px)}.dialog{width:min(480px,calc(100vw - 32px));padding:27px;border:1px solid #ffffff30;border-radius:18px;background:#fff;box-shadow:0 28px 80px #0007}.icon{width:48px;height:48px;display:grid;place-items:center;margin-bottom:16px;border-radius:14px;color:#a66008;background:#ffedc9}.icon svg{width:25px;height:25px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}h2{margin:0 0 8px;font-size:20px;line-height:1.3}p{margin:0;color:#765016;font-size:12px;font-weight:700;line-height:1.55;white-space:pre-line}.saved{margin-top:13px;padding:11px 12px;border-radius:10px;color:#687386;background:#f5f6f8;font-size:11px;line-height:1.5}.actions{display:flex;justify-content:flex-end;gap:9px;margin-top:22px}.actions button,.actions a{min-width:100px;padding:10px 15px;border:1px solid #d9dee7;border-radius:9px;color:#38445a;background:#fff;font:650 11px inherit;text-align:center;text-decoration:none;cursor:pointer}.actions a{border-color:#635bff;color:#fff;background:#635bff}
  </style><div class="backdrop"><section class="dialog" role="alertdialog" aria-modal="true"><span class="icon"><svg viewBox="0 0 24 24"><path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v5M12 17h.01"/></svg></span><h2>${copy.title}</h2><p>${escapeHtml(String(message.message || ''))}</p><div class="saved">${copy.saved}</div><div class="actions"><button id="quota-close">${copy.close}</button><a href="${escapeHtml(String(message.editorUrl || '#'))}" target="_blank" rel="noopener noreferrer">${copy.open}</a></div></section></div>`
  quotaEndHost = host
  shadow.querySelector('#quota-close')?.addEventListener('click', () => { host.remove(); if (quotaEndHost === host) quotaEndHost = null })
  shadow.querySelector('a')?.addEventListener('click', () => { host.remove(); if (quotaEndHost === host) quotaEndHost = null })
  ;(document.documentElement || document.body).appendChild(host)
}

function selectableTarget(raw: Element | null): HTMLElement | null {
  if (!raw || raw.closest('.docflow-recorder-ui')) return null
  const semantic = raw.closest<HTMLElement>('button,a,input,select,textarea,label,[role="button"],[role="link"],[onclick],[tabindex]')
  const target = semantic || (raw instanceof HTMLElement ? raw : raw.parentElement)
  return !target || target === document.documentElement || target === document.body ? null : target
}

function showRecordingSetup(message: {
  demoId?: string
  aiAvailable?: boolean
  defaultMode?: RecordingMode
  defaultAI?: boolean
  spaces?: { id: string; name: string; kind: 'personal' | 'team' }[]
  organizationId?: string
  lockOrganization?: boolean
  diagnostics?: {
    width: number
    height: number
    tabCount: number
    closableTabCount: number
    recommendedWidth: number
    recommendedHeight: number
  }
  locale?: Locale
  contentLocale?: Locale
  aiContext?: string
}) {
  if (window.top !== window || active) return
  setupCleanup?.()
  locale = message.locale || browserLocale()
  contentLocale = message.contentLocale || locale
  const host = document.createElement('div')
  host.className = 'docflow-recorder-ui'
  const shadow = host.attachShadow({ mode: 'closed' })
  setupHost = host
  let selectedMode: RecordingMode = message.defaultMode || 'html'
  let selectedAI = Boolean(message.aiAvailable && message.defaultAI)
  let capabilities: WorkspaceCapabilities | null = null
  let quotaSummary: WorkspaceQuotaSummary | null = null
  let quotaSummaryError = ''
  let quotaLoading = true
  let quotaError = ''
  let quotaRequest = 0
  let tutorialIndex = 0
  let setupView: 'config' | 'ai' | 'tutorial' = 'config'
  let aiContext = String(message.aiContext || '').slice(0, 500)
  let aiDraftEnabled = selectedAI
  let aiDraftContext = aiContext
  let aiDraftLocale = contentLocale
  const availableSpaces = [...(message.spaces || [])].sort((left, right) => Number(left.kind === 'personal') - Number(right.kind === 'personal'))
  let selectedOrganizationId = availableSpaces.some(space => space.id === message.organizationId) ? message.organizationId! : availableSpaces[0]?.id || ''
  let diagnostics = message.diagnostics
  let resizeTimer: number | undefined
  let quotaTimer: number | undefined
  let onWindowResize = () => {}
  const closeSetup = () => {
    window.clearTimeout(resizeTimer)
    window.clearInterval(quotaTimer)
    window.removeEventListener('resize', onWindowResize)
    host.remove()
    if (setupHost === host) setupHost = null
    if (setupCleanup === closeSetup) setupCleanup = null
  }
  setupCleanup = closeSetup
  shadow.innerHTML = `<style>
    :host{all:initial;position:fixed;inset:0;z-index:2147483647;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#182033}
    *{box-sizing:border-box}.backdrop{position:fixed;inset:0;display:grid;place-items:center;padding:20px;background:#0b1020a8;backdrop-filter:blur(5px)}
    .dialog-stack{width:min(760px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto;padding:1px 1px 24px}.modal{width:100%;overflow:visible;border:1px solid #ffffff30;border-radius:22px;background:#fff;box-shadow:0 30px 90px #0007}
    .head{padding:26px 32px 18px}.brand{display:flex;align-items:center;gap:8px;margin-bottom:15px;color:#635bff;font-size:12px;font-weight:800;letter-spacing:.05em}.brand i{width:9px;height:9px;border-radius:50%;background:#635bff;box-shadow:0 0 0 5px #635bff1c}
    h2{margin:0 0 7px;font-size:23px;line-height:1.25}p{margin:0;color:#6b768a;font-size:13px;line-height:1.55}.body{display:grid;gap:17px;padding:4px 32px 25px}
    .diagnostics-host{width:min(580px,calc(100% - 112px));margin:-1px auto 0}.diagnostics-host:empty{display:none}.diagnostics{display:grid;padding:6px 12px 8px;border:1px solid #eee6d5;border-top-color:#f5eddf;border-radius:0 0 14px 14px;background:linear-gradient(180deg,#fdfbf6,#faf7ef);box-shadow:0 -5px 16px #4f3c160d,0 12px 26px #17130b20}.diagnostic{display:grid;grid-template-columns:32px minmax(0,1fr) auto;align-items:center;gap:10px;padding:8px 4px;background:transparent}.diagnostic+.diagnostic{border-top:1px solid #eee5d3}.diagnostic>span{width:32px;height:32px;display:grid;place-items:center;border-radius:8px;color:#9d793d;background:#f4ecd9}.diagnostic>span svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.diagnostic div{min-width:0}.diagnostic strong{display:block;margin-bottom:2px;color:#68583d;font-size:11.5px}.diagnostic p{color:#8b7b60;font-size:9.5px;line-height:1.4}.diagnostic button{min-width:84px;padding:7px 9px;border:1px solid #ded2b8;border-radius:8px;color:#705d37;background:#fffdfa;font:700 9.5px inherit;cursor:pointer;white-space:nowrap}.diagnostic button:hover{background:#f8f1e3}.diagnostic button:disabled{opacity:.55;cursor:progress}
    .modes{display:grid;grid-template-columns:1fr 1fr;gap:16px}.mode{position:relative;min-height:196px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px 22px;border:1px solid #dfe3eb;border-radius:17px;background:#fff;text-align:center;cursor:pointer;transition:border-color .2s,box-shadow .2s,transform .2s,background .2s}.mode:hover{border-color:#c9c5ff;transform:translateY(-1px)}.mode.active{border-color:#7468f4;box-shadow:0 12px 30px #635bff22,0 0 0 3px #635bff16;background:linear-gradient(145deg,#fff 0%,#f8f6ff 46%,#ece9ff 100%)}.mode svg,.step-icon svg,.ai-icon svg,.space-icon svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.mode>span:first-child{width:62px;height:62px;display:grid;place-items:center;border-radius:18px;color:#554ae8;background:linear-gradient(145deg,#eeedff,#dfdcff);box-shadow:0 8px 20px #635bff20}.mode>span:first-child svg{width:31px;height:31px}.mode>span:nth-child(2){display:block}.mode strong{display:block;margin-bottom:6px;font-size:15px;text-align:center}.mode small{display:block;max-width:260px;color:#748095;font-size:12px;line-height:1.5;text-align:center}.badge{position:absolute;right:13px;top:12px;padding:4px 8px;border-radius:10px;color:#4f46e5;background:#e8e6ff;font-size:9px;font-style:normal;font-weight:750}
    .config-row{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(210px,.75fr);align-items:center;gap:12px;padding-top:2px}.space-field{height:48px;min-width:0;margin:0;padding:0 9px 4px;border:1px solid #d9dee8;border-radius:10px}.space-field legend{margin-left:5px;padding:0 6px;color:#69758a;background:#fff;font-size:10px;font-weight:750;line-height:13px}.space-dropdown{position:relative;height:100%}.space-trigger{width:100%;height:100%;min-height:30px;display:grid;grid-template-columns:30px minmax(0,1fr) auto;align-items:center;gap:8px;padding:1px;border:0;color:#344054;background:#fff;font:600 12px inherit;text-align:left;cursor:pointer}.space-trigger:disabled{cursor:not-allowed;opacity:.7}.space-icon{width:30px;height:30px;display:grid;place-items:center;border-radius:8px;color:#5c52df;background:#eeedff}.space-icon svg{width:16px;height:16px}.space-trigger strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.chevron{color:#8a94a6;font-size:11px}.space-menu{position:absolute;z-index:4;left:-9px;right:-9px;bottom:calc(100% + 10px);max-height:210px;overflow:auto;padding:6px;border:1px solid #dfe3eb;border-radius:11px;background:#fff;box-shadow:0 14px 35px #1820332e}.space-menu[hidden]{display:none}.space-option{width:100%;display:grid;grid-template-columns:30px minmax(0,1fr);align-items:center;gap:9px;padding:7px;border:0;border-radius:8px;color:#344054;background:transparent;text-align:left;cursor:pointer}.space-option:hover,.space-option.active{background:#f3f1ff}.space-option.group-start{margin-top:5px;padding-top:10px;border-top:1px solid #edf0f4;border-radius:0 0 8px 8px}.space-option div{min-width:0}.space-option strong,.space-option small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.space-option strong{font-size:11px}.space-option small{margin-top:2px;color:#8a94a6;font-size:9px}
    .ai-setting-button{width:100%;height:48px;min-width:0;display:grid;grid-template-columns:30px minmax(0,1fr) 16px;align-items:center;gap:8px;padding:6px 9px;border:1px solid #dedbf9;border-radius:10px;color:#303a4d;background:linear-gradient(135deg,#fbfaff,#f6f4ff);font-family:inherit;text-align:left;cursor:pointer;transition:border-color .18s,box-shadow .18s,transform .18s}.ai-setting-button:hover{border-color:#aaa3f3;box-shadow:0 7px 18px #635bff12;transform:translateY(-1px)}.ai-setting-button.blocked{border-color:#e4a642;background:linear-gradient(135deg,#fffdf8,#fff6e6)}.ai-setting-button.loading{border-color:#dfe3eb;background:#fafbfc}.ai-icon{width:30px;height:30px;display:grid;place-items:center;border-radius:8px;color:#6658e8;background:#eae7ff}.ai-icon svg{width:16px;height:16px}.ai-setting-button.blocked .ai-icon{color:#a96913;background:#ffedc9}.ai-button-copy{min-width:0;display:flex;align-items:center;gap:7px}.ai-button-copy strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px}.ai-status-tag{flex:0 0 auto;padding:2px 6px;border-radius:999px;color:#69758a;background:#e9edf3;font-size:8px;font-style:normal;font-weight:800;line-height:1.35;letter-spacing:.035em}.ai-status-tag.enabled{color:#4d43ce;background:#e7e4ff}.ai-setting-button.blocked .ai-status-tag{color:#925c0c;background:#ffebc4}.ai-button-chevron{color:#8b94a5;font-size:17px;text-align:right}
    .quota-note{display:flex;align-items:flex-start;gap:8px;margin-top:-7px;padding:10px 12px;border:1px solid #ead9a3;border-radius:10px;color:#72581e;background:#fffaf0;font-size:11px;font-weight:650;line-height:1.45;white-space:pre-line}.quota-note i{width:7px;height:7px;flex:0 0 auto;margin-top:4px;border-radius:50%;background:#d89a24;box-shadow:0 0 0 4px #d89a2418}
    .actions{display:flex;justify-content:flex-end;gap:9px;padding:16px 32px 22px;border-top:1px solid #edf0f4}.btn{min-width:106px;padding:11px 16px;border:1px solid #d8dde7;border-radius:10px;background:#fff;color:#38445a;font:600 12px inherit;cursor:pointer}.btn.primary{border-color:#635bff;background:#635bff;color:#fff}.btn:hover{filter:brightness(.98)}
    .tutorial{padding:6px 26px 24px}.progress{display:flex;gap:6px;margin:0 0 19px}.progress i{height:4px;flex:1;border-radius:4px;background:#e5e7ec}.progress i.done{background:#635bff}.step-card{min-height:205px;display:grid;place-items:center;align-content:center;gap:14px;padding:28px;border:1px solid #e2e5ec;border-radius:16px;text-align:center;background:linear-gradient(145deg,#fafaff,#f5f6fa);animation:enter .25s ease}.step-icon{width:60px;height:60px;display:grid;place-items:center;border-radius:18px;color:#5b50e5;background:#eae8ff;box-shadow:0 8px 24px #635bff20}.step-icon svg{width:29px;height:29px}.step-card h3{margin:0;font-size:17px}.step-card p{max-width:450px}.step-number{color:#8a94a6;font-size:10px;font-weight:700;letter-spacing:.08em}@keyframes enter{from{opacity:.2;transform:translateY(5px)}}
    @media(max-width:620px){.modes,.config-row{grid-template-columns:1fr}.mode{min-height:178px}.diagnostics-host{width:calc(100% - 48px)}.diagnostic{grid-template-columns:32px 1fr}.diagnostic button{grid-column:2;width:max-content}.modal{border-radius:15px}.head,.body,.tutorial{padding-left:18px;padding-right:18px}.actions{padding-left:18px;padding-right:18px}}
    ${aiSettingsStyles}
  </style><div class="backdrop"><div class="dialog-stack"><section class="modal"><div id="view"></div></section><div id="diagnostics-view" class="diagnostics-host"></div></div></div>`
  const view = shadow.querySelector<HTMLDivElement>('#view')!
  const diagnosticsView = shadow.querySelector<HTMLDivElement>('#diagnostics-view')!

  const startRecording = async () => {
    const result = await chrome.runtime.sendMessage({ type: 'START', demoId: message.demoId, organizationId: selectedOrganizationId, mode: selectedMode, aiEnabled: selectedAI, aiContext, locale, contentLocale })
    if (result?.error) { window.alert(result.error); return }
    closeSetup()
  }

  const renderAISettings = () => {
    setupView = 'ai'
    diagnosticsView.replaceChildren()
    const aiAllowed = !quotaLoading && !quotaError && Boolean(message.aiAvailable) && quotaAllowed(capabilities, 'use_ai')
    if (!quotaLoading && !aiAllowed) aiDraftEnabled = false
    const unavailableReason = !message.aiAvailable ? tr(locale, 'aiUnavailable') : quotaLoading ? tr(locale, 'quotaChecking') : quotaError || (!quotaAllowed(capabilities, 'use_ai') ? quotaMessage(capabilities, 'use_ai', locale) : quotaSummaryError)
    view.innerHTML = aiSettingsView({
      locale, enabled: aiDraftEnabled, allowed: aiAllowed, loading: quotaLoading,
      context: aiDraftContext, contentLocale: aiDraftLocale, quota: quotaSummary, unavailableReason,
    })
    const close = () => renderConfig()
    view.querySelector('#ai-config-close')?.addEventListener('click', close)
    view.querySelector('#ai-config-cancel')?.addEventListener('click', close)
    view.querySelector<HTMLInputElement>('#ai-config-toggle')?.addEventListener('change', event => { aiDraftEnabled = (event.currentTarget as HTMLInputElement).checked })
    view.querySelector<HTMLTextAreaElement>('#ai-context')?.addEventListener('input', event => {
      aiDraftContext = (event.currentTarget as HTMLTextAreaElement).value.slice(0, 500)
      const count = view.querySelector<HTMLElement>('#ai-context-count')
      if (count) count.textContent = `${aiDraftContext.length}/500`
    })
    view.querySelector<HTMLSelectElement>('#ai-language')?.addEventListener('change', event => { aiDraftLocale = (event.currentTarget as HTMLSelectElement).value as Locale })
    view.querySelector<HTMLButtonElement>('#ai-config-save')?.addEventListener('click', async event => {
      const button = event.currentTarget as HTMLButtonElement
      button.disabled = true
      selectedAI = aiAllowed && aiDraftEnabled
      aiContext = aiDraftContext.trim()
      contentLocale = aiDraftLocale
      await chrome.runtime.sendMessage({ type: 'SAVE_RECORDING_PREFERENCES', aiEnabled: selectedAI, contentLocale })
      renderConfig()
    })
  }

  const renderConfig = () => {
    setupView = 'config'
    const primaryAction = message.demoId ? 'record_step' : 'create_resource'
    const recordAllowed = !quotaLoading && !quotaError && quotaAllowed(capabilities, primaryAction) && quotaAllowed(capabilities, 'record_step')
    const aiAllowed = !quotaLoading && !quotaError && Boolean(message.aiAvailable) && quotaAllowed(capabilities, 'use_ai')
    if (!quotaLoading && !aiAllowed) selectedAI = false
    const recordQuotaMessage = quotaLoading ? '' : quotaError || [...new Set([
      !quotaAllowed(capabilities, primaryAction) ? quotaMessage(capabilities, primaryAction, locale) : '',
      !quotaAllowed(capabilities, 'record_step') ? quotaMessage(capabilities, 'record_step', locale) : '',
    ].filter(Boolean))].join('\n')
    const aiState = quotaLoading ? 'loading' : aiAllowed ? 'available' : 'blocked'
    const aiButtonStatus = selectedAI ? (contentLocale === 'zh-CN' ? 'ZH' : 'EN') : locale === 'zh-CN' ? '未开启' : 'OFF'
    const aiButtonTitle = quotaLoading ? '' : !message.aiAvailable ? tr(locale, 'aiUnavailable') : quotaError || (!aiAllowed ? aiText(locale, 'quotaReached') : '')
    const selectedSpace = availableSpaces.find(space => space.id === selectedOrganizationId)
    const spaceOptions = availableSpaces.map((space, index) => `<button class="space-option ${space.id === selectedOrganizationId ? 'active' : ''} ${space.kind === 'personal' && index > 0 && availableSpaces[index - 1].kind !== 'personal' ? 'group-start' : ''}" data-space-id="${escapeHtml(space.id)}"><span class="space-icon">${icon(space.kind === 'team' ? 'team' : 'user')}</span><div><strong>${escapeHtml(space.name)}</strong><small>${tr(locale, space.kind === 'team' ? 'teamSpace' : 'personalSpace')}</small></div></button>`).join('')
    const resizeWarning = Boolean(diagnostics?.width && diagnostics?.height && (Math.abs(diagnostics.width - diagnostics.recommendedWidth) > 48 || Math.abs(diagnostics.height - diagnostics.recommendedHeight) > 48))
    const tabWarning = Boolean(diagnostics && diagnostics.tabCount >= 10)
    const diagnosticCards = `${resizeWarning ? `<article class="diagnostic"><span>${icon('resize')}</span><div><strong>${tr(locale, 'resizeForOptimalRecording')}</strong><p>${tr(locale, 'resizeDescription', { width: diagnostics!.width, height: diagnostics!.height, recommendedWidth: diagnostics!.recommendedWidth, recommendedHeight: diagnostics!.recommendedHeight })}</p></div><button id="resize-window">${tr(locale, 'resize')}</button></article>` : ''}${tabWarning ? `<article class="diagnostic"><span>${icon('tabs')}</span><div><strong>${tr(locale, 'tabsOpen', { count: diagnostics!.tabCount })}</strong><p>${tr(locale, 'tabsDescription')}</p></div><button id="close-tabs" ${diagnostics!.closableTabCount ? '' : 'disabled'}>${tr(locale, 'closeOtherTabs')}</button></article>` : ''}`
    view.innerHTML = `<div class="head"><div class="brand"><i></i>DOCFLOW RECORDER</div><h2>${tr(locale, 'setupTitle')}</h2><p>${tr(locale, 'setupDescription')}</p></div><div class="body"><div class="modes">
      <button class="mode ${selectedMode === 'html' ? 'active' : ''}" data-mode="html"><span>${icon('clone')}</span><span><strong>${tr(locale, 'htmlTitle')}</strong><small>${tr(locale, 'htmlDescription')}</small></span><em class="badge">${tr(locale, 'htmlBadge')}</em></button>
      <button class="mode ${selectedMode === 'screenshot' ? 'active' : ''}" data-mode="screenshot"><span>${icon('image')}</span><span><strong>${tr(locale, 'screenshotDemoTitle')}</strong><small>${tr(locale, 'screenshotDescription')}</small></span></button></div>
      <div class="config-row"><fieldset class="space-field"><legend>${tr(locale, 'saveTo')}</legend><div class="space-dropdown"><button id="space-trigger" class="space-trigger" ${message.lockOrganization ? 'disabled' : ''}><span class="space-icon">${icon(selectedSpace?.kind === 'personal' ? 'user' : 'team')}</span><strong>${escapeHtml(selectedSpace?.name || tr(locale, 'noAvailableSpace'))}</strong><span class="chevron">⌄</span></button><div id="space-menu" class="space-menu" hidden>${spaceOptions}</div></div></fieldset>
      <button id="ai-settings-trigger" class="ai-setting-button ${aiState}" type="button" title="${escapeHtml(aiButtonTitle)}"><i class="ai-icon">${icon('ai')}</i><span class="ai-button-copy"><strong>${aiText(locale, 'title')}</strong><em class="ai-status-tag ${selectedAI ? 'enabled' : ''}">${aiButtonStatus}</em></span><span class="ai-button-chevron">›</span></button></div>${recordQuotaMessage ? `<div class="quota-note"><i></i><span>${escapeHtml(recordQuotaMessage)}</span></div>` : ''}</div>
      <div class="actions"><button class="btn" id="cancel">${tr(locale, 'cancel')}</button><button class="btn primary" id="continue" ${recordAllowed ? '' : 'disabled'} title="${escapeHtml(recordQuotaMessage)}">${tr(locale, 'startSetup')}</button></div>`
    diagnosticsView.innerHTML = diagnosticCards ? `<div class="diagnostics">${diagnosticCards}</div>` : ''
    view.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => button.addEventListener('click', () => { selectedMode = button.dataset.mode as RecordingMode; renderConfig() }))
    diagnosticsView.querySelector<HTMLButtonElement>('#resize-window')?.addEventListener('click', async event => {
      const button = event.currentTarget as HTMLButtonElement
      button.disabled = true; button.textContent = tr(locale, 'resizing')
      const result = await chrome.runtime.sendMessage({ type: 'RESIZE_RECORDING_WINDOW' })
      if (result?.error) { window.alert(result.error); button.disabled = false; button.textContent = tr(locale, 'resize'); return }
      if (diagnostics) diagnostics = { ...diagnostics, width: result.width, height: result.height }
      renderConfig()
    })
    diagnosticsView.querySelector<HTMLButtonElement>('#close-tabs')?.addEventListener('click', async event => {
      const button = event.currentTarget as HTMLButtonElement
      button.disabled = true; button.textContent = tr(locale, 'closingTabs')
      const result = await chrome.runtime.sendMessage({ type: 'CLOSE_OTHER_RECORDING_TABS' })
      if (result?.error) { window.alert(result.error); button.disabled = false; button.textContent = tr(locale, 'closeOtherTabs'); return }
      if (diagnostics) diagnostics = { ...diagnostics, tabCount: result.tabCount, closableTabCount: result.closableTabCount }
      renderConfig()
    })
    view.querySelector('#ai-settings-trigger')?.addEventListener('click', () => {
      aiDraftEnabled = selectedAI
      aiDraftContext = aiContext
      aiDraftLocale = contentLocale
      renderAISettings()
      void refreshQuota(true)
    })
    const spaceMenu = view.querySelector<HTMLElement>('#space-menu')
    view.querySelector('#space-trigger')?.addEventListener('click', () => { if (spaceMenu) spaceMenu.hidden = !spaceMenu.hidden })
    view.querySelectorAll<HTMLButtonElement>('[data-space-id]').forEach(button => button.addEventListener('click', () => { selectedOrganizationId = button.dataset.spaceId || selectedOrganizationId; void refreshQuota() }))
    view.querySelector('#cancel')?.addEventListener('click', closeSetup)
    view.querySelector('#continue')?.addEventListener('click', async () => {
      const stored = await chrome.storage.local.get('recordingTutorialSeen')
      const tutorialState = stored.recordingTutorialSeen as Partial<Record<RecordingMode, boolean>> | undefined
      if (tutorialState?.[selectedMode]) { await startRecording(); return }
      tutorialIndex = 0; renderTutorial()
    })
  }

  const refreshQuota = async (background = false) => {
    const requestId = ++quotaRequest
    const requestedOrganizationId = selectedOrganizationId
    if (!background) {
      quotaLoading = true; quotaError = ''; quotaSummaryError = ''; capabilities = null; quotaSummary = null
      if (setupView === 'config') renderConfig()
      else if (setupView === 'ai') renderAISettings()
    }
    const [result, summary] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'GET_QUOTA_CAPABILITIES', organizationId: requestedOrganizationId, demoId: message.demoId || '' }),
      chrome.runtime.sendMessage({ type: 'GET_QUOTA_SUMMARY', organizationId: requestedOrganizationId }),
    ])
    if (requestId !== quotaRequest || requestedOrganizationId !== selectedOrganizationId) return
    quotaLoading = false
    if (result?.error) quotaError = result.error
    else capabilities = result as WorkspaceCapabilities
    if (summary?.error) quotaSummaryError = summary.error
    else quotaSummary = summary as WorkspaceQuotaSummary
    if (!message.aiAvailable || !quotaAllowed(capabilities, 'use_ai')) selectedAI = false
    if (setupView === 'config') renderConfig()
    else if (setupView === 'ai') renderAISettings()
  }

  const renderTutorial = () => {
    setupView = 'tutorial'
    diagnosticsView.replaceChildren()
    const isHTMLMode = selectedMode === 'html'
    const tutorial = [
      { icon: 'cursor' as const, title: tr(locale, 'hoverTitle'), description: tr(locale, 'hoverDescription') },
      { icon: 'clock' as const, title: tr(locale, isHTMLMode ? 'pauseTitle' : 'screenshotPauseTitle'), description: tr(locale, isHTMLMode ? 'pauseDescription' : 'screenshotPauseDescription') },
      { icon: 'stop' as const, title: tr(locale, 'stopTitle'), description: tr(locale, isHTMLMode ? 'stopDescription' : 'screenshotStopDescription') },
    ]
    const step = tutorial[tutorialIndex]
    view.innerHTML = `<div class="head"><div class="brand"><i></i>DOCFLOW RECORDER</div><h2>${tr(locale, 'tutorialTitle')}</h2></div><div class="tutorial"><div class="progress">${tutorial.map((_, index) => `<i class="${index <= tutorialIndex ? 'done' : ''}"></i>`).join('')}</div><div class="step-card"><span class="step-number">${tutorialIndex + 1} / ${tutorial.length}</span><span class="step-icon">${icon(step.icon)}</span><h3>${step.title}</h3><p>${step.description}</p></div></div><div class="actions"><button class="btn" id="back">${tutorialIndex ? tr(locale, 'back') : tr(locale, 'cancel')}</button><button class="btn primary" id="next">${tutorialIndex === tutorial.length - 1 ? tr(locale, 'getStarted') : tr(locale, 'next')}</button></div>`
    view.querySelector('#back')?.addEventListener('click', () => { if (tutorialIndex) { tutorialIndex -= 1; renderTutorial() } else renderConfig() })
    view.querySelector('#next')?.addEventListener('click', async () => {
      if (tutorialIndex < tutorial.length - 1) { tutorialIndex += 1; renderTutorial(); return }
      const stored = await chrome.storage.local.get('recordingTutorialSeen')
      await chrome.storage.local.set({ recordingTutorialSeen: { ...(stored.recordingTutorialSeen || {}), [selectedMode]: true } })
      await startRecording()
    })
  }
  onWindowResize = () => {
    if (!diagnostics || !host.isConnected) return
    window.clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(() => {
      const width = Math.round(window.outerWidth), height = Math.round(window.outerHeight)
      if (!diagnostics || (diagnostics.width === width && diagnostics.height === height)) return
      diagnostics = { ...diagnostics, width, height }
      if (setupView === 'config') renderConfig()
    }, 180)
  }
  window.addEventListener('resize', onWindowResize)
  renderConfig()
  ;(document.documentElement || document.body).appendChild(host)
  void refreshQuota()
  quotaTimer = window.setInterval(() => { if (setupView === 'config') void refreshQuota(true) }, 15000)
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
      event_id: eventId(), title: tr(contentLocale, 'manualTitle'), body: tr(contentLocale, 'manualBody'),
      viewport_width: innerWidth, viewport_height: innerHeight, page_context: { ...pageContext(), manual_capture: true },
      scroll_state: { x: scrollX, y: scrollY }, password_rects: passwordRects(),
      capture_warnings: captureWarnings(), duration: 3, terminal: false,
    }
    capturing = true; phase = 'uploading'; renderHud()
    try {
      const result = await chrome.runtime.sendMessage({ type: 'MANUAL_STEP', data, snapshot })
      if (result?.quotaEnded) return
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
  aiEnabled = Boolean(state.aiEnabled); locale = state.locale || locale; contentLocale = state.contentLocale || contentLocale
  lastError = state.error ? `${tr(locale, 'captureFailed')}: ${state.error}` : capturing ? lastError : ''
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
  const label = info.text || info.aria_label || info.tag || tr(contentLocale, 'targetElement')
  const body = contentLocale === 'zh-CN'
    ? (isInput ? `在「${label}」中输入或选择内容` : `点击「${label}」`)
    : (isInput ? `Enter or select a value in “${label}”` : `Click “${label}”`)
  const data = {
    event_id: eventId(), title: body, body, viewport_width: innerWidth, viewport_height: innerHeight,
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
  let quotaEnded = false
  try {
    const result = await chrome.runtime.sendMessage({ type: 'STEP_EVENT', data, snapshot })
    if (result?.quotaEnded) { quotaEnded = true; clearBlockedClick(); return }
    if (result?.error) throw new Error(result.error)
    if (typeof result?.steps === 'number') steps = result.steps
  } catch (error) { lastError = `${tr(locale, 'captureFailed')}: ${(error as Error).message}` }
  finally {
    capturing = false; phase = ''; renderHud(); scheduleRefresh()
    if (freezeClick && !quotaEnded) replayClick(target)
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'SHOW_RECORDING_SETUP') { showRecordingSetup(message); sendResponse({ ok: true }); return }
  if (message.type === 'RECORDING_QUOTA_ENDED') { showQuotaEnded(message); sendResponse({ ok: true }); return }
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
        event_id: eventId(), title: tr(contentLocale, 'flowComplete'), body: tr(contentLocale, 'flowCompleteBody'),
        viewport_width: innerWidth, viewport_height: innerHeight, page_context: pageContext(), scroll_state: { x: scrollX, y: scrollY },
        password_rects: passwordRects(), capture_warnings: captureWarnings(), duration: 3, terminal: true,
      },
    }); return true
  }
  return undefined
})

chrome.runtime.sendMessage({ type: 'IS_RECORDING' }).then(applyState).catch(() => {})
if (window.top === window && isConfiguredWebPage(window.location.href)) {
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== window.location.origin) return
    const payload = event.data
    if (!payload || payload.source !== 'docflow-web' || !payload.requestId) return
    const type = payload.type === 'DOCFLOW_EXTENSION_CONNECT' ? 'CONNECT_FROM_WEB'
      : payload.type === 'DOCFLOW_EXTENSION_SET_TARGET' ? 'SET_TARGET_FROM_WEB'
        : payload.type === 'DOCFLOW_EXTENSION_PING' ? 'PING_FROM_WEB' : ''
    if (!type) return
    chrome.runtime.sendMessage({ type, code: payload.code, demoId: payload.demoId }).then(result => {
      window.postMessage({ source: 'docflow-extension', requestId: payload.requestId, result }, window.location.origin)
    }).catch(error => {
      window.postMessage({ source: 'docflow-extension', requestId: payload.requestId, error: error.message }, window.location.origin)
    })
  })
}
window.addEventListener('click', suppressBlockedClick, true)
document.addEventListener('pointermove', onPointerMove, true)
document.addEventListener('pointerdown', onPointer, true)
