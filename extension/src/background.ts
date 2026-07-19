import type { Credentials, Locale, Recording, RecordingMode, RecordingTarget } from './types'
import { browserLocale } from './locale'
import { quotaAllowed, quotaApiError, quotaMessage, quotaMetricMessage, type QuotaAction, type WorkspaceCapabilities, type WorkspaceQuotaSummary } from './quota'
import { configuredApiUrl, configuredWebUrl, isConfiguredWebPage, isRecordableUrl } from './config'

type SavedRecording = Omit<Recording, 'screenshot'>
let recording: Recording | null = null
let queue: Promise<void> = Promise.resolve()
let quotaEnding = false

async function connectedCredentials(): Promise<Credentials | undefined> {
  const auth = (await chrome.storage.local.get('credentials')).credentials as Credentials | undefined
  if (!auth) return undefined
  if (auth.api.replace(/\/$/, '') === configuredApiUrl && String(auth.web || '').replace(/\/$/, '') === configuredWebUrl) return auth
  await chrome.storage.local.remove(['credentials', 'pendingTarget', 'activeOrganizationId'])
  return undefined
}

async function loadCapabilities(auth: Credentials, organizationId = '', demoId = ''): Promise<WorkspaceCapabilities> {
  const params = new URLSearchParams({ ...(organizationId ? { organization_id: organizationId } : {}), ...(demoId ? { demo_id: demoId } : {}) })
  const response = await fetch(`${auth.api}/api/workspace/capabilities?${params}`, { headers: { Authorization: `Bearer ${auth.token}` } })
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Could not check workspace quota' }))
    throw new Error(String(error.detail || 'Could not check workspace quota'))
  }
  return response.json() as Promise<WorkspaceCapabilities>
}

async function loadQuotaSummary(auth: Credentials, organizationId = ''): Promise<WorkspaceQuotaSummary> {
  const params = new URLSearchParams({ ...(organizationId ? { organization_id: organizationId } : {}) })
  const response = await fetch(`${auth.api}/api/workspace/quotas?${params}`, { headers: { Authorization: `Bearer ${auth.token}` } })
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Could not load workspace quota' }))
    throw new Error(String(error.detail || 'Could not load workspace quota'))
  }
  return response.json() as Promise<WorkspaceQuotaSummary>
}

function requireQuota(value: WorkspaceCapabilities, action: QuotaAction, locale: Locale) {
  if (!quotaAllowed(value, action)) throw new Error(quotaMessage(value, action, locale))
}

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

function statePayload(state: Recording, active = true) {
  return {
    type: 'RECORDING_STATE', active, paused: state.paused,
    capturing: state.capturing, phase: state.phase, steps: state.steps, mode: state.mode,
    aiEnabled: state.aiEnabled, error: state.error || '', locale: state.locale, contentLocale: state.contentLocale,
    trackedTabs: state.trackedTabIds.length,
  }
}

async function capture(tabId: number): Promise<string> {
  const tab = await chrome.tabs.get(tabId)
  if (tab.windowId === undefined) throw new Error('找不到录制窗口')
  return chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' })
}

async function captureSynchronized(tabId: number, includeSnapshot = false): Promise<{ screenshot: string; snapshot?: Record<string, any> }> {
  let pageState: { snapshot?: Record<string, any> } | undefined
  try {
    pageState = await chrome.tabs.sendMessage(tabId, {
      type: 'RECORDER_UI_VISIBILITY', hidden: true, captureSnapshot: includeSnapshot,
    })
  } catch { /* restricted page */ }
  try { return { screenshot: await capture(tabId), snapshot: pageState?.snapshot } }
  finally { try { await chrome.tabs.sendMessage(tabId, { type: 'RECORDER_UI_VISIBILITY', hidden: false }) } catch { /* page may navigate */ } }
}

async function captureClean(tabId: number): Promise<string> {
  return (await captureSynchronized(tabId)).screenshot
}

async function notify(state: Recording | null) {
  if (!state) return
  const badge = !state.active ? '' : state.capturing ? '…' : state.paused ? 'Ⅱ' : state.steps ? (state.steps > 99 ? '99+' : String(state.steps)) : 'REC'
  await Promise.all(state.trackedTabIds.map(async tabId => {
    try {
      const tab = await chrome.tabs.get(tabId)
      if (isRecordableUrl(tab.url)) await sendToRecordableTab(tabId, statePayload(state, state.active))
    } catch { /* restricted, navigating, or closed page */ }
    try {
      await chrome.action.setBadgeText({ tabId, text: badge })
      await chrome.action.setBadgeBackgroundColor({ tabId, color: state.paused ? '#f59e0b' : state.capturing ? '#7c3aed' : '#e53945' })
      await chrome.action.setTitle({ tabId, title: state.active ? `${state.steps} Steps Recorded · ${state.trackedTabIds.length} Tabs` : 'DocFlow Recorder' })
    } catch { /* tab was closed */ }
  }))
}

async function attachTab(tabId: number, makeActive = false) {
  const state = await restore()
  if (!state?.active) return null
  if (!state.trackedTabIds.includes(tabId)) state.trackedTabIds.push(tabId)
  if (makeActive) state.activeTabId = tabId
  await persist(state); await notify(state)
  return state
}

async function deleteAutomaticDemo(state: Pick<Recording, 'api' | 'token' | 'demoId' | 'autoCreated' | 'steps'>) {
  if (!state.autoCreated || state.steps > 0) return
  try {
    await fetch(`${state.api}/api/demos/${state.demoId}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${state.token}` },
    })
  } catch { /* best-effort cleanup; the server recycle bin remains the fallback */ }
}

async function auditRecording(state: Recording, action: 'started' | 'paused' | 'resumed' | 'completed') {
  try {
    await fetch(`${state.api}/api/recordings/${state.demoId}/events`, {
      method: 'POST', headers: { Authorization: `Bearer ${state.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, mode: state.mode, ai_enabled: state.aiEnabled, step_count: state.steps }),
    })
  } catch { /* audit delivery must not interrupt recording */ }
}

async function begin(demoId: string, mode: RecordingMode = 'html', aiEnabled = false, sourceTabId?: number, locale: Locale = browserLocale(), contentLocale: Locale = locale, autoCreated = false) {
  const auth = await connectedCredentials()
  const tab = sourceTabId ? await chrome.tabs.get(sourceTabId) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
  if (!auth || !tab.id || !isRecordableUrl(tab.url)) throw new Error('请打开可录制的业务页面并确认扩展已连接')
  recording = {
    rootTabId: tab.id, activeTabId: tab.id, trackedTabIds: [tab.id], demoId, api: auth.api, web: auth.web, token: auth.token,
    screenshot: await capture(tab.id), active: true, paused: false,
    capturing: false, phase: '', steps: 0, mode, aiEnabled, locale, contentLocale,
    autoCreated,
  }
  await persist(recording)
  await notify(recording)
  await auditRecording(recording, 'started')
}

async function restore(): Promise<Recording | null> {
  if (recording) return recording
  const saved = await savedRecording()
  if (!saved) return null
  try {
    const legacy = saved as SavedRecording & { tabId?: number; trackedTabIds?: number[]; activeTabId?: number; rootTabId?: number }
    const rootTabId = legacy.rootTabId || legacy.tabId
    if (!rootTabId) throw new Error('recording tab is missing')
    const trackedTabIds = [...new Set(legacy.trackedTabIds?.length ? legacy.trackedTabIds : [rootTabId])]
    const existingTabs = (await Promise.all(trackedTabIds.map(id => chrome.tabs.get(id).catch(() => null)))).filter(Boolean)
    const existingIds = existingTabs.map(tab => tab!.id!)
    if (!existingIds.length) {
      await deleteAutomaticDemo({ ...saved, autoCreated: Boolean(saved.autoCreated), steps: Number(saved.steps || 0) })
      await chrome.storage.session.remove('recording')
      return null
    }
    const activeTabId = existingIds.includes(legacy.activeTabId || 0) ? legacy.activeTabId! : existingIds[0] || rootTabId
    recording = {
      ...saved, rootTabId, activeTabId, trackedTabIds: existingIds, screenshot: 'data:image/png;base64,',
      paused: Boolean(saved.paused), capturing: false,
      phase: '',
      steps: Number(saved.steps || 0), mode: saved.mode || 'html',
      aiEnabled: Boolean(saved.aiEnabled), locale: saved.locale || browserLocale(), contentLocale: saved.contentLocale || saved.locale || browserLocale(),
      autoCreated: Boolean(saved.autoCreated),
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
    await chrome.action.setBadgeText({ tabId: state.activeTabId, text: '!' })
    const failure = new Error(quotaApiError(error, state.locale)) as Error & { quota?: boolean }
    failure.quota = String(error.code || '').startsWith('quota.')
    throw failure
  }
  return upload.json() as Promise<{ id: string }>
}

async function recordStep(data: Record<string, any>, snapshot: Record<string, any> | undefined, state: Recording, screenshotOverride?: string) {
  const pageUrl = String(data.page_context?.url || '')
  const enriched = state.mode === 'html' ? await enrichSnapshot(snapshot, pageUrl) : undefined
  await uploadStep(data, enriched, screenshotOverride, state)
  state.error = ''
  await persist(state); await notify(state)
}

async function captureAndQueueStep(data: Record<string, any>, snapshot: Record<string, any> | undefined, state: Recording, sourceTabId: number) {
  const sourceTab = await chrome.tabs.get(sourceTabId)
  if (!sourceTab.active || !state.trackedTabIds.includes(sourceTabId)) return { ignored: true, steps: state.steps }
  const auth: Credentials = { api: state.api, token: state.token }
  const live = await loadCapabilities(auth, '', state.demoId).catch(() => null)
  if (live) {
    const stepQuota = live.items?.find(item => item.key === 'max_steps_per_resource')
    if (typeof stepQuota?.limit === 'number') {
      const liveRemaining = Math.max(0, stepQuota.limit - Number(live.demo_step_count || 0))
      let localRemaining = state.stepQuotaRemaining ?? liveRemaining
      if (state.stepQuotaLimit !== undefined && state.stepQuotaLimit !== stepQuota.limit) {
        localRemaining = Math.max(0, localRemaining + stepQuota.limit - state.stepQuotaLimit)
      }
      state.stepQuotaLimit = stepQuota.limit
      state.stepQuotaRemaining = Math.min(localRemaining, liveRemaining)
    } else {
      state.stepQuotaLimit = undefined
      state.stepQuotaRemaining = undefined
    }
    const quotaError = !quotaAllowed(live, 'record_step')
      ? quotaMessage(live, 'record_step', state.locale)
      : state.stepQuotaRemaining !== undefined && state.stepQuotaRemaining < 1 && state.stepQuotaLimit !== undefined
        ? quotaMetricMessage('max_steps_per_resource', state.stepQuotaLimit, state.stepQuotaLimit, state.locale)
        : ''
    if (quotaError) {
      await scheduleQuotaEnd(state, quotaError)
      return { quotaEnded: true, error: quotaError, steps: state.steps }
    }
    if (state.aiEnabled && !quotaAllowed(live, 'use_ai')) {
      state.aiEnabled = false
      await persist(state); await notify(state)
    }
  }
  state.activeTabId = sourceTabId
  state.capturing = true; state.phase = 'uploading'
  await persist(state); await notify(state)
  let captured: { screenshot: string; snapshot?: Record<string, any> }
  try {
    captured = await captureSynchronized(sourceTabId, state.mode === 'html')
  } catch (error) {
    state.capturing = false; state.phase = ''
    await persist(state); await notify(state)
    throw error
  }

  // The page can be released as soon as its pixels are captured. DOM asset
  // enrichment, upload and AI work continue serially in the background.
  state.steps += 1
  if (state.stepQuotaRemaining !== undefined) state.stepQuotaRemaining = Math.max(0, state.stepQuotaRemaining - 1)
  state.capturing = false; state.phase = ''
  await persist(state); await notify(state)
  const synchronizedSnapshot = state.mode === 'html' ? (captured.snapshot || snapshot) : undefined
  const task = queue.then(() => recordStep(data, synchronizedSnapshot, state, captured.screenshot))
  queue = task.catch(async error => {
    console.warn('DocFlow step upload:', error)
    state.steps = Math.max(0, state.steps - 1)
    if (state.stepQuotaRemaining !== undefined) state.stepQuotaRemaining += 1
    state.error = (error as Error).message
    const quotaFailure = Boolean((error as Error & { quota?: boolean }).quota)
    if (quotaFailure) await scheduleQuotaEnd(state, state.error)
    else { await persist(state); await notify(state) }
    try {
      await chrome.action.setBadgeText({ tabId: sourceTabId, text: '!' })
      await chrome.action.setBadgeBackgroundColor({ tabId: sourceTabId, color: '#dc2626' })
    } catch { /* the tab may already be closed */ }
  })
  return { accepted: true, steps: state.steps }
}

async function pause() {
  const state = await restore()
  if (!state?.active) return null
  if (quotaEnding) return state
  await queue
  state.paused = !state.paused
  if (!state.paused) state.error = ''
  state.capturing = false
  state.phase = ''
  await persist(state); await notify(state)
  await auditRecording(state, state.paused ? 'paused' : 'resumed')
  return state
}

async function demoEditorUrl(state: Recording) {
  const auth = await connectedCredentials()
  const apiUrl = new URL(state.api)
  return `${auth?.web || state.web || `${apiUrl.protocol}//${apiUrl.hostname}:5173`}/demos/${state.demoId}`
}

async function completeRecording(state: Recording, open: boolean) {
  await auditRecording(state, 'completed')
  state.active = false; state.paused = false; state.capturing = false; state.phase = ''
  await notify(state)
  recording = null
  await chrome.storage.session.remove('recording')
  if (open) await chrome.tabs.create({ url: await demoEditorUrl(state) })
}

async function finishQuotaEnd(state: Recording, message: string) {
  try {
    await queue.catch(() => {})
    if (!recording || recording.demoId !== state.demoId) return
    const editorUrl = await demoEditorUrl(state)
    let delivered = false
    try {
      await sendToRecordableTab(state.activeTabId, { type: 'RECORDING_QUOTA_ENDED', message, editorUrl })
      delivered = true
    } catch { /* fall back to opening the editor directly */ }
    await completeRecording(state, false)
    if (!delivered) await chrome.tabs.create({ url: editorUrl })
  } finally {
    quotaEnding = false
  }
}

async function scheduleQuotaEnd(state: Recording, message: string) {
  if (quotaEnding) return
  quotaEnding = true
  state.paused = true; state.capturing = false; state.phase = ''; state.error = message
  await persist(state); await notify(state)
  setTimeout(() => { void finishQuotaEnd(state, message) }, 0)
}

async function stop(open = true) {
  const state = await restore()
  if (!state) { await chrome.storage.session.remove('recording'); return }
  if (quotaEnding) return
  await queue.catch(() => {})
  state.paused = false; state.capturing = true; state.phase = 'uploading'
  await notify(state)
  try {
    const finalTab = await chrome.tabs.get(state.activeTabId)
    if (finalTab.active) {
      const final = await chrome.tabs.sendMessage(state.activeTabId, { type: 'CAPTURE_FINAL' })
      if (final?.data) await uploadStep(final.data, state.mode === 'html' ? final.snapshot : undefined, await captureClean(state.activeTabId), state)
    }
  } catch (error) { console.warn('DocFlow final slide:', error) }
  if (state.aiEnabled) {
    try {
      const live = await loadCapabilities({ api: state.api, token: state.token }, '', state.demoId)
      if (quotaAllowed(live, 'use_ai')) {
        await fetch(`${state.api}/api/demos/${state.demoId}/ai/generate`, { method: 'POST', headers: { Authorization: `Bearer ${state.token}` } })
      }
    } catch { /* AI is optional */ }
  }
  await completeRecording(state, open)
}

function requireWebSender(sender: chrome.runtime.MessageSender) {
  if (!isConfiguredWebPage(sender.url)) throw new Error('Untrusted DocFlow connection request')
}

async function connectFromWeb(code: string, sender: chrome.runtime.MessageSender) {
  requireWebSender(sender)
  const response = await fetch(`${configuredApiUrl}/api/extension/pair/exchange`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
  })
  if (!response.ok) throw new Error('The pairing request is invalid or expired')
  const result = await response.json()
  const credentials: Credentials = { api: configuredApiUrl, web: configuredWebUrl, token: result.token }
  await chrome.storage.local.set({ credentials })
  await chrome.storage.local.remove('pendingTarget')
  return { connected: true }
}

function automaticTitle(tab: chrome.tabs.Tab, locale: Locale) {
  let host = ''
  try { host = new URL(tab.url || '').hostname.replace(/^www\./, '') } catch { /* title is enough */ }
  const pageTitle = String(tab.title || '').replace(/\s+/g, ' ').trim()
  const base = pageTitle || host || (locale === 'zh-CN' ? '新演示' : 'New demo')
  const date = new Intl.DateTimeFormat(locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date())
  return `${base} · ${date}`.slice(0, 200)
}

async function createAutomaticDemo(auth: Credentials, tab: chrome.tabs.Tab, contentLocale: Locale, uiLocale: Locale, aiContext = '') {
  const response = await fetch(`${auth.api}/api/demos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: automaticTitle(tab, contentLocale), content_locale: contentLocale, ai_context: aiContext.trim(), auto_title: true }),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Could not create a recording draft' }))
    throw new Error(quotaApiError(error, uiLocale))
  }
  return response.json() as Promise<{ id: string }>
}

async function updateDemoAISettings(auth: Credentials, demoId: string, contentLocale: Locale, aiContext = '') {
  const response = await fetch(`${auth.api}/api/demos/${demoId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content_locale: contentLocale, ai_context: aiContext.trim() }),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Could not save AI settings' }))
    throw new Error(String(error.detail || 'Could not save AI settings'))
  }
}

async function validateRecordingTarget(auth: Credentials, demoId: string) {
  const response = await fetch(`${auth.api}/api/demos/${demoId}`, {
    headers: { Authorization: `Bearer ${auth.token}` },
  })
  if (!response.ok) throw new Error(response.status === 401 ? 'Extension connection expired' : 'Recording target is unavailable')
}

async function switchRecordingOrganization(auth: Credentials, organizationId: string) {
  if (!organizationId) return
  const response = await fetch(`${auth.api}/api/organizations/${organizationId}/switch`, {
    method: 'POST', headers: { Authorization: `Bearer ${auth.token}` },
  })
  if (!response.ok) throw new Error('The selected space is unavailable or you do not have recording permission')
  await chrome.storage.local.set({ activeOrganizationId: organizationId })
}

async function sendToRecordableTab(tabId: number, message: Record<string, unknown>) {
  try { return await chrome.tabs.sendMessage(tabId, message) }
  catch {
    // Tabs that were already open when the extension was installed/reloaded do
    // not have the manifest content script yet. Inject it once and retry so the
    // user does not have to discover that a manual page refresh is required.
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content.js'] })
    return chrome.tabs.sendMessage(tabId, message)
  }
}

const RECOMMENDED_RECORDING_SIZE = { width: 1056, height: 660 }

async function recordingDiagnostics(tab: chrome.tabs.Tab) {
  if (tab.windowId === undefined) throw new Error('Recording window is unavailable')
  const [windowInfo, windowTabs] = await Promise.all([
    chrome.windows.get(tab.windowId), chrome.tabs.query({ windowId: tab.windowId }),
  ])
  return {
    width: Number(windowInfo.width || 0), height: Number(windowInfo.height || 0),
    tabCount: windowTabs.length,
    closableTabCount: windowTabs.filter(item => item.id !== tab.id && !item.pinned).length,
    recommendedWidth: RECOMMENDED_RECORDING_SIZE.width,
    recommendedHeight: RECOMMENDED_RECORDING_SIZE.height,
  }
}

async function resizeRecordingWindow(sender: chrome.runtime.MessageSender) {
  const windowId = sender.tab?.windowId
  if (windowId === undefined) throw new Error('Recording window is unavailable')
  let current = await chrome.windows.get(windowId)
  if (current.state !== 'normal') {
    await chrome.windows.update(windowId, { state: 'normal' })
    current = await chrome.windows.get(windowId)
  }
  const width = RECOMMENDED_RECORDING_SIZE.width, height = RECOMMENDED_RECORDING_SIZE.height
  const left = Math.max(0, Math.round((current.left || 0) + ((current.width || width) - width) / 2))
  const top = Math.max(0, Math.round((current.top || 0) + ((current.height || height) - height) / 2))
  const updated = await chrome.windows.update(windowId, { width, height, left, top })
  return { width: Number(updated.width || width), height: Number(updated.height || height) }
}

async function closeOtherRecordingTabs(sender: chrome.runtime.MessageSender) {
  const sourceTab = sender.tab
  if (!sourceTab?.id || sourceTab.windowId === undefined) throw new Error('Recording tab is unavailable')
  const windowTabs = await chrome.tabs.query({ windowId: sourceTab.windowId })
  const removable = windowTabs.filter(tab => tab.id !== sourceTab.id && !tab.pinned).flatMap(tab => tab.id === undefined ? [] : [tab.id])
  if (removable.length) await chrome.tabs.remove(removable)
  const remaining = await chrome.tabs.query({ windowId: sourceTab.windowId })
  return {
    tabCount: remaining.length,
    closableTabCount: remaining.filter(tab => tab.id !== sourceTab.id && !tab.pinned).length,
  }
}

async function selectTargetFromWeb(demoId: string, sender: chrome.runtime.MessageSender) {
  requireWebSender(sender)
  const auth = await connectedCredentials()
  if (!auth) throw new Error('Extension is not connected')
  const response = await fetch(`${auth.api}/api/demos/${demoId}`, { headers: { Authorization: `Bearer ${auth.token}` } })
  if (!response.ok) throw new Error(response.status === 401 ? 'Extension connection expired' : 'Recording target is unavailable')
  const demo = await response.json()
  const target: RecordingTarget = {
    demoId: demo.id, organizationId: demo.organization_id, title: demo.title,
    contentLocale: demo.content_locale || browserLocale(), aiEnabled: Boolean(demo.ai_enabled),
    aiContext: String(demo.ai_context || ''),
  }
  const switched = await fetch(`${auth.api}/api/organizations/${target.organizationId}/switch`, {
    method: 'POST', headers: { Authorization: `Bearer ${auth.token}` },
  })
  if (!switched.ok) throw new Error('Could not activate the target team space')
  await chrome.storage.local.set({ pendingTarget: target, activeOrganizationId: target.organizationId })
  return { selected: true, title: target.title }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  ;(async () => {
    if (message.type === 'CONNECT_FROM_WEB') return connectFromWeb(String(message.code || ''), sender)
    if (message.type === 'PING_FROM_WEB') {
      requireWebSender(sender)
      const auth = await connectedCredentials()
      if (!auth?.token) return { installed: true, connected: false }
      const response = await fetch(`${auth.api}/api/extension/config`, { headers: { Authorization: `Bearer ${auth.token}` } }).catch(() => null)
      if (response?.ok) return { installed: true, connected: true }
      if (response?.status === 401) await chrome.storage.local.remove(['credentials', 'pendingTarget'])
      return { installed: true, connected: false }
    }
    if (message.type === 'SET_TARGET_FROM_WEB') return selectTargetFromWeb(String(message.demoId || ''), sender)
    if (message.type === 'GET_QUOTA_CAPABILITIES') {
      const auth = await connectedCredentials()
      if (!auth) throw new Error('Extension connection expired')
      return loadCapabilities(auth, String(message.organizationId || ''), String(message.demoId || ''))
    }
    if (message.type === 'GET_QUOTA_SUMMARY') {
      const auth = await connectedCredentials()
      if (!auth) throw new Error('Extension connection expired')
      return loadQuotaSummary(auth, String(message.organizationId || ''))
    }
    if (message.type === 'SAVE_RECORDING_PREFERENCES') {
      await chrome.storage.local.set({ recordingPreferences: {
        aiEnabled: Boolean(message.aiEnabled),
        contentLocale: (message.contentLocale || browserLocale()) as Locale,
      } })
      return { ok: true }
    }
    if (message.type === 'RESIZE_RECORDING_WINDOW') return resizeRecordingWindow(sender)
    if (message.type === 'CLOSE_OTHER_RECORDING_TABS') return closeOtherRecordingTabs(sender)
    if (message.type === 'OPEN_SETUP') {
      const tab = message.tabId ? await chrome.tabs.get(Number(message.tabId)) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
      if (!tab?.id || !isRecordableUrl(tab.url)) throw new Error('Please switch to the business page you want to record first.')
      const diagnostics = await recordingDiagnostics(tab)
      await sendToRecordableTab(tab.id, {
        type: 'SHOW_RECORDING_SETUP', demoId: message.demoId || undefined,
        aiAvailable: Boolean(message.aiAvailable), defaultMode: message.defaultMode || 'html',
        defaultAI: Boolean(message.defaultAI), spaces: Array.isArray(message.spaces) ? message.spaces : [],
        organizationId: message.organizationId || '', lockOrganization: Boolean(message.lockOrganization),
        diagnostics,
        locale: message.locale || browserLocale(),
        contentLocale: message.contentLocale || message.locale || browserLocale(),
        aiContext: String(message.aiContext || ''),
      })
      return { ok: true }
    }
    if (message.type === 'START') {
      const auth = await connectedCredentials()
      const tab = sender.tab
      if (!auth || !tab?.id || !isRecordableUrl(tab.url)) throw new Error('Please open a recordable business page first.')
      const contentLocale = (message.contentLocale || message.locale || browserLocale()) as Locale
      const aiContext = String(message.aiContext || '').trim().slice(0, 500)
      const uiLocale = (message.locale || browserLocale()) as Locale
      const organizationId = String(message.organizationId || '')
      await switchRecordingOrganization(auth, organizationId)
      let demoId = String(message.demoId || '')
      const live = await loadCapabilities(auth, organizationId, demoId)
      requireQuota(live, demoId ? 'record_step' : 'create_resource', uiLocale)
      requireQuota(live, 'record_step', uiLocale)
      if (message.aiEnabled) requireQuota(live, 'use_ai', uiLocale)
      let autoCreated = false
      if (!demoId) {
        demoId = (await createAutomaticDemo(auth, tab, contentLocale, uiLocale, aiContext)).id
        autoCreated = true
      } else {
        await validateRecordingTarget(auth, demoId)
        await updateDemoAISettings(auth, demoId, contentLocale, aiContext)
      }
      try {
        await begin(demoId, message.mode, Boolean(message.aiEnabled), tab.id, message.locale || browserLocale(), contentLocale, autoCreated)
      } catch (error) {
        if (autoCreated) await deleteAutomaticDemo({ api: auth.api, token: auth.token, demoId, autoCreated, steps: 0 })
        throw error
      }
      await chrome.storage.local.remove('pendingTarget')
      return { ok: true, demoId, autoCreated }
    }
    if (message.type === 'ATTACH_CURRENT_TAB') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id || !isRecordableUrl(tab.url)) throw new Error('Please open a recordable business page first.')
      const state = await attachTab(tab.id, true)
      return state ? { active: true, trackedTabs: state.trackedTabIds.length } : { active: false }
    }
    if (message.type === 'PAUSE') { const state = await pause(); return state ? { active: true, paused: state.paused, steps: state.steps, mode: state.mode } : { active: false } }
    if (message.type === 'STOP') { await stop(message.open !== false); return { ok: true } }
    if (message.type === 'STATUS') {
      const state = await restore()
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      return state ? { active: state.active, paused: state.paused, capturing: state.capturing, phase: state.phase, steps: state.steps, demoId: state.demoId, mode: state.mode, aiEnabled: state.aiEnabled, locale: state.locale, contentLocale: state.contentLocale, trackedTabs: state.trackedTabIds.length, currentTabTracked: Boolean(tab?.id && state.trackedTabIds.includes(tab.id)) } : { active: false, steps: 0, trackedTabs: 0, currentTabTracked: false }
    }
    if (message.type === 'IS_RECORDING') {
      const state = await restore()
      return state?.active && Boolean(sender.tab?.id && state.trackedTabIds.includes(sender.tab.id))
        ? { active: true, paused: state.paused, capturing: state.capturing, phase: state.phase, steps: state.steps, mode: state.mode, aiEnabled: state.aiEnabled, locale: state.locale, contentLocale: state.contentLocale, trackedTabs: state.trackedTabIds.length }
        : { active: false }
    }
    if (message.type === 'MANUAL_STEP' && sender.tab?.id) {
      const state = await restore()
      if (!state || !state.trackedTabIds.includes(sender.tab.id) || !state.active || state.paused || state.capturing) return { ignored: true, steps: state?.steps || 0 }
      return captureAndQueueStep(message.data, message.snapshot, state, sender.tab.id)
    }
    if (message.type === 'STEP_EVENT' && sender.tab?.id) {
      const state = await restore()
      if (!state || !state.trackedTabIds.includes(sender.tab.id) || !state.active || state.paused || state.capturing) return { ignored: true, steps: state?.steps || 0 }
      return captureAndQueueStep(message.data, message.snapshot, state, sender.tab.id)
    }
    return undefined
  })().then(sendResponse).catch(error => sendResponse({ error: error.message }))
  return true
})

chrome.tabs.onUpdated.addListener(async (tabId, change) => {
  const state = await restore()
  if (state?.active && state.trackedTabIds.includes(tabId) && change.status === 'complete') {
    await new Promise(resolve => setTimeout(resolve, 650))
    try {
      const tab = await chrome.tabs.get(tabId)
      if (tab.active) { state.activeTabId = tabId; state.screenshot = await captureClean(tabId) }
      await persist(state); await notify(state)
    } catch { /* restricted page */ }
  }
})

chrome.tabs.onCreated.addListener(async tab => {
  if (!tab.id || !tab.openerTabId) return
  const state = await restore()
  if (state?.active && state.trackedTabIds.includes(tab.openerTabId)) await attachTab(tab.id, Boolean(tab.active))
})

chrome.webNavigation.onCreatedNavigationTarget.addListener(async details => {
  const state = await restore()
  if (state?.active && state.trackedTabIds.includes(details.sourceTabId)) await attachTab(details.tabId, true)
})

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const state = await restore()
  if (!state?.active) return
  const tab = await chrome.tabs.get(tabId).catch(() => null)
  if (!tab || !isRecordableUrl(tab.url)) return
  if (!state.trackedTabIds.includes(tabId)) {
    await attachTab(tabId, true)
    return
  }
  state.activeTabId = tabId
  await persist(state); await notify(state)
})

chrome.tabs.onRemoved.addListener(async tabId => {
  const state = await restore()
  if (!state?.trackedTabIds.includes(tabId)) return
  state.trackedTabIds = state.trackedTabIds.filter(id => id !== tabId)
  try { await chrome.action.setBadgeText({ tabId, text: '' }) } catch { /* already closed */ }
  if (!state.trackedTabIds.length) {
    await deleteAutomaticDemo(state)
    recording = null
    await chrome.storage.session.remove('recording')
    return
  }
  if (state.activeTabId === tabId) state.activeTabId = state.trackedTabIds[state.trackedTabIds.length - 1]
  await persist(state); await notify(state)
})
