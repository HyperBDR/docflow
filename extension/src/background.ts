import type { Credentials, ExtensionUpdate, Locale, Recording, RecordingMode, RecordingTarget } from './types'
import { browserLocale } from './locale'
import { quotaAllowed, quotaApiError, quotaMessage, quotaMetricMessage, type QuotaAction, type WorkspaceCapabilities, type WorkspaceQuotaSummary } from './quota'
import { configuredApiUrl, configuredUpdateChannel, configuredWebUrl, isConfiguredWebPage, isRecordableUrl } from './config'
import { isSerializedStylesheetLink, replaceSerializedStyleText, serializedStyleText, snapshotAssetMime, sniffSnapshotFontMime, svgDataUrlWithFragment, uniqueCssAssetUrls } from './snapshot-assets'
import { DEFAULT_CAPTURE_FEEDBACK_DURATION_MS, captureFeedbackDuration } from './capture-feedback'

type SavedRecording = Omit<Recording, 'screenshot'>
let recording: Recording | null = null
let queue: Promise<void> = Promise.resolve()
let quotaEnding = false
const UPDATE_ALARM = 'docflow-extension-update'
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

function packageIdentity() {
  const manifest = chrome.runtime.getManifest()
  return { version: manifest.version, versionName: manifest.version_name || manifest.version, channel: configuredUpdateChannel }
}

async function displayUpdateBadge(update?: ExtensionUpdate | null) {
  const state = await restore()
  if (state?.active) return
  await chrome.action.setBadgeText({ text: update?.update_available ? 'NEW' : '' })
  if (update?.update_available) {
    await chrome.action.setBadgeBackgroundColor({ color: update.required ? '#dc3545' : '#635bff' })
    await chrome.action.setTitle({ title: `DocFlow Recorder · ${update.required ? 'Update required' : 'Update available'} ${update.latest_version || ''}` })
  } else await chrome.action.setTitle({ title: 'DocFlow Recorder' })
}

async function checkExtensionUpdate(force = false): Promise<ExtensionUpdate | null> {
  const stored = await chrome.storage.local.get(['extensionUpdate', 'extensionUpdateCheckedAt'])
  const cached = stored.extensionUpdate as ExtensionUpdate | undefined
  const checkedAt = Number(stored.extensionUpdateCheckedAt || 0)
  if (!force && cached && Date.now() - checkedAt < UPDATE_CHECK_INTERVAL_MS) {
    await displayUpdateBadge(cached)
    return cached
  }
  const identity = packageIdentity()
  try {
    const params = new URLSearchParams({ channel: identity.channel, current_version: identity.version })
    const response = await fetch(`${configuredApiUrl}/api/extension/releases/check?${params}`)
    if (!response.ok) throw new Error('update check failed')
    const update = await response.json() as ExtensionUpdate
    await chrome.storage.local.set({ extensionUpdate: update, extensionUpdateCheckedAt: Date.now() })
    await displayUpdateBadge(update)
    return update
  } catch {
    await displayUpdateBadge(cached)
    return cached || null
  }
}

async function initializeUpdateChecks() {
  await chrome.alarms.create(UPDATE_ALARM, { delayInMinutes: 1, periodInMinutes: 360 })
  await checkExtensionUpdate(false)
}

async function connectedCredentials(): Promise<Credentials | undefined> {
  const auth = (await chrome.storage.local.get('credentials')).credentials as Credentials | undefined
  if (!auth) return undefined
  if (auth.api.replace(/\/$/, '') === configuredApiUrl && String(auth.web || '').replace(/\/$/, '') === configuredWebUrl) return auth
  await chrome.storage.local.remove(['credentials', 'pendingTarget', 'activeOrganizationId'])
  return undefined
}

async function loadExtensionRuntimeConfig(auth: Credentials) {
  const stored = await chrome.storage.local.get('extensionRuntimeConfig')
  const cached = stored.extensionRuntimeConfig as { capture_feedback_duration_ms?: number } | undefined
  try {
    const response = await fetch(`${auth.api}/api/extension/config`, { headers: { Authorization: `Bearer ${auth.token}` } })
    if (!response.ok) throw new Error('extension config unavailable')
    const config = await response.json() as { capture_feedback_duration_ms?: number }
    const normalized = { ...config, capture_feedback_duration_ms: captureFeedbackDuration(config.capture_feedback_duration_ms) }
    await chrome.storage.local.set({ extensionRuntimeConfig: normalized })
    return normalized
  } catch {
    return { capture_feedback_duration_ms: captureFeedbackDuration(cached?.capture_feedback_duration_ms) }
  }
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
    aiEnabled: state.aiEnabled, privacyEnabled: state.privacyEnabled, captureFeedbackDurationMs: state.captureFeedbackDurationMs,
    error: state.error || '', locale: state.locale, contentLocale: state.contentLocale,
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

async function deleteAutomaticDemo(state: Pick<Recording, 'api' | 'token' | 'demoId' | 'sessionId' | 'autoCreated' | 'steps'>) {
  if (state.sessionId) {
    try {
      await fetch(`${state.api}/api/recordings/sessions/${state.sessionId}/cancel`, {
        method: 'POST', headers: { Authorization: `Bearer ${state.token}` },
      })
    } catch { /* best-effort cleanup; the server session remains recoverable */ }
    return
  }
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

function applyStepQuota(state: Recording, live: WorkspaceCapabilities) {
  const stepQuota = live.items?.find(item => item.key === 'max_steps_per_resource')
  if (typeof stepQuota?.limit !== 'number') {
    state.stepQuotaLimit = undefined
    state.stepQuotaRemaining = undefined
    return
  }
  state.stepQuotaLimit = stepQuota.limit
  state.stepQuotaRemaining = Math.max(0, stepQuota.limit - Number(live.demo_step_count || 0))
}

async function begin(demoId: string, sessionId: string, mode: RecordingMode = 'html', aiEnabled = false, privacyEnabled = false, captureFeedbackDurationMs = DEFAULT_CAPTURE_FEEDBACK_DURATION_MS, sourceTabId?: number, locale: Locale = browserLocale(), contentLocale: Locale = locale, autoCreated = false, capabilities?: WorkspaceCapabilities) {
  const auth = await connectedCredentials()
  const tab = sourceTabId ? await chrome.tabs.get(sourceTabId) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
  if (!auth || !tab.id || !isRecordableUrl(tab.url)) throw new Error('请打开可录制的业务页面并确认扩展已连接')
  recording = {
    rootTabId: tab.id, activeTabId: tab.id, trackedTabIds: [tab.id], demoId, sessionId, api: auth.api, web: auth.web, token: auth.token,
    // Every slide receives a synchronized clean screenshot. Do not capture the
    // setup dialog here and keep it as an accidental fallback image.
    screenshot: 'data:image/png;base64,', active: true, paused: false,
    capturing: false, phase: '', steps: 0, mode, aiEnabled, privacyEnabled,
    captureFeedbackDurationMs: captureFeedbackDuration(captureFeedbackDurationMs), locale, contentLocale,
    autoCreated,
  }
  if (capabilities) applyStepQuota(recording, capabilities)
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
      await deleteAutomaticDemo({ ...saved, sessionId: String(saved.sessionId || ''), autoCreated: Boolean(saved.autoCreated), steps: Number(saved.steps || 0) })
      await chrome.storage.session.remove('recording')
      return null
    }
    const activeTabId = existingIds.includes(legacy.activeTabId || 0) ? legacy.activeTabId! : existingIds[0] || rootTabId
    recording = {
      ...saved, rootTabId, activeTabId, trackedTabIds: existingIds, screenshot: 'data:image/png;base64,',
      paused: Boolean(saved.paused), capturing: false,
      phase: '',
      steps: Number(saved.steps || 0), mode: saved.mode || 'html',
      aiEnabled: Boolean(saved.aiEnabled), privacyEnabled: Boolean(saved.privacyEnabled),
      captureFeedbackDurationMs: captureFeedbackDuration(saved.captureFeedbackDurationMs),
      locale: saved.locale || browserLocale(), contentLocale: saved.contentLocale || saved.locale || browserLocale(),
      autoCreated: Boolean(saved.autoCreated), sessionId: String(saved.sessionId || ''),
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

async function responseDataUrl(response: Response, maxBytes: number, sourceUrl = response.url): Promise<string | null> {
  if (!response.ok) return null
  let contentType = snapshotAssetMime(response.headers.get('content-type') || '', sourceUrl)
  const declaredLength = Number(response.headers.get('content-length') || 0)
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return null
  const data = await response.arrayBuffer()
  if (data.byteLength > maxBytes) return null
  const bytes = new Uint8Array(data)
  contentType ||= sniffSnapshotFontMime(bytes)
  if (!contentType) return null
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return `data:${contentType};base64,${btoa(binary)}`
}

type SnapshotAssetLoader = (url: string, maxBytes: number) => Promise<string | null>

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 5_000) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try { return await fetch(url, { ...init, signal: controller.signal }) }
  finally { clearTimeout(timeout) }
}

function decodedDataUrlSize(dataUrl: string) {
  const payload = dataUrl.split(',', 2)[1] || ''
  return Math.max(0, Math.floor(payload.length * .75) - (payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0))
}

async function pageAssetDataUrl(tabId: number, pageUrl: string, assetUrl: string, maxBytes: number): Promise<string | null> {
  let pageOrigin = '', assetOrigin = ''
  try {
    pageOrigin = new URL(pageUrl).origin
    assetOrigin = new URL(assetUrl).origin
  } catch { return null }
  if (!pageOrigin || pageOrigin !== assetOrigin) return null
  try {
    const [execution] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      args: [assetUrl, pageOrigin, maxBytes],
      func: async (url: string, expectedOrigin: string, limit: number) => {
        if (location.origin !== expectedOrigin) return null
        const controller = new AbortController()
        const timeout = window.setTimeout(() => controller.abort(), 3_500)
        try {
          const response = await fetch(url, { credentials: 'include', cache: 'force-cache', signal: controller.signal })
          if (!response.ok) return null
          const declared = Number(response.headers.get('content-length') || 0)
          if (Number.isFinite(declared) && declared > limit) return null
          const data = new Uint8Array(await response.arrayBuffer())
          if (data.byteLength > limit) return null
          let binary = ''
          for (let offset = 0; offset < data.length; offset += 0x8000) binary += String.fromCharCode(...data.subarray(offset, offset + 0x8000))
          return { contentType: response.headers.get('content-type') || '', base64: btoa(binary), head: [...data.subarray(0, 12)] }
        } catch { return null }
        finally { window.clearTimeout(timeout) }
      },
    })
    const result = execution?.result as { contentType?: string; base64?: string; head?: number[] } | null | undefined
    if (!result?.base64) return null
    const contentType = snapshotAssetMime(String(result.contentType || ''), assetUrl)
      || sniffSnapshotFontMime(new Uint8Array(Array.isArray(result.head) ? result.head : []))
    return contentType ? `data:${contentType};base64,${result.base64}` : null
  } catch { return null }
}

async function pageStylesheetText(tabId: number, pageUrl: string, stylesheetUrl: string): Promise<string | null> {
  let pageOrigin = '', stylesheetOrigin = ''
  try {
    pageOrigin = new URL(pageUrl).origin
    stylesheetOrigin = new URL(stylesheetUrl).origin
  } catch { return null }
  if (!pageOrigin || pageOrigin !== stylesheetOrigin) return null
  try {
    const [execution] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      args: [stylesheetUrl, pageOrigin],
      func: async (url: string, expectedOrigin: string) => {
        if (location.origin !== expectedOrigin) return null
        const controller = new AbortController()
        const timeout = window.setTimeout(() => controller.abort(), 3_500)
        try {
          const response = await fetch(url, { credentials: 'include', cache: 'force-cache', signal: controller.signal })
          if (!response.ok) return null
          const declared = Number(response.headers.get('content-length') || 0)
          if (Number.isFinite(declared) && declared > 2_000_000) return null
          const text = await response.text()
          return new TextEncoder().encode(text).byteLength <= 2_000_000 ? text : null
        } catch { return null }
        finally { window.clearTimeout(timeout) }
      },
    })
    return typeof execution?.result === 'string' ? execution.result : null
  } catch { return null }
}

function snapshotAssetLoader(pageUrl: string, tabId?: number): SnapshotAssetLoader {
  const cache = new Map<string, Promise<string | null>>()
  return async (url, maxBytes) => {
    let pending = cache.get(url)
    if (!pending) {
      pending = (async () => {
        // Fetch same-origin assets in the page's MAIN world first. This keeps
        // the accepted certificate and authenticated session of intranet
        // pages, which an MV3 extension service worker does not always share.
        if (tabId) {
          const fromPage = await pageAssetDataUrl(tabId, pageUrl, url, 6_000_000)
          if (fromPage) return fromPage
        }
        try {
          return await responseDataUrl(await fetchWithTimeout(url, { credentials: 'include' }), 6_000_000, url)
        } catch { return null }
      })()
      cache.set(url, pending)
    }
    const dataUrl = await pending
    return dataUrl && decodedDataUrlSize(dataUrl) <= maxBytes ? dataUrl : null
  }
}

function snapshotAssetCandidates(nodes: Record<string, any>[], pageUrl: string, limit = 120) {
  const urls: string[] = []
  const seen = new Set<string>()
  const add = (raw: string, base = pageUrl, stripFragment = false) => {
    if (!raw || raw.startsWith('data:') || raw.startsWith('#') || urls.length >= limit) return
    try {
      const value = new URL(raw, base)
      if (stripFragment) value.hash = ''
      if (!seen.has(value.href)) { seen.add(value.href); urls.push(value.href) }
    } catch { /* malformed URLs are ignored without affecting capture */ }
  }
  const addCss = (css: string, base: string) => uniqueCssAssetUrls(css).forEach(raw => add(raw, base))

  for (const node of nodes) {
    if (urls.length >= limit) break
    const attrs = node.attributes || {}
    const tag = node.type === 2 ? String(node.tagName || '').toLowerCase() : ''
    if (isSerializedStylesheetLink(node)) {
      let base = pageUrl
      try { base = new URL(String(attrs.href || pageUrl), pageUrl).href } catch { /* keep page base */ }
      addCss(String(attrs._cssText || attrs._csstext || ''), base)
    } else if (tag === 'style') addCss(serializedStyleText(node), pageUrl)
    else if (node.type === 3 && node.isStyle && node.textContent) addCss(String(node.textContent), pageUrl)
    if (tag && String(attrs.style || '').includes('url(')) addCss(String(attrs.style), pageUrl)
    if (tag === 'img' && attrs.src && !attrs.rr_dataURL) add(String(attrs.src))
    if (tag === 'video' && attrs.poster) add(String(attrs.poster))
    if (tag === 'use') add(String(attrs.href || attrs['xlink:href'] || ''), pageUrl, true)
  }
  return urls
}

async function inlineCssAssets(css: string, stylesheetUrl: string, budget: { remaining: number }, loadAsset: SnapshotAssetLoader) {
  const replacements = new Map<string, string>()
  // Deduplicate before applying the cap. Large compiled stylesheets repeat the
  // same font URL many times; slicing the raw matches first could starve a
  // later, visible class background such as .login-container.
  for (const raw of uniqueCssAssetUrls(css)) {
    if (budget.remaining <= 0) break
    try {
      const url = new URL(raw, stylesheetUrl).href
      const dataUrl = await loadAsset(url, Math.min(6_000_000, budget.remaining))
      if (dataUrl) { replacements.set(raw, dataUrl); budget.remaining -= decodedDataUrlSize(dataUrl) }
    } catch { /* inaccessible resource remains a safe empty URL after server sanitization */ }
  }
  for (const [raw, dataUrl] of replacements) css = css.split(raw).join(dataUrl)
  return css
}

async function inlineCssText(css: string, baseUrl: string, budget: { remaining: number }, loadAsset: SnapshotAssetLoader) {
  if (!css || css.length > 2_000_000 || budget.remaining <= 0) return css
  const imported = await inlineCssImports(css, baseUrl, budget, loadAsset, new Set([baseUrl]))
  return inlineCssAssets(imported, baseUrl, budget, loadAsset)
}

async function inlineCssImports(
  css: string,
  stylesheetUrl: string,
  budget: { remaining: number },
  loadAsset: SnapshotAssetLoader,
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
      const response = await fetchWithTimeout(url, { credentials: 'include' })
      if (!response.ok) continue
      let imported = await response.text()
      const bytes = new TextEncoder().encode(imported).byteLength
      if (bytes > 1_500_000 || bytes > budget.remaining) continue
      budget.remaining -= bytes
      imported = await inlineCssImports(imported, url, budget, loadAsset, seen, depth + 1)
      imported = await inlineCssAssets(imported, url, budget, loadAsset)
      css = css.replace(original, media ? `@media ${media}{${imported}}` : imported)
    } catch { /* the server removes an unresolved @import safely */ }
  }
  return css
}

async function enrichSnapshot(snapshot: Record<string, any> | undefined, pageUrl: string, tabId?: number): Promise<Record<string, any> | undefined> {
  if (!snapshot?.snapshot) return snapshot
  const nodes: Record<string, any>[] = []
  visitNodes(snapshot.snapshot, node => nodes.push(node))
  // Keep enough headroom below the API's compressed snapshot limit while
  // allowing a normal high-resolution login background to be embedded.
  const budget = { remaining: 12 * 1024 * 1024 }
  const svgSprites = new Map<string, string | null>()
  const loadAsset = snapshotAssetLoader(pageUrl, tabId)

  // Start all common CSS/image/font reads together before the page replays the
  // captured click. The recording response does not await this work, so a 404
  // or slow head resource can never block the user's original interaction.
  await Promise.allSettled(snapshotAssetCandidates(nodes, pageUrl).map(url => loadAsset(url, 6_000_000)))

  for (const node of nodes.filter(isSerializedStylesheetLink).slice(0, 20)) {
    const attrs = node.attributes || {}
    try {
      const url = new URL(String(attrs.href || pageUrl), pageUrl).href
      let css = String(attrs._cssText || attrs._csstext || '')
      if (attrs.href) {
        try {
          const fromPage = tabId ? await pageStylesheetText(tabId, pageUrl, url) : null
          if (fromPage !== null) css = fromPage
          else {
            const response = await fetchWithTimeout(url, { credentials: 'include' })
            if (response.ok) {
              const fetched = await response.text()
              if (fetched.length <= 2_000_000) css = fetched
            }
          }
        } catch { /* rrweb's existing inline CSS can still be enriched */ }
      }
      if (!css) continue
      css = await inlineCssText(css, url, budget, loadAsset)
      node.attributes = { ...attrs, href: '', _cssText: css }
      delete node.attributes.integrity
      delete node.attributes.crossorigin
    } catch { /* screenshot remains the visual fallback */ }
  }

  // rrweb stores many inline <style> blocks in the element's _cssText
  // attribute rather than as a style text node. These blocks commonly contain
  // login backgrounds and @font-face declarations for third-party icon sets.
  for (const node of nodes.filter(item => item.type === 2 && String(item.tagName).toLowerCase() === 'style').slice(0, 120)) {
    const css = serializedStyleText(node)
    if (!css) continue
    try { replaceSerializedStyleText(node, await inlineCssText(css, pageUrl, budget, loadAsset)) }
    catch { /* unresolved URLs are removed by the server */ }
  }

  // rrweb preserves inline <style> content separately from linked sheets.
  // Resolve those URLs against the page itself before server sanitization.
  for (const node of nodes.filter(item => item.type === 3 && item.isStyle && item.textContent).slice(0, 80)) {
    try { node.textContent = await inlineCssText(String(node.textContent), pageUrl, budget, loadAsset) }
    catch { /* unresolved URLs are removed by the server */ }
  }

  // Inline style attributes can contain background-image and CSS variables
  // that never pass through a stylesheet node.
  for (const node of nodes.filter(item => item.type === 2 && String(item.attributes?.style || '').includes('url(')).slice(0, 160)) {
    try { node.attributes.style = await inlineCssAssets(String(node.attributes.style), pageUrl, budget, loadAsset) }
    catch { /* screenshot remains the visual fallback */ }
  }

  for (const node of nodes.filter(item => item.type === 2 && String(item.tagName).toLowerCase() === 'img').slice(0, 60)) {
    const attrs = node.attributes || {}
    if (!attrs.src || String(attrs.src).startsWith('data:') || attrs.rr_dataURL || budget.remaining <= 0) continue
    try {
      const dataUrl = await loadAsset(new URL(String(attrs.src), pageUrl).href, Math.min(6_000_000, budget.remaining))
      if (dataUrl) { attrs.rr_dataURL = dataUrl; budget.remaining -= decodedDataUrlSize(dataUrl) }
    } catch { /* screenshot remains the visual fallback */ }
  }

  // SVG icon systems commonly reference an external sprite through
  // <use href="/icons.svg#name">. A static replay cannot request that file,
  // so embed the sprite and retain its fragment identifier.
  for (const node of nodes.filter(item => item.type === 2 && String(item.tagName).toLowerCase() === 'use').slice(0, 80)) {
    const attrs = node.attributes || {}
    const raw = String(attrs.href || attrs['xlink:href'] || '')
    if (!raw || raw.startsWith('#') || raw.startsWith('data:') || budget.remaining <= 0) continue
    try {
      const source = new URL(raw, pageUrl)
      const fragment = source.hash
      source.hash = ''
      const cacheKey = source.href
      let dataUrl = svgSprites.get(cacheKey)
      if (dataUrl === undefined) {
        dataUrl = await loadAsset(cacheKey, Math.min(6_000_000, budget.remaining))
        if (!dataUrl?.toLowerCase().startsWith('data:image/svg+xml')) dataUrl = null
        svgSprites.set(cacheKey, dataUrl)
        if (dataUrl) budget.remaining -= decodedDataUrlSize(dataUrl)
      }
      if (!dataUrl) continue
      const embedded = svgDataUrlWithFragment(dataUrl, `${cacheKey}${fragment}`)
      if ('href' in attrs) attrs.href = embedded
      if ('xlink:href' in attrs) attrs['xlink:href'] = embedded
      if (!('href' in attrs) && !('xlink:href' in attrs)) attrs.href = embedded
    } catch { /* old recordings retain the screenshot fallback */ }
  }


  // A video remains intentionally script-free in replay, but preserving a
  // small poster gives it a useful visual before the screenshot-region
  // fallback is applied.
  for (const node of nodes.filter(item => item.type === 2 && String(item.tagName).toLowerCase() === 'video' && item.attributes?.poster).slice(0, 20)) {
    const attrs = node.attributes || {}
    if (String(attrs.poster).startsWith('data:') || budget.remaining <= 0) continue
    try {
      const dataUrl = await loadAsset(new URL(String(attrs.poster), pageUrl).href, Math.min(6_000_000, budget.remaining))
      if (dataUrl) { attrs.poster = dataUrl; budget.remaining -= decodedDataUrlSize(dataUrl) }
    } catch { /* the visible screenshot region remains the fallback */ }
  }
  return snapshot
}

async function uploadStep(data: Record<string, any>, domSnapshot: Record<string, any> | undefined, screenshotOverride: string | undefined, state: Recording): Promise<{ id: string }> {
  if (!state.active || !state.screenshot) throw new Error('录制状态已结束')
  const response = await fetch(screenshotOverride || state.screenshot)
  const form = new FormData()
  form.append('meta', JSON.stringify({ ...data, ai_enabled: state.aiEnabled, recording_session_id: state.sessionId || undefined }))
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
  await uploadStep(data, snapshot, screenshotOverride, state)
  state.error = ''
  await persist(state); await notify(state)
}

async function captureAndQueueStep(data: Record<string, any>, snapshot: Record<string, any> | undefined, state: Recording, sourceTabId: number) {
  const sourceTab = await chrome.tabs.get(sourceTabId)
  if (!sourceTab.active || !state.trackedTabIds.includes(sourceTabId)) return { ignored: true, steps: state.steps }
  if (state.stepQuotaRemaining !== undefined && state.stepQuotaRemaining < 1) {
    const live = await loadCapabilities({ api: state.api, token: state.token }, '', state.demoId).catch(() => null)
    if (live) applyStepQuota(state, live)
    const quotaError = live && !quotaAllowed(live, 'record_step')
      ? quotaMessage(live, 'record_step', state.locale)
      : state.stepQuotaRemaining !== undefined && state.stepQuotaRemaining < 1 && state.stepQuotaLimit !== undefined
        ? quotaMetricMessage('max_steps_per_resource', state.stepQuotaLimit, state.stepQuotaLimit, state.locale)
        : ''
    if (quotaError) {
      await scheduleQuotaEnd(state, quotaError)
      return { quotaEnded: true, error: quotaError, steps: state.steps }
    }
  }
  state.activeTabId = sourceTabId
  state.capturing = true; state.phase = 'capturing'
  await persist(state); await notify(state)
  let captured: { screenshot: string; snapshot?: Record<string, any> }
  try {
    captured = await captureSynchronized(sourceTabId, state.mode === 'html')
  } catch (error) {
    state.capturing = false; state.phase = ''
    await persist(state); await notify(state)
    throw error
  }

  // The page can be released as soon as its pixels are captured. Asset
  // enrichment and upload continue in the background and never hold the
  // user's original click behind missing or slow page resources.
  state.steps += 1
  if (state.stepQuotaRemaining !== undefined) state.stepQuotaRemaining = Math.max(0, state.stepQuotaRemaining - 1)
  state.capturing = false; state.phase = ''
  await persist(state); await notify(state)
  const synchronizedSnapshot = state.mode === 'html' ? (captured.snapshot || snapshot) : undefined
  // Start immediately so same-page reads are dispatched before the replayed
  // click can navigate, but do not await them in the message response.
  const enrichment = state.mode === 'html'
    ? enrichSnapshot(synchronizedSnapshot, String(data.page_context?.url || ''), sourceTabId).catch(error => {
      console.warn('DocFlow snapshot enrichment:', error)
      return synchronizedSnapshot
    })
    : Promise.resolve(undefined)
  const task = queue.then(async () => recordStep(data, await enrichment, state, captured.screenshot))
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
  return `${auth?.web || state.web || configuredWebUrl}/demos/${state.demoId}`
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
    await completeRemoteSession(state)
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
      if (final?.data) {
        let finalSnapshot = state.mode === 'html' ? final.snapshot : undefined
        if (finalSnapshot) {
          try { finalSnapshot = await enrichSnapshot(finalSnapshot, String(final.data.page_context?.url || finalTab.url || ''), state.activeTabId) }
          catch (error) { console.warn('DocFlow final snapshot enrichment:', error) }
        }
        await uploadStep(final.data, finalSnapshot, await captureClean(state.activeTabId), state)
      }
    }
  } catch (error) { console.warn('DocFlow final slide:', error) }
  try {
    await completeRemoteSession(state)
  } catch (error) {
    state.capturing = false; state.phase = ''; state.error = (error as Error).message
    await persist(state); await notify(state)
    throw error
  }
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

async function cancelRecording() {
  const state = await restore()
  if (!state) { await chrome.storage.session.remove('recording'); return }
  state.paused = true; state.capturing = true; state.phase = 'uploading'; state.error = ''
  await persist(state); await notify(state)
  try {
    await queue.catch(() => {})
    if (state.sessionId) {
      const response = await fetch(`${state.api}/api/recordings/sessions/${state.sessionId}/cancel`, {
        method: 'POST', headers: { Authorization: `Bearer ${state.token}` },
      })
      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Could not cancel recording' }))
        throw new Error(String(error.detail || 'Could not cancel recording'))
      }
    } else {
      await deleteAutomaticDemo(state)
    }
    state.active = false; state.capturing = false; state.phase = ''
    await notify(state)
    recording = null
    await chrome.storage.session.remove('recording')
  } catch (error) {
    state.paused = false; state.capturing = false; state.phase = ''; state.error = (error as Error).message
    await persist(state); await notify(state)
    throw error
  }
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

async function createRecordingSession(auth: Credentials, demoId: string, mode: RecordingMode, aiEnabled: boolean, autoCreated: boolean) {
  const response = await fetch(`${auth.api}/api/recordings/${demoId}/sessions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, ai_enabled: aiEnabled, auto_created: autoCreated }),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Could not start recording session' }))
    throw new Error(String(error.detail || 'Could not start recording session'))
  }
  return response.json() as Promise<{ id: string }>
}

async function completeRemoteSession(state: Recording) {
  if (!state.sessionId) return
  const response = await fetch(`${state.api}/api/recordings/sessions/${state.sessionId}/complete`, {
    method: 'POST', headers: { Authorization: `Bearer ${state.token}` },
  })
  if (!response.ok) throw new Error('Could not complete recording session')
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
    aiContext: String(demo.ai_context || ''), createdAt: new Date().toISOString(),
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
      const identity = packageIdentity()
      const update = await checkExtensionUpdate(true)
      const auth = await connectedCredentials()
      if (!auth?.token) return { installed: true, connected: false, ...identity, update }
      const response = await fetch(`${auth.api}/api/extension/config`, { headers: { Authorization: `Bearer ${auth.token}` } }).catch(() => null)
      if (response?.ok) return { installed: true, connected: true, ...identity, update }
      if (response?.status === 401) await chrome.storage.local.remove(['credentials', 'pendingTarget'])
      return { installed: true, connected: false, ...identity, update }
    }
    if (message.type === 'CHECK_EXTENSION_UPDATE') return checkExtensionUpdate(Boolean(message.force))
    if (message.type === 'SET_TARGET_FROM_WEB') return selectTargetFromWeb(String(message.demoId || ''), sender)
    if (message.type === 'CLEAR_RECORDING_TARGET') {
      await chrome.storage.local.remove('pendingTarget')
      return { ok: true }
    }
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
      const stored = await chrome.storage.local.get('recordingPreferences')
      const current = (stored.recordingPreferences || {}) as Record<string, unknown>
      await chrome.storage.local.set({ recordingPreferences: {
        ...current,
        ...(typeof message.aiEnabled === 'boolean' ? { aiEnabled: message.aiEnabled } : {}),
        ...(message.contentLocale ? { contentLocale: message.contentLocale as Locale } : {}),
        ...(typeof message.privacyEnabled === 'boolean' ? { privacyEnabled: message.privacyEnabled } : {}),
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
        targetTitle: String(message.targetTitle || ''),
        aiAvailable: Boolean(message.aiAvailable), defaultMode: message.defaultMode || 'html',
        defaultAI: Boolean(message.defaultAI), defaultPrivacy: Boolean(message.defaultPrivacy), spaces: Array.isArray(message.spaces) ? message.spaces : [],
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
      const runtimeConfig = await loadExtensionRuntimeConfig(auth)
      await switchRecordingOrganization(auth, organizationId)
      let demoId = String(message.demoId || '')
      const live = await loadCapabilities(auth, organizationId, demoId)
      requireQuota(live, demoId ? 'record_step' : 'create_resource', uiLocale)
      requireQuota(live, 'record_step', uiLocale)
      if (message.aiEnabled) requireQuota(live, 'use_ai', uiLocale)
      let autoCreated = false
      let sessionId = ''
      if (!demoId) {
        demoId = (await createAutomaticDemo(auth, tab, contentLocale, uiLocale, aiContext)).id
        autoCreated = true
      } else {
        await validateRecordingTarget(auth, demoId)
      }
      try {
        sessionId = (await createRecordingSession(auth, demoId, message.mode || 'html', Boolean(message.aiEnabled), autoCreated)).id
        if (!autoCreated) await updateDemoAISettings(auth, demoId, contentLocale, aiContext)
        await begin(demoId, sessionId, message.mode, Boolean(message.aiEnabled), Boolean(message.privacyEnabled), runtimeConfig.capture_feedback_duration_ms, tab.id, message.locale || browserLocale(), contentLocale, autoCreated, live)
      } catch (error) {
        if (sessionId) {
          await fetch(`${auth.api}/api/recordings/sessions/${sessionId}/cancel`, {
            method: 'POST', headers: { Authorization: `Bearer ${auth.token}` },
          }).catch(() => null)
        } else if (autoCreated) {
          await fetch(`${auth.api}/api/demos/${demoId}`, {
            method: 'DELETE', headers: { Authorization: `Bearer ${auth.token}` },
          }).catch(() => null)
        }
        throw error
      }
      await chrome.storage.local.remove('pendingTarget')
      return { ok: true, demoId, sessionId, autoCreated, captureFeedbackDurationMs: runtimeConfig.capture_feedback_duration_ms }
    }
    if (message.type === 'ATTACH_CURRENT_TAB') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id || !isRecordableUrl(tab.url)) throw new Error('Please open a recordable business page first.')
      const state = await attachTab(tab.id, true)
      return state ? { active: true, trackedTabs: state.trackedTabIds.length } : { active: false }
    }
    if (message.type === 'PAUSE') { const state = await pause(); return state ? { active: true, paused: state.paused, steps: state.steps, mode: state.mode } : { active: false } }
    if (message.type === 'STOP') { await stop(message.open !== false); return { ok: true } }
    if (message.type === 'CANCEL') { await cancelRecording(); return { ok: true } }
    if (message.type === 'STATUS') {
      const state = await restore()
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      return state ? { active: state.active, paused: state.paused, capturing: state.capturing, phase: state.phase, steps: state.steps, demoId: state.demoId, mode: state.mode, aiEnabled: state.aiEnabled, privacyEnabled: state.privacyEnabled, captureFeedbackDurationMs: state.captureFeedbackDurationMs, locale: state.locale, contentLocale: state.contentLocale, trackedTabs: state.trackedTabIds.length, currentTabTracked: Boolean(tab?.id && state.trackedTabIds.includes(tab.id)) } : { active: false, steps: 0, trackedTabs: 0, currentTabTracked: false }
    }
    if (message.type === 'IS_RECORDING') {
      const state = await restore()
      return state?.active && Boolean(sender.tab?.id && state.trackedTabIds.includes(sender.tab.id))
        ? { active: true, paused: state.paused, capturing: state.capturing, phase: state.phase, steps: state.steps, mode: state.mode, aiEnabled: state.aiEnabled, privacyEnabled: state.privacyEnabled, captureFeedbackDurationMs: state.captureFeedbackDurationMs, locale: state.locale, contentLocale: state.contentLocale, trackedTabs: state.trackedTabIds.length }
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

chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === UPDATE_ALARM) void checkExtensionUpdate(true) })
chrome.runtime.onInstalled.addListener(() => { void initializeUpdateChecks() })
chrome.runtime.onStartup.addListener(() => { void initializeUpdateChecks() })
void initializeUpdateChecks()
