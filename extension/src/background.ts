import type { Credentials, Recording, RecordingMode } from './types'
import { browserLocale } from './locale'

type SavedRecording = Omit<Recording, 'screenshot'>
let recording: Recording | null = null
let queue: Promise<void> = Promise.resolve()

async function savedRecording(): Promise<SavedRecording | undefined> {
  return (await chrome.storage.session.get('recording')).recording as SavedRecording | undefined
}

function savedState(state: Recording): SavedRecording {
  const { screenshot: _screenshot, ...saved } = state
  return saved
}

async function persist(state: Recording) {
  await chrome.storage.session.set({ recording: savedState(state) })
}

async function capture(tabId: number): Promise<string> {
  const tab = await chrome.tabs.get(tabId)
  if (tab.windowId === undefined) throw new Error('找不到录制窗口')
  return chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' })
}

async function captureClean(tabId: number): Promise<string> {
  try { await chrome.tabs.sendMessage(tabId, { type: 'RECORDER_UI_VISIBILITY', hidden: true }) } catch { /* restricted page */ }
  try { return await capture(tabId) }
  finally { try { await chrome.tabs.sendMessage(tabId, { type: 'RECORDER_UI_VISIBILITY', hidden: false }) } catch { /* page may navigate */ } }
}

async function notify(state: Recording | null) {
  if (!state) return
  try {
    await chrome.tabs.sendMessage(state.tabId, {
      type: 'RECORDING_STATE', active: state.active, paused: state.paused,
      capturing: state.capturing, phase: state.phase, steps: state.steps, mode: state.mode,
      aiEnabled: state.aiEnabled, locale: state.locale,
    })
  } catch { /* restricted or navigating page */ }
  const badge = !state.active ? '' : state.capturing ? '…' : state.paused ? 'Ⅱ' : state.steps ? (state.steps > 99 ? '99+' : String(state.steps)) : 'REC'
  await chrome.action.setBadgeText({ tabId: state.tabId, text: badge })
  await chrome.action.setBadgeBackgroundColor({ tabId: state.tabId, color: state.paused ? '#f59e0b' : state.capturing ? '#7c3aed' : '#e53945' })
  await chrome.action.setTitle({ tabId: state.tabId, title: state.active ? `${state.steps} Steps Recorded · ${state.mode === 'html' ? 'HTML Cloning' : 'Screenshot'}` : 'DocFlow Recorder' })
}

async function begin(demoId: string, mode: RecordingMode = 'html', aiEnabled = false, sourceTabId?: number) {
  const auth = (await chrome.storage.local.get('credentials')).credentials as Credentials | undefined
  const tab = sourceTabId ? await chrome.tabs.get(sourceTabId) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
  if (!auth || !tab.id || !tab.url?.startsWith('http')) throw new Error('请打开可录制的网页并确认扩展已连接')
  recording = {
    tabId: tab.id, demoId, api: auth.api, token: auth.token,
    screenshot: await capture(tab.id), active: true, paused: false,
    capturing: false, phase: '', steps: 0, mode, aiEnabled, locale: browserLocale(),
  }
  await persist(recording)
  await notify(recording)
}

async function restore(): Promise<Recording | null> {
  if (recording) return recording
  const saved = await savedRecording()
  if (!saved) return null
  try {
    recording = {
      ...saved, screenshot: await captureClean(saved.tabId),
      paused: Boolean(saved.paused), capturing: false,
      phase: '',
      steps: Number(saved.steps || 0), mode: saved.mode || 'html',
      aiEnabled: Boolean(saved.aiEnabled), locale: saved.locale || browserLocale(),
    }
    return recording
  } catch { await chrome.storage.session.remove('recording'); return null }
}

async function gzipJson(value: unknown): Promise<Blob> {
  const stream = new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Blob([await new Response(stream).arrayBuffer()], { type: 'application/gzip' })
}

function visitNodes(value: unknown, visit: (node: Record<string, any>) => void) {
  if (!value || typeof value !== 'object') return
  const node = value as Record<string, any>
  if (typeof node.type === 'number') visit(node)
  if (Array.isArray(node.childNodes)) node.childNodes.forEach(child => visitNodes(child, visit))
}

async function responseDataUrl(response: Response, maxBytes: number): Promise<string | null> {
  const contentType = response.headers.get('content-type')?.split(';')[0] || ''
  const allowed = contentType.startsWith('image/') || contentType.startsWith('font/') || contentType.includes('font')
  if (!response.ok || !allowed) return null
  const data = await response.arrayBuffer()
  if (data.byteLength > maxBytes) return null
  const bytes = new Uint8Array(data)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return `data:${contentType};base64,${btoa(binary)}`
}

async function inlineCssAssets(css: string, stylesheetUrl: string, budget: { remaining: number }) {
  const matches = [...css.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)]
  const replacements = new Map<string, string>()
  for (const match of matches.slice(0, 40)) {
    const raw = match[2].trim()
    if (!raw || raw.startsWith('data:') || raw.startsWith('#') || replacements.has(raw) || budget.remaining <= 0) continue
    try {
      const url = new URL(raw, stylesheetUrl).href
      const response = await fetch(url, { credentials: 'include' })
      const dataUrl = await responseDataUrl(response, Math.min(1_500_000, budget.remaining))
      if (dataUrl) { replacements.set(raw, dataUrl); budget.remaining -= Math.ceil(dataUrl.length * .75) }
    } catch { /* inaccessible resource remains a safe empty URL after server sanitization */ }
  }
  for (const [raw, dataUrl] of replacements) css = css.split(raw).join(dataUrl)
  return css
}

async function inlineCssImports(
  css: string,
  stylesheetUrl: string,
  budget: { remaining: number },
  seen = new Set<string>(),
  depth = 0,
) {
  if (depth >= 3 || budget.remaining <= 0) return css
  const imports = [...css.matchAll(/@import\s+(?:url\(\s*)?(['"]?)([^'"\)\s;]+)\1\s*\)?\s*([^;]*);/gi)].slice(0, 12)
  for (const match of imports) {
    const original = match[0], raw = match[2].trim(), media = match[3].trim()
    if (!raw || raw.startsWith('data:')) continue
    try {
      const url = new URL(raw, stylesheetUrl).href
      if (seen.has(url)) { css = css.replace(original, ''); continue }
      seen.add(url)
      const response = await fetch(url, { credentials: 'include' })
      if (!response.ok) continue
      let imported = await response.text()
      const bytes = new TextEncoder().encode(imported).byteLength
      if (bytes > 1_500_000 || bytes > budget.remaining) continue
      budget.remaining -= bytes
      imported = await inlineCssImports(imported, url, budget, seen, depth + 1)
      imported = await inlineCssAssets(imported, url, budget)
      css = css.replace(original, media ? `@media ${media}{${imported}}` : imported)
    } catch { /* the server removes an unresolved @import safely */ }
  }
  return css
}

async function enrichSnapshot(snapshot: Record<string, any> | undefined, pageUrl: string): Promise<Record<string, any> | undefined> {
  if (!snapshot?.snapshot) return snapshot
  const nodes: Record<string, any>[] = []
  visitNodes(snapshot.snapshot, node => nodes.push(node))
  const budget = { remaining: 8 * 1024 * 1024 }

  for (const node of nodes.filter(item => item.type === 2 && String(item.tagName).toLowerCase() === 'link').slice(0, 20)) {
    const attrs = node.attributes || {}
    if (!String(attrs.rel || '').toLowerCase().includes('stylesheet') || !attrs.href) continue
    try {
      const url = new URL(String(attrs.href), pageUrl).href
      const response = await fetch(url, { credentials: 'include' })
      if (!response.ok) continue
      let css = await response.text()
      if (css.length > 2_000_000) continue
      css = await inlineCssImports(css, url, budget, new Set([url]))
      css = await inlineCssAssets(css, url, budget)
      node.attributes = { ...attrs, href: '', _cssText: css }
      delete node.attributes.integrity
      delete node.attributes.crossorigin
    } catch { /* screenshot remains the visual fallback */ }
  }

  for (const node of nodes.filter(item => item.type === 2 && String(item.tagName).toLowerCase() === 'img').slice(0, 60)) {
    const attrs = node.attributes || {}
    if (!attrs.src || String(attrs.src).startsWith('data:') || attrs.rr_dataURL || budget.remaining <= 0) continue
    try {
      const response = await fetch(new URL(String(attrs.src), pageUrl).href, { credentials: 'include' })
      const dataUrl = await responseDataUrl(response, Math.min(2_000_000, budget.remaining))
      if (dataUrl) { attrs.rr_dataURL = dataUrl; budget.remaining -= Math.ceil(dataUrl.length * .75) }
    } catch { /* screenshot remains the visual fallback */ }
  }
  return snapshot
}

async function uploadStep(data: Record<string, any>, domSnapshot: Record<string, any> | undefined, screenshotOverride: string | undefined, state: Recording): Promise<{ id: string }> {
  if (!state.active || !state.screenshot) throw new Error('录制状态已结束')
  const response = await fetch(screenshotOverride || state.screenshot)
  const form = new FormData()
  form.append('meta', JSON.stringify({ ...data, ai_enabled: state.aiEnabled }))
  form.append('screenshot', await response.blob(), 'step.png')
  if (domSnapshot) form.append('snapshot', await gzipJson(domSnapshot), 'snapshot.json.gz')
  const upload = await fetch(`${state.api}/api/recordings/${state.demoId}/slides`, { method: 'POST', headers: { Authorization: `Bearer ${state.token}` }, body: form })
  if (!upload.ok) {
    const error = await upload.json().catch(() => ({ detail: '上传失败' }))
    await chrome.action.setBadgeText({ tabId: state.tabId, text: '!' })
    throw new Error(error.detail)
  }
  return upload.json() as Promise<{ id: string }>
}

async function recordStep(data: Record<string, any>, snapshot: Record<string, any> | undefined, state: Recording, screenshotOverride?: string) {
  state.phase = 'uploading'; await persist(state); await notify(state)
  const pageUrl = String(data.page_context?.url || '')
  const enriched = state.mode === 'html' ? await enrichSnapshot(snapshot, pageUrl) : undefined
  await uploadStep(data, enriched, screenshotOverride, state)
  if (recording === state && state.active) {
    try { state.screenshot = await captureClean(state.tabId) } catch { /* page may be navigating */ }
    state.steps += 1
    state.capturing = false
    state.phase = ''
    await persist(state); await notify(state)
  }
}

async function pause() {
  const state = await restore()
  if (!state?.active) return null
  await queue
  state.paused = !state.paused
  state.capturing = false
  state.phase = ''
  await persist(state); await notify(state)
  return state
}

async function stop(open = true) {
  const state = await restore()
  if (!state) { await chrome.storage.session.remove('recording'); return }
  await queue.catch(() => {})
  state.paused = false; state.capturing = true; state.phase = 'uploading'
  await notify(state)
  try {
    const final = await chrome.tabs.sendMessage(state.tabId, { type: 'CAPTURE_FINAL' })
    if (final?.data) await uploadStep(final.data, state.mode === 'html' ? final.snapshot : undefined, await captureClean(state.tabId), state)
  } catch (error) { console.warn('DocFlow final slide:', error) }
  if (state.aiEnabled) {
    try {
      await fetch(`${state.api}/api/demos/${state.demoId}/ai/generate`, { method: 'POST', headers: { Authorization: `Bearer ${state.token}` } })
    } catch { /* AI is optional */ }
  }
  state.active = false; state.capturing = false; state.phase = ''
  await notify(state)
  recording = null
  await chrome.storage.session.remove('recording')
  if (open) {
    const auth = (await chrome.storage.local.get('credentials')).credentials as Credentials | undefined
    const apiUrl = new URL(state.api)
    const webOrigin = auth?.web || `${apiUrl.protocol}//${apiUrl.hostname}:5173`
    await chrome.tabs.create({ url: `${webOrigin}/demos/${state.demoId}` })
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  ;(async () => {
    if (message.type === 'OPEN_SETUP') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id || !tab.url?.startsWith('http')) throw new Error('Please open a recordable web page first.')
      await chrome.tabs.sendMessage(tab.id, { type: 'SHOW_RECORDING_SETUP', demoId: message.demoId, aiAvailable: Boolean(message.aiAvailable), locale: browserLocale() })
      return { ok: true }
    }
    if (message.type === 'START') { await begin(message.demoId, message.mode, Boolean(message.aiEnabled), sender.tab?.id); return { ok: true } }
    if (message.type === 'PAUSE') { const state = await pause(); return state ? { active: true, paused: state.paused, steps: state.steps, mode: state.mode } : { active: false } }
    if (message.type === 'STOP') { await stop(message.open !== false); return { ok: true } }
    if (message.type === 'STATUS') { const state = await restore(); return state ? { active: state.active, paused: state.paused, capturing: state.capturing, phase: state.phase, steps: state.steps, demoId: state.demoId, mode: state.mode, aiEnabled: state.aiEnabled, locale: state.locale } : { active: false, steps: 0 } }
    if (message.type === 'IS_RECORDING') {
      const state = await restore()
      return state?.active && state.tabId === sender.tab?.id
        ? { active: true, paused: state.paused, capturing: state.capturing, phase: state.phase, steps: state.steps, mode: state.mode, aiEnabled: state.aiEnabled, locale: state.locale }
        : { active: false }
    }
    if (message.type === 'MANUAL_STEP' && sender.tab?.id) {
      const state = await restore()
      if (!state || state.tabId !== sender.tab.id || !state.active || state.paused || state.capturing) return { ignored: true, steps: state?.steps || 0 }
      state.capturing = true; state.phase = 'uploading'
      await persist(state); await notify(state)
      const screenshot = await captureClean(state.tabId)
      const task = queue.then(() => recordStep(message.data, message.snapshot, state, screenshot))
      queue = task.catch(() => {})
      try { await task; return { accepted: true, steps: state.steps } }
      catch (error) {
        state.capturing = false; state.phase = ''; await persist(state); await notify(state)
        throw error
      }
    }
    if (message.type === 'STEP_EVENT' && sender.tab?.id) {
      const state = await restore()
      if (!state || state.tabId !== sender.tab.id || !state.active || state.paused || state.capturing) return { ignored: true, steps: state?.steps || 0 }
      state.capturing = true
      state.phase = 'uploading'
      await persist(state); await notify(state)
      const task = queue.then(() => recordStep(message.data, message.snapshot, state))
      queue = task.catch(() => {})
      try { await task; return { accepted: true, steps: state.steps } }
      catch (error) {
        state.capturing = false; state.phase = ''; await persist(state); await notify(state)
        throw error
      }
    }
    return undefined
  })().then(sendResponse).catch(error => sendResponse({ error: error.message }))
  return true
})

chrome.tabs.onUpdated.addListener(async (tabId, change) => {
  const state = await restore()
  if (state?.active && state.tabId === tabId && change.status === 'complete') {
    await new Promise(resolve => setTimeout(resolve, 650))
    try { state.screenshot = await captureClean(tabId); await notify(state) } catch { /* restricted page */ }
  }
})

chrome.tabs.onRemoved.addListener(tabId => { if (recording?.tabId === tabId) stop(false) })
