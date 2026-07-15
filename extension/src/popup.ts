import { browserLocale, tr, type MessageKey } from './locale'
import type { Credentials, Locale } from './types'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
let locale: Locale = browserLocale()
const connect = $('connect'), recorder = $('recorder'), setup = $('setup'), activePanel = $('active-recording'), message = $('message')
const apiInput = $<HTMLInputElement>('api'), codeInput = $<HTMLInputElement>('code'), demoSelect = $<HTMLSelectElement>('demo')
const startButton = $<HTMLButtonElement>('start'), pauseButton = $<HTMLButtonElement>('pause')
const statusText = $('record-status'), modeText = $('record-mode'), countText = $('step-count')
let timer: number | undefined
let demos: { id: string; title: string; ai_enabled: boolean; content_locale: Locale }[] = []

function applyTranslations() {
  document.documentElement.lang = locale
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(element => {
    element.textContent = tr(locale, element.dataset.i18n as MessageKey)
  })
  $<HTMLSelectElement>('locale').value = locale
}

async function credentials(): Promise<Credentials | undefined> {
  return (await chrome.storage.local.get('credentials')).credentials as Credentials | undefined
}

function renderState(state: any) {
  const isActive = Boolean(state?.active)
  setup.hidden = isActive; activePanel.hidden = !isActive
  if (!isActive) return
  activePanel.querySelector('.recording-summary')?.classList.toggle('paused', Boolean(state.paused))
  activePanel.querySelector('.recording-summary')?.classList.toggle('capturing', Boolean(state.capturing))
  statusText.textContent = state.capturing ? tr(locale, 'capturing') : state.paused ? tr(locale, 'paused') : tr(locale, 'recording')
  modeText.textContent = state.capturing ? tr(locale, 'uploading') : `${state.mode === 'screenshot' ? tr(locale, 'screenshotMode') : tr(locale, 'htmlMode')}${state.aiEnabled ? ' · AI' : ''}`
  countText.textContent = `${Number(state.steps || 0)} ${tr(locale, 'steps')}`
  pauseButton.textContent = state.paused ? tr(locale, 'resume') : tr(locale, 'pause')
}

async function refresh() {
  const auth = await credentials()
  connect.hidden = Boolean(auth); recorder.hidden = !auth
  if (!auth) { window.clearInterval(timer); return }
  const response = await fetch(`${auth.api}/api/demos`, { headers: { Authorization: `Bearer ${auth.token}` } })
  if (!response.ok) { message.textContent = tr(locale, 'connectionExpired'); await chrome.storage.local.remove('credentials'); return refresh() }
  demos = await response.json()
  const current = demoSelect.value
  demoSelect.replaceChildren(...demos.map(demo => { const option = document.createElement('option'); option.value = demo.id; option.textContent = demo.title; return option }))
  if (demos.some(item => item.id === current)) demoSelect.value = current
  renderState(await chrome.runtime.sendMessage({ type: 'STATUS' }))
  if (!demos.length) message.textContent = tr(locale, 'createDemoFirst')
}

$('pair').addEventListener('click', async () => {
  message.textContent = ''
  const api = apiInput.value.replace(/\/$/, '')
  try {
    const response = await fetch(`${api}/api/extension/pair/exchange`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: codeInput.value }) })
    if (!response.ok) throw new Error(tr(locale, 'invalidCode'))
    const result = await response.json()
    await chrome.storage.local.set({ credentials: { api, token: result.token, web: result.web_url } })
    await refresh()
  } catch (error) { message.textContent = (error as Error).message }
})

startButton.addEventListener('click', async () => {
  const selected = demos.find(item => item.id === demoSelect.value)
  if (!selected) return
  const result = await chrome.runtime.sendMessage({ type: 'OPEN_SETUP', demoId: selected.id, aiAvailable: selected.ai_enabled, locale, contentLocale: selected.content_locale || locale })
  if (result?.error) { message.textContent = result.error; return }
  message.textContent = tr(locale, 'setupOpened')
  window.setTimeout(() => window.close(), 250)
})

pauseButton.addEventListener('click', async () => { renderState(await chrome.runtime.sendMessage({ type: 'PAUSE' })) })
$('stop').addEventListener('click', async () => { statusText.textContent = tr(locale, 'finishing'); await chrome.runtime.sendMessage({ type: 'STOP' }); await refresh() })
$('disconnect').addEventListener('click', async () => { await chrome.runtime.sendMessage({ type: 'STOP', open: false }); await chrome.storage.local.remove('credentials'); await refresh() })
$<HTMLSelectElement>('locale').addEventListener('change', async event => {
  locale = (event.currentTarget as HTMLSelectElement).value as Locale
  await chrome.storage.local.set({ uiLocale: locale })
  applyTranslations()
  renderState(await chrome.runtime.sendMessage({ type: 'STATUS' }))
})

async function initialize() {
  const saved = (await chrome.storage.local.get('uiLocale')).uiLocale as Locale | undefined
  locale = saved || browserLocale()
  applyTranslations()
  await refresh()
  timer = window.setInterval(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'STATUS' }).catch(() => null)
    if (state) renderState(state)
  }, 700)
}

void initialize()
