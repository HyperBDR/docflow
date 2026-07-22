import { browserLocale, tr, type MessageKey } from './locale'
import { configuredApiUrl, configuredWebUrl } from './config'
import type { Credentials, Locale, RecordingMode, RecordingPreferences, RecordingTarget } from './types'

type Space = { id: string; name: string; kind: 'personal' | 'team' }
type ExtensionConfig = { ai_enabled: boolean; default_content_locale: Locale }

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const locale: Locale = browserLocale()
const connect = $('connect'), recorder = $('recorder'), setup = $('setup'), activePanel = $('active-recording'), message = $('message')
const homeView = $('home-view'), settingsView = $('settings-view'), settingsToggle = $<HTMLButtonElement>('settings-toggle')
const interactiveButton = $<HTMLButtonElement>('record-interactive'), videoButton = $<HTMLButtonElement>('record-video'), screenshotButton = $<HTMLButtonElement>('take-screenshot')
const pauseButton = $<HTMLButtonElement>('pause'), attachButton = $<HTMLButtonElement>('attach-tab')
const statusText = $('record-status'), modeText = $('record-mode'), countText = $('step-count'), tabCount = $('tab-count')
let timer: number | undefined
let settingsOpen = false
let spaces: Space[] = []
let pendingTarget: RecordingTarget | undefined
let activeOrganizationId = ''
let extensionConfig: ExtensionConfig = { ai_enabled: false, default_content_locale: locale }
let recordingPreferences: RecordingPreferences = {}

function applyTranslations() {
  document.documentElement.lang = locale
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(element => { element.textContent = tr(locale, element.dataset.i18n as MessageKey) })
  document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach(element => {
    const title = tr(locale, element.dataset.i18nTitle as MessageKey)
    element.title = title
    element.setAttribute('aria-label', title)
  })
}

function showSettings(open: boolean) {
  settingsOpen = open && !recorder.hidden
  homeView.hidden = settingsOpen
  settingsView.hidden = !settingsOpen
  settingsToggle.classList.toggle('active', settingsOpen)
}

async function credentials(): Promise<Credentials | undefined> {
  const auth = (await chrome.storage.local.get('credentials')).credentials as Credentials | undefined
  if (!auth) return undefined
  if (auth.api.replace(/\/$/, '') === configuredApiUrl && String(auth.web || '').replace(/\/$/, '') === configuredWebUrl) return auth
  await chrome.storage.local.remove(['credentials', 'pendingTarget', 'activeOrganizationId'])
  return undefined
}

async function authorizedFetch(auth: Credentials, path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers)
  headers.set('Authorization', `Bearer ${auth.token}`)
  const response = await fetch(`${auth.api}${path}`, { ...options, headers })
  if (response.status === 401) {
    await chrome.storage.local.remove(['credentials', 'pendingTarget'])
    throw new Error(tr(locale, 'connectionExpired'))
  }
  if (!response.ok) throw new Error(tr(locale, 'serviceUnavailable'))
  return response
}

function renderState(state: any) {
  const isActive = Boolean(state?.active && Number(state?.trackedTabs || 0) > 0)
  setup.hidden = isActive
  activePanel.hidden = !isActive
  if (!isActive) return
  activePanel.querySelector('.recording-summary')?.classList.toggle('paused', Boolean(state.paused))
  activePanel.querySelector('.recording-summary')?.classList.toggle('capturing', Boolean(state.capturing))
  statusText.textContent = state.capturing ? tr(locale, 'capturing') : state.paused ? tr(locale, 'paused') : tr(locale, 'recording')
  modeText.textContent = state.capturing ? tr(locale, 'uploading') : `${state.mode === 'screenshot' ? tr(locale, 'screenshotMode') : tr(locale, 'htmlMode')}${state.aiEnabled ? ' · AI' : ''}`
  countText.textContent = `${Number(state.steps || 0)} ${tr(locale, 'steps')}`
  tabCount.textContent = tr(locale, 'linkedTabs', { count: Number(state.trackedTabs || 1) })
  pauseButton.textContent = state.paused ? tr(locale, 'resume') : tr(locale, 'pause')
  pauseButton.disabled = Boolean(state.capturing)
  $<HTMLButtonElement>('stop').disabled = Boolean(state.capturing)
  $<HTMLButtonElement>('cancel-recording').disabled = Boolean(state.capturing)
  attachButton.hidden = Boolean(state.currentTabTracked)
}

function avatar(name: string, email: string) {
  const source = (name || email.split('@')[0] || 'DF').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const parts = source.split(/\s+/).filter(Boolean)
  return (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)![0]}` : source.slice(0, 2)).toUpperCase()
}

async function refresh() {
  const auth = await credentials()
  connect.hidden = Boolean(auth)
  recorder.hidden = !auth
  if (!auth) {
    showSettings(false)
    message.textContent = ''
    window.clearInterval(timer)
    return
  }
  try {
    const [spaceResponse, meResponse, configResponse, stored] = await Promise.all([
      authorizedFetch(auth, '/api/organizations'),
      authorizedFetch(auth, '/api/auth/me'),
      authorizedFetch(auth, '/api/extension/config'),
      chrome.storage.local.get(['activeOrganizationId', 'pendingTarget', 'recordingPreferences']),
    ])
    spaces = await spaceResponse.json()
    const me = await meResponse.json()
    extensionConfig = await configResponse.json()
    pendingTarget = stored.pendingTarget as RecordingTarget | undefined
    recordingPreferences = (stored.recordingPreferences as RecordingPreferences | undefined) || {}
    if (pendingTarget && !spaces.some(item => item.id === pendingTarget?.organizationId)) {
      pendingTarget = undefined
      await chrome.storage.local.remove('pendingTarget')
    }
    $('user-name').textContent = me.name || me.email.split('@')[0]
    $('user-email').textContent = me.email
    $('user-avatar').textContent = avatar(me.name, me.email)
    $('footer-user-name').textContent = me.name || me.email.split('@')[0]
    $('extension-version').textContent = `v${chrome.runtime.getManifest().version}`
    activeOrganizationId = pendingTarget?.organizationId
      || (spaces.some(item => item.id === stored.activeOrganizationId) ? stored.activeOrganizationId : '')
      || me.active_organization_id || me.current_organization_id || spaces[0]?.id
    renderState(await chrome.runtime.sendMessage({ type: 'STATUS' }))
    message.textContent = ''
  } catch (error) {
    message.textContent = (error as Error).message
    if (!(await credentials())) { connect.hidden = false; recorder.hidden = true }
  }
}

$('open-connect').addEventListener('click', () => chrome.tabs.create({ url: `${configuredWebUrl}/extension/connect?source=extension` }))
$('home-link').addEventListener('click', () => chrome.tabs.create({ url: configuredWebUrl }))
settingsToggle.addEventListener('click', () => showSettings(!settingsOpen))
$('settings-back').addEventListener('click', () => showSettings(false))

async function openRecordingSetup(mode: RecordingMode, button: HTMLButtonElement) {
  button.disabled = true
  message.textContent = ''
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    const result = await chrome.runtime.sendMessage({
      type: 'OPEN_SETUP', tabId: tab?.id, demoId: pendingTarget?.demoId,
      aiAvailable: extensionConfig.ai_enabled, defaultMode: mode,
      defaultAI: recordingPreferences.aiEnabled ?? extensionConfig.ai_enabled,
      spaces, organizationId: activeOrganizationId,
      lockOrganization: Boolean(pendingTarget), locale,
      contentLocale: pendingTarget?.contentLocale || recordingPreferences.contentLocale || extensionConfig.default_content_locale || locale,
      aiContext: pendingTarget?.aiContext || '',
    })
    if (result?.error) throw new Error(result.error)
    message.textContent = tr(locale, 'setupOpened')
    window.setTimeout(() => window.close(), 250)
  } catch (error) {
    message.textContent = (error as Error).message
    button.disabled = false
  }
}

interactiveButton.addEventListener('click', () => openRecordingSetup('html', interactiveButton))
videoButton.addEventListener('click', () => { message.textContent = tr(locale, 'videoComingSoon') })
screenshotButton.addEventListener('click', () => { message.textContent = tr(locale, 'screenshotComingSoon') })

pauseButton.addEventListener('click', async () => { renderState(await chrome.runtime.sendMessage({ type: 'PAUSE' })) })
attachButton.addEventListener('click', async () => {
  const result = await chrome.runtime.sendMessage({ type: 'ATTACH_CURRENT_TAB' })
  if (result?.error) message.textContent = result.error
  else renderState(await chrome.runtime.sendMessage({ type: 'STATUS' }))
})
$('stop').addEventListener('click', async () => {
  statusText.textContent = tr(locale, 'finishing')
  const result = await chrome.runtime.sendMessage({ type: 'STOP' })
  if (result?.error) { message.textContent = result.error; await refresh(); return }
  await refresh()
})
$('cancel-recording').addEventListener('click', async () => {
  const state = await chrome.runtime.sendMessage({ type: 'STATUS' })
  if (!window.confirm(tr(locale, 'cancelRecordingConfirm', { count: Number(state?.steps || 0) }))) return
  const button = $<HTMLButtonElement>('cancel-recording')
  button.disabled = true
  const result = await chrome.runtime.sendMessage({ type: 'CANCEL' })
  if (result?.error) { message.textContent = result.error; button.disabled = false; return }
  await refresh()
})
$('disconnect').addEventListener('click', async () => {
  if (!window.confirm(tr(locale, 'disconnectConfirm'))) return
  const button = $<HTMLButtonElement>('disconnect')
  button.disabled = true
  button.textContent = tr(locale, 'disconnecting')
  message.textContent = ''
  const auth = await credentials()
  try {
    await chrome.runtime.sendMessage({ type: 'STOP', open: false })
    if (auth) await authorizedFetch(auth, '/api/extension/tokens', { method: 'DELETE' }).catch(() => undefined)
    await chrome.storage.local.remove(['credentials', 'pendingTarget', 'activeOrganizationId', 'recordingPreferences'])
    showSettings(false)
    await refresh()
  } finally {
    button.disabled = false
    button.textContent = tr(locale, 'disconnect')
  }
})
$('reset-tutorial').addEventListener('click', async () => {
  await chrome.storage.local.remove('recordingTutorialSeen')
  message.textContent = tr(locale, 'guideReset')
})

async function initialize() {
  applyTranslations()
  showSettings(false)
  await refresh()
  timer = window.setInterval(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'STATUS' }).catch(() => null)
    if (state) renderState(state)
  }, 700)
}

void initialize()
