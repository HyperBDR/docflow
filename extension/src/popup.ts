import type { Credentials } from './types'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const connect = $('connect'), recorder = $('recorder'), message = $('message')
const apiInput = $<HTMLInputElement>('api'), codeInput = $<HTMLInputElement>('code'), demoSelect = $<HTMLSelectElement>('demo')
const startButton = $<HTMLButtonElement>('start'), stopButton = $<HTMLButtonElement>('stop')

async function credentials(): Promise<Credentials | undefined> {
  return (await chrome.storage.local.get('credentials')).credentials as Credentials | undefined
}

async function refresh() {
  const auth = await credentials()
  connect.hidden = Boolean(auth); recorder.hidden = !auth
  if (!auth) return
  const response = await fetch(`${auth.api}/api/demos`, { headers: { Authorization: `Bearer ${auth.token}` } })
  if (!response.ok) { message.textContent = '连接已失效，请重新配对。'; await chrome.storage.local.remove('credentials'); return refresh() }
  const demos = await response.json()
  demoSelect.innerHTML = demos.map((demo: { id: string; title: string }) => `<option value="${demo.id}">${demo.title}</option>`).join('')
  const state = await chrome.runtime.sendMessage({ type: 'STATUS' })
  startButton.hidden = Boolean(state?.active); stopButton.hidden = !state?.active
  if (!demos.length) message.textContent = '请先在 DocFlow 网页中创建演示。'
}

$('pair').addEventListener('click', async () => {
  message.textContent = ''
  const api = apiInput.value.replace(/\/$/, '')
  try {
    const response = await fetch(`${api}/api/extension/pair/exchange`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: codeInput.value }) })
    if (!response.ok) throw new Error('配对码无效或已过期')
    const result = await response.json()
    await chrome.storage.local.set({ credentials: { api, token: result.token } })
    await refresh()
  } catch (error) { message.textContent = (error as Error).message }
})

startButton.addEventListener('click', async () => {
  if (!demoSelect.value) return
  const result = await chrome.runtime.sendMessage({ type: 'START', demoId: demoSelect.value })
  message.textContent = result?.error || '录制已开始，请在页面中进行操作。'
  await refresh()
})
stopButton.addEventListener('click', async () => { await chrome.runtime.sendMessage({ type: 'STOP' }); await refresh() })
$('disconnect').addEventListener('click', async () => { await chrome.runtime.sendMessage({ type: 'STOP', open: false }); await chrome.storage.local.remove('credentials'); await refresh() })
refresh()
