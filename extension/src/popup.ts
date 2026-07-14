import type { Credentials, RecordingMode } from './types'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const connect = $('connect'), recorder = $('recorder'), setup = $('setup'), activePanel = $('active-recording'), message = $('message')
const apiInput = $<HTMLInputElement>('api'), codeInput = $<HTMLInputElement>('code'), demoSelect = $<HTMLSelectElement>('demo')
const startButton = $<HTMLButtonElement>('start'), pauseButton = $<HTMLButtonElement>('pause')
const statusText = $('record-status'), modeText = $('record-mode'), countText = $('step-count')
let timer: number | undefined

async function credentials(): Promise<Credentials | undefined> {
  return (await chrome.storage.local.get('credentials')).credentials as Credentials | undefined
}

function renderState(state: any) {
  const isActive = Boolean(state?.active)
  setup.hidden = isActive; activePanel.hidden = !isActive
  if (!isActive) return
  activePanel.querySelector('.recording-summary')?.classList.toggle('paused', Boolean(state.paused))
  activePanel.querySelector('.recording-summary')?.classList.toggle('capturing', Boolean(state.capturing))
  statusText.textContent = state.capturing ? 'Capturing, please wait…' : state.paused ? 'Recording Paused' : 'Recording'
  modeText.textContent = state.capturing
    ? '正在上传 HTML、CSS 和截图'
    : state.mode === 'screenshot' ? 'Screenshot Mode' : 'HTML Cloning Mode'
  const count = Number(state.steps || 0)
  countText.textContent = `${count} ${count === 1 ? 'Step' : 'Steps'}`
  pauseButton.textContent = state.paused ? 'Resume' : 'Pause'
}

async function refresh() {
  const auth = await credentials()
  connect.hidden = Boolean(auth); recorder.hidden = !auth
  if (!auth) { window.clearInterval(timer); return }
  const response = await fetch(`${auth.api}/api/demos`, { headers: { Authorization: `Bearer ${auth.token}` } })
  if (!response.ok) { message.textContent = '连接已失效，请重新配对。'; await chrome.storage.local.remove('credentials'); return refresh() }
  const demos = await response.json() as { id: string; title: string }[]
  const current = demoSelect.value
  demoSelect.replaceChildren(...demos.map(demo => { const option = document.createElement('option'); option.value = demo.id; option.textContent = demo.title; return option }))
  if (demos.some(item => item.id === current)) demoSelect.value = current
  renderState(await chrome.runtime.sendMessage({ type: 'STATUS' }))
  if (!demos.length) message.textContent = '请先在 DocFlow 网页中创建演示。'
}

$('pair').addEventListener('click', async () => {
  message.textContent = ''
  const api = apiInput.value.replace(/\/$/, '')
  try {
    const response = await fetch(`${api}/api/extension/pair/exchange`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: codeInput.value }) })
    if (!response.ok) throw new Error('配对码无效或已过期')
    const result = await response.json()
    await chrome.storage.local.set({ credentials: { api, token: result.token, web: result.web_url } })
    await refresh()
  } catch (error) { message.textContent = (error as Error).message }
})

startButton.addEventListener('click', async () => {
  if (!demoSelect.value) return
  const selected = document.querySelector<HTMLInputElement>('input[name="mode"]:checked')
  const mode = (selected?.value || 'html') as RecordingMode
  const result = await chrome.runtime.sendMessage({ type: 'START', demoId: demoSelect.value, mode })
  message.textContent = result?.error || (mode === 'html' ? 'HTML Cloning 已开始：移动鼠标选择元素并点击。' : '截图录制已开始。')
  await refresh()
})

pauseButton.addEventListener('click', async () => { renderState(await chrome.runtime.sendMessage({ type: 'PAUSE' })) })
$('stop').addEventListener('click', async () => { statusText.textContent = 'Finishing…'; await chrome.runtime.sendMessage({ type: 'STOP' }); await refresh() })
$('disconnect').addEventListener('click', async () => { await chrome.runtime.sendMessage({ type: 'STOP', open: false }); await chrome.storage.local.remove('credentials'); await refresh() })

refresh()
timer = window.setInterval(async () => {
  const state = await chrome.runtime.sendMessage({ type: 'STATUS' }).catch(() => null)
  if (state) renderState(state)
}, 700)
