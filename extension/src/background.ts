import type { Credentials, Recording } from './types'

type SavedRecording = Omit<Recording, 'screenshot'>
let recording: Recording | null = null
let queue = Promise.resolve()

async function savedRecording(): Promise<SavedRecording | undefined> {
  return (await chrome.storage.session.get('recording')).recording as SavedRecording | undefined
}

async function capture(tabId: number): Promise<string> {
  const tab = await chrome.tabs.get(tabId)
  if (tab.windowId === undefined) throw new Error('找不到录制窗口')
  return chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' })
}

async function notify(tabId: number, active: boolean) {
  try { await chrome.tabs.sendMessage(tabId, { type: 'RECORDING_STATE', active }) } catch { /* restricted page */ }
  await chrome.action.setBadgeText({ tabId, text: active ? 'REC' : '' })
  if (active) await chrome.action.setBadgeBackgroundColor({ tabId, color: '#e53945' })
}

async function begin(demoId: string) {
  const auth = (await chrome.storage.local.get('credentials')).credentials as Credentials | undefined
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!auth || !tab.id || !tab.url?.startsWith('http')) throw new Error('请打开可录制的网页并确认扩展已连接')
  recording = { tabId: tab.id, demoId, api: auth.api, token: auth.token, screenshot: await capture(tab.id), active: true }
  const saved: SavedRecording = { tabId: tab.id, demoId, api: auth.api, token: auth.token, active: true }
  await chrome.storage.session.set({ recording: saved })
  await notify(tab.id, true)
}

async function stop(open = true) {
  if (!recording) {
    const saved = await savedRecording()
    if (saved) recording = { ...saved, screenshot: '' }
  }
  const previous = recording
  recording = null
  await chrome.storage.session.remove('recording')
  if (previous) {
    await notify(previous.tabId, false)
    if (open) {
      const apiUrl = new URL(previous.api)
      const webOrigin = apiUrl.port === '8000' ? `${apiUrl.protocol}//${apiUrl.hostname}:5173` : apiUrl.origin
      await chrome.tabs.create({ url: `${webOrigin}/demos/${previous.demoId}` })
    }
  }
}

async function restore(): Promise<Recording | null> {
  if (recording) return recording
  const saved = await savedRecording()
  if (!saved) return null
  try { recording = { ...saved, screenshot: await capture(saved.tabId) }; return recording } catch { await chrome.storage.session.remove('recording'); return null }
}

async function uploadStep(data: Record<string, unknown>) {
  const state = await restore()
  if (!state || !state.active || !state.screenshot) return
  const response = await fetch(state.screenshot)
  const form = new FormData()
  form.append('meta', JSON.stringify(data))
  form.append('screenshot', await response.blob(), 'step.png')
  const upload = await fetch(`${state.api}/api/recordings/${state.demoId}/steps`, { method: 'POST', headers: { Authorization: `Bearer ${state.token}` }, body: form })
  if (!upload.ok) {
    const error = await upload.json().catch(() => ({ detail: '上传失败' }))
    await chrome.action.setBadgeText({ tabId: state.tabId, text: '!' })
    throw new Error(error.detail)
  }
  await new Promise(resolve => setTimeout(resolve, 800))
  if (recording?.active) recording.screenshot = await capture(state.tabId)
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  ;(async () => {
    if (message.type === 'START') { await begin(message.demoId); return { ok: true } }
    if (message.type === 'STOP') { await stop(message.open !== false); return { ok: true } }
    if (message.type === 'STATUS') { const state = await restore(); return { active: Boolean(state?.active), demoId: state?.demoId } }
    if (message.type === 'IS_RECORDING') { const state = await restore(); return { active: Boolean(state?.active && state.tabId === sender.tab?.id) } }
    if (message.type === 'STEP_EVENT' && sender.tab?.id) {
      const state = await restore()
      if (state?.tabId === sender.tab.id) queue = queue.then(() => uploadStep(message.data)).catch(error => console.error('DocFlow upload:', error))
      return { accepted: true }
    }
    return undefined
  })().then(sendResponse).catch(error => sendResponse({ error: error.message }))
  return true
})

chrome.tabs.onUpdated.addListener(async (tabId, change) => {
  const state = await restore()
  if (state?.active && state.tabId === tabId && change.status === 'complete') {
    await new Promise(resolve => setTimeout(resolve, 800))
    try { state.screenshot = await capture(tabId); await notify(tabId, true) } catch { /* restricted page */ }
  }
})

chrome.tabs.onRemoved.addListener(tabId => { if (recording?.tabId === tabId) stop(false) })

