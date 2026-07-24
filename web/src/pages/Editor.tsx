import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { API_URL, ApiError, api } from '../api'
import { copyText } from '../clipboard'
import { formatDate } from '../i18n'
import Icon, { type IconName } from '../components/Icon'
import LanguageSwitcher from '../components/LanguageSwitcher'
import HelpLink from '../components/HelpLink'
import ShareLinkManager from '../components/ShareLinkManager'
import SlideStage from '../components/SlideStage'
import type { AnnotationTool } from '../components/AnnotationLayer'
import { useToast } from '../components/toast'
import { prepareExtensionRecording } from '../extensionBridge'
import { prepareScreenshot, ScreenshotPreparationError } from '../screenshotUpload'
import type { AIJob, AnnotationRect, Demo, ExportJob, HotspotData, Rect, SelectorInfo, Step } from '../types'
import type { QuotaActionKey, WorkspaceCapabilities } from '../workspace/types'
import { quotaAllowed, quotaGuardTitle } from '../quota/guards'
import QuotaGuard from '../components/quota/QuotaGuard'
import AddStepMenu from '../components/editor/AddStepMenu'
import useEditorHistory from '../editor/useEditorHistory'
import { resolveInspectorLayoutMode, type InspectorLayoutMode } from '../editor/inspectorLayout'

type InspectorTab = 'content' | 'hotspot' | 'tooltip' | 'annotations' | 'theme' | 'animation' | 'ai'
type CanvasMode = 'preview' | 'edit'
type DetailMode = 'present' | 'edit'
type ExportCenterAction = 'publish' | 'copy-share' | 'copy-markdown' | ExportJob['kind'] | null
type AIFieldChange = { before: unknown; after: unknown; applied: boolean }
type AIChangeReport = {
  demo?: { fields?: Record<string, AIFieldChange> }
  steps?: { id: string; position: number; fields: Record<string, AIFieldChange>; hotspots?: { id: string; tooltip: AIFieldChange }[]; warnings?: string[]; redundant?: boolean }[]
}

const InspectorLayoutContext = createContext<{
  mode: InspectorLayoutMode
  activeSection: string | null
  toggleSection: (section: string) => void
}>({ mode: 'expanded', activeSection: null, toggleSection: () => undefined })

const defaultTooltip = (locale = 'zh-CN') => ({ content: locale === 'en' ? 'Click here to continue' : '点击此处继续', placement: 'auto', alignment: 'center' as const, offset: 12, max_width: 320, show_arrow: true })
const defaultStyle = { shape: 'rectangle' as const, pulse: true, spotlight: false, padding: 6, color: '#635bff', overlay_opacity: .45 }
const inspectorTabs: { value: InspectorTab; icon: IconName }[] = [
  { value: 'content', icon: 'text' }, { value: 'hotspot', icon: 'target' },
  { value: 'tooltip', icon: 'edit' }, { value: 'annotations', icon: 'image' }, { value: 'theme', icon: 'palette' },
  { value: 'animation', icon: 'animation' }, { value: 'ai', icon: 'ai' },
]

function InspectorSection({ icon, title, description, children, tone = '' }: { icon: IconName; title: string; description?: string; children: ReactNode; tone?: 'danger' | '' }) {
  const { mode, activeSection, toggleSection } = useContext(InspectorLayoutContext)
  const collapsible = mode !== 'expanded'
  const expanded = !collapsible || activeSection === title
  const detailHidden = mode === 'detail' && activeSection !== null && !expanded
  const indicator = mode === 'detail' && expanded ? 'chevronLeft' : expanded ? 'arrowDown' : 'chevronRight'
  return <section className={`inspector-section ${tone} ${expanded ? 'expanded' : 'collapsed'} ${detailHidden ? 'detail-hidden' : ''}`}>
    <header><button type="button" className="inspector-section-heading" aria-expanded={expanded} onClick={() => collapsible && toggleSection(title)} tabIndex={collapsible ? 0 : -1}>
      <span className="section-icon"><Icon name={icon} /></span><span className="inspector-section-title"><strong>{title}</strong>{description && <small>{description}</small>}</span>
      {collapsible && <span className="inspector-section-indicator"><Icon name={indicator} size={14} /></span>}
    </button></header>
    {expanded && <div className="inspector-items">{children}</div>}
  </section>
}

function normalizedColor(value: string) {
  const color = value.trim()
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase()
  if (/^#[0-9a-f]{3}$/i.test(color)) return `#${color.slice(1).split('').map(char => char + char).join('')}`.toLowerCase()
  return null
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation('editor')
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    const color = normalizedColor(draft)
    if (color) { setDraft(color); onChange(color) } else setDraft(value)
  }
  return <label className="color-field"><span>{label}</span><div className="color-input-row">
    <span className="color-swatch" style={{ background: value }}><input aria-label={t('colorPicker', { label })} type="color" value={value} onChange={event => { setDraft(event.target.value); onChange(event.target.value) }} /></span>
    <input className="color-value" value={draft} maxLength={7} spellCheck={false} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} />
  </div></label>
}

function RangeField({ label, value, min, max, step = 1, suffix = '', onChange }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (value: number) => void }) {
  return <label className="range-field"><span>{label}<output>{value}{suffix}</output></span><input type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} /></label>
}

function NumberField({ label, value, min, max, step = 1, decimals, onCommit }: { label: string; value: number; min: number; max: number; step?: number; decimals?: number; onCommit: (value: number) => void }) {
  const display = useCallback((current: number) => decimals === undefined ? String(current) : current.toFixed(decimals), [decimals])
  const [draft, setDraft] = useState(() => display(value))
  useEffect(() => setDraft(display(value)), [display, value])
  const commit = () => {
    if (!draft.trim()) { setDraft(display(value)); return }
    const parsed = Number(draft)
    if (!Number.isFinite(parsed)) { setDraft(display(value)); return }
    const clamped = Math.min(max, Math.max(min, parsed))
    const normalized = decimals === undefined ? clamped : Number(clamped.toFixed(decimals))
    setDraft(display(normalized))
    if (normalized !== value) onCommit(normalized)
  }
  return <label>{label}<input type="number" min={min} max={max} step={step} value={draft} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => {
    if (event.key === 'Enter') event.currentTarget.blur()
    if (event.key === 'Escape') { event.preventDefault(); setDraft(display(value)) }
  }} /></label>
}

function AIFieldComparison({ label, change, originalLabel, generatedLabel, appliedLabel, retainedLabel, emptyLabel }: { label: string; change: AIFieldChange; originalLabel: string; generatedLabel: string; appliedLabel: string; retainedLabel: string; emptyLabel: string }) {
  const before = String(change.before ?? '').trim()
  const after = String(change.after ?? '').trim()
  return <article className="ai-change-field">
    <header><strong>{label}</strong><span className={change.applied ? 'applied' : 'retained'}>{change.applied ? appliedLabel : retainedLabel}</span></header>
    <div><section><small>{originalLabel}</small><p>{before || emptyLabel}</p></section><section><small>{generatedLabel}</small><p>{after || emptyLabel}</p></section></div>
  </article>
}

function visibleCaptureWarnings(warnings: string[] = []) {
  const legacyAudit = /^(removed unsafe|removed external|removed recorder or browser-extension|removed injected|Video playback is not included|Cross-origin iframe content may use a raster fallback|SVG icon resource could not be embedded)/i
  return warnings.filter(warning => !legacyAudit.test(warning))
}

function eventId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

const cloneValue = <T,>(value: T): T => structuredClone(value)
const sameValue = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
const previousValues = <T extends object>(source: T, values: Partial<T>) => Object.fromEntries(
  Object.keys(values).map(key => [key, cloneValue(source[key as keyof T])]),
) as Partial<T>

export default function Editor() {
  const { t, i18n } = useTranslation('editor')
  const toast = useToast()
  const { id = '' } = useParams()
  const [demo, setDemo] = useState<Demo | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedHotspotId, setSelectedHotspotId] = useState<string | null>(null)
  const [canvasMode, setCanvasMode] = useState<CanvasMode>('preview')
  const [detailMode, setDetailMode] = useState<DetailMode>(() => new URLSearchParams(window.location.search).get('mode') === 'edit' ? 'edit' : 'present')
  const [titleEditing, setTitleEditing] = useState(false)
  const [presentationReady, setPresentationReady] = useState(false)
  const [presentationHotspotIndex, setPresentationHotspotIndex] = useState(0)
  const [tab, setTab] = useState<InspectorTab>('content')
  const [annotationTool, setAnnotationTool] = useState<AnnotationTool>('mosaic')
  const [selectedAnnotationIndex, setSelectedAnnotationIndex] = useState<number | null>(null)
  const [addStepAfterId, setAddStepAfterId] = useState<string | null | undefined>(undefined)
  const [focusMode, setFocusMode] = useState(false)
  const [mobilePanel, setMobilePanel] = useState<'steps' | 'inspector' | null>(null)
  const [dockPosition, setDockPosition] = useState({ x: 16, y: 78 })
  const [panelPositions, setPanelPositions] = useState({
    steps: { x: 18, y: 82 },
    inspector: { x: Math.max(18, window.innerWidth - 378), y: 82 },
  })
  const [panelHeights, setPanelHeights] = useState<{ steps: number | null; inspector: number | null }>({ steps: null, inspector: null })
  const inspectorPanelRef = useRef<HTMLElement>(null)
  const stepUploadRef = useRef<HTMLInputElement>(null)
  const editOriginRef = useRef(new Map<string, unknown>())
  const [inspectorPanelHeight, setInspectorPanelHeight] = useState(window.innerHeight)
  const [activeInspectorSection, setActiveInspectorSection] = useState<string | null>(null)
  const [jobs, setJobs] = useState<ExportJob[]>([])
  const [aiJob, setAIJob] = useState<AIJob | null>(null)
  const [aiConfirmOpen, setAIConfirmOpen] = useState(false)
  const [aiMutation, setAIMutation] = useState<'revert' | 'reapply' | null>(null)
  const [exportCenterOpen, setExportCenterOpen] = useState(false)
  const [exportAction, setExportAction] = useState<ExportCenterAction>(null)
  const [loadError, setLoadError] = useState('')
  const [recorderBusy, setRecorderBusy] = useState(false)
  const [uploadBusy, setUploadBusy] = useState(false)
  const [capabilities, setCapabilities] = useState<WorkspaceCapabilities | null>(null)
  const history = useEditorHistory()
  const selected = useMemo(() => demo?.steps.find(step => step.id === selectedId) || demo?.steps[0], [demo, selectedId])
  const orderedSelectedHotspots = useMemo(() => [...(selected?.hotspots || [])].sort((a, b) => a.position - b.position), [selected?.hotspots])
  const selectedHotspot = useMemo(() => orderedSelectedHotspots.find(item => item.id === selectedHotspotId) || orderedSelectedHotspots[0], [orderedSelectedHotspots, selectedHotspotId])
  const selectedHotspotIndex = selectedHotspot ? orderedSelectedHotspots.findIndex(item => item.id === selectedHotspot.id) : -1
  const aiChangeReport = aiJob?.result?.changes as AIChangeReport | undefined
  const aiBusy = Boolean(aiJob && ['queued', 'running'].includes(aiJob.status))
  const inspectorLayoutMode: InspectorLayoutMode = resolveInspectorLayoutMode(inspectorPanelHeight)
  const defaultInspectorSection = useMemo(() => ({
    content: t('content.copyTitle'),
    hotspot: t('hotspot.objects'),
    tooltip: t('tooltip.copy'),
    annotations: t('annotations.title'),
    theme: t('theme.brand'),
    animation: t('animation.zoom'),
    ai: t('ai.generate'),
  })[tab], [tab, t])

  const refreshCapabilities = useCallback((force = false) => api.quotaCapabilities(id, undefined, { force }).then(value => { setCapabilities(value); return value }), [id])

  useEffect(() => {
    let active = true
    setLoadError('')
    api.demo(id).then(value => {
      if (!active) return
      setDemo(value); setSelectedId(value.steps[0]?.id || null); setSelectedHotspotId(value.steps[0]?.hotspots[0]?.id || null); history.clear()
    }).catch(value => { if (active) setLoadError(value.message) })
    api.latestAI(id).then(value => { if (active) setAIJob(value) }).catch(() => undefined)
    api.exports(id).then(value => { if (active) setJobs(value) }).catch(() => undefined)
    void refreshCapabilities().catch(() => undefined)
    return () => { active = false }
  }, [id, refreshCapabilities])
  useEffect(() => setSelectedAnnotationIndex(null), [selected?.id])
  useEffect(() => {
    if (addStepAfterId === undefined) return
    const close = (event: PointerEvent) => { if (!(event.target as HTMLElement | null)?.closest('.add-step-control')) setAddStepAfterId(undefined) }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setAddStepAfterId(undefined) }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', key) }
  }, [addStepAfterId])
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') void refreshCapabilities().catch(() => undefined) }
    const timer = window.setInterval(refresh, 60000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [refreshCapabilities])
  useEffect(() => {
    const panel = inspectorPanelRef.current
    if (!panel) return
    const measure = () => setInspectorPanelHeight(panel.getBoundingClientRect().height)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(panel)
    window.addEventListener('resize', measure)
    return () => { observer.disconnect(); window.removeEventListener('resize', measure) }
  }, [demo?.id])
  useEffect(() => {
    setActiveInspectorSection(inspectorLayoutMode === 'expanded' ? null : defaultInspectorSection)
  }, [tab, inspectorLayoutMode, defaultInspectorSection])
  useEffect(() => {
    const active = jobs.some(job => job.status === 'queued' || job.status === 'running')
    if (!active) return
    const timer = window.setInterval(async () => setJobs(await Promise.all(jobs.map(job => ['complete','failed','cancelled'].includes(job.status) ? job : api.export(job.id)))), 1500)
    return () => clearInterval(timer)
  }, [jobs])
  useEffect(() => {
    if (!aiJob || !['queued', 'running'].includes(aiJob.status)) return
    const timer = window.setInterval(async () => {
      const next = await api.aiJob(aiJob.id)
      setAIJob(next)
      if (next.status === 'complete') {
        const fresh = await api.demo(id); setDemo(fresh); void refreshCapabilities(true); toast.success(t('messages.aiComplete'), { dedupeKey: next.id })
      }
      if (next.status === 'failed' || next.status === 'cancelled') toast.error(next.error_code ? t(`common:errors.codes.${next.error_code}`) : t('messages.aiFailed'), { dedupeKey: next.id, persistent: next.status === 'failed', action: { label: t('common:actions.view'), href: '/tasks' } })
    }, 1800)
    return () => clearInterval(timer)
  }, [aiJob?.id, aiJob?.status, id])

  async function guardQuota(action: QuotaActionKey) {
    let live = capabilities
    try { live = await refreshCapabilities(true) } catch { /* mutation API remains authoritative */ }
    if (quotaAllowed(live, action)) return true
    toast.warning(quotaGuardTitle(live, action, t, i18n.language))
    return false
  }

  const can = (action: QuotaActionKey) => quotaAllowed(capabilities, action)
  const quotaTitle = (action: QuotaActionKey) => quotaGuardTitle(capabilities, action, t, i18n.language)
  const rememberEditOrigin = (key: string, value: unknown) => { if (!editOriginRef.current.has(key)) editOriginRef.current.set(key, cloneValue(value)) }
  const takeEditOrigin = <T,>(key: string, fallback: T): T => {
    const value = editOriginRef.current.get(key) as T | undefined
    editOriginRef.current.delete(key)
    return value === undefined ? fallback : value
  }
  const selectInspectorTab = (value: InspectorTab) => {
    setTab(value)
    if (value === 'animation' || value === 'annotations') setCanvasMode('edit')
  }
  useEffect(() => {
    if (detailMode !== 'present' || !demo || !presentationReady) return
    const handler = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.matches('input, textarea, select')) return
      const index = demo.steps.findIndex(step => step.id === selected?.id)
      if (event.key === 'ArrowRight') forwardPresentation()
      if (event.key === 'ArrowLeft') previousPresentation()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [detailMode, demo, selected?.id, presentationHotspotIndex, presentationReady])
  useEffect(() => {
    if (detailMode !== 'edit') return
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return
      if (!(event.metaKey || event.ctrlKey)) return
      const key = event.key.toLowerCase()
      if (key === 'z' && event.shiftKey) { event.preventDefault(); void history.redo() }
      else if (key === 'z') { event.preventDefault(); void history.undo() }
      else if (key === 'y') { event.preventDefault(); void history.redo() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [detailMode, history.undo, history.redo])
  useEffect(() => {
    if (detailMode !== 'present' || !demo || !selected || !presentationReady || !demo.playback?.autoplay) return
    if (demo.steps.length < 2 && !(selected.hotspot_mode === 'sequence' && selected.hotspots.length > 1)) return
    const duration = Math.max(250, Math.min(60000, Number(demo.playback.step_duration_ms) || 2000))
    const delay = Math.max(0, Math.min(30000, Number(demo.playback.transition_delay_ms) || 0))
    const index = demo.steps.findIndex(step => step.id === selected.id)
    const timer = window.setTimeout(() => {
      const hotspots = [...selected.hotspots].sort((a, b) => a.position - b.position)
      const atSequenceEnd = selected.hotspot_mode !== 'sequence' || presentationHotspotIndex >= Math.max(0, hotspots.length - 1)
      if (index >= demo.steps.length - 1 && atSequenceEnd) {
        if (demo.playback?.loop) selectPresentationStep(0)
      } else forwardPresentation()
    }, duration + delay)
    return () => window.clearTimeout(timer)
  }, [detailMode, demo, selected?.id, presentationHotspotIndex, presentationReady])

  async function applyDemoPatch(values: Partial<Demo>) {
    setDemo(current => current ? { ...current, ...values } : current)
    try { setDemo(await api.updateDemo(id, values)) }
    catch (value) { toast.error((value as Error).message); throw value }
  }
  async function patchDemo(values: Partial<Demo>, beforeOverride?: Partial<Demo>) {
    if (!demo) return
    const before = beforeOverride || previousValues(demo, values)
    try {
      await applyDemoPatch(values)
      if (!sameValue(before, values)) history.record({
        label: t('history.demo'),
        undo: () => applyDemoPatch(cloneValue(before)),
        redo: () => applyDemoPatch(cloneValue(values)),
      })
    } catch { /* apply helper already notified the user */ }
  }
  async function applyStepPatch(stepId: string, values: Partial<Step>) {
    setDemo(current => current ? { ...current, steps: current.steps.map(step => step.id === stepId ? { ...step, ...values } : step) } : current)
    try {
      const updated = await api.updateStep(id, stepId, values)
      setDemo(current => current ? { ...current, steps: current.steps.map(step => step.id === stepId ? updated : step) } : current)
    } catch (value) { toast.error((value as Error).message); throw value }
  }
  async function patchStep(stepId: string, values: Partial<Step>, beforeOverride?: Partial<Step>) {
    const source = demo?.steps.find(step => step.id === stepId)
    if (!source) return
    const before = beforeOverride || previousValues(source, values)
    try {
      await applyStepPatch(stepId, values)
      if (!sameValue(before, values)) history.record({
        label: t('history.step'),
        undo: () => applyStepPatch(stepId, cloneValue(before)),
        redo: () => applyStepPatch(stepId, cloneValue(values)),
      })
    } catch { /* apply helper already notified the user */ }
  }
  function updateStepLocal(stepId: string, values: Partial<Step>) {
    setDemo(current => current ? { ...current, steps: current.steps.map(step => step.id === stepId ? { ...step, ...values } : step) } : current)
  }
  function updateHotspotLocal(values: Partial<HotspotData>, target = selectedHotspot) {
    if (!selected || !target) return
    setDemo(current => current ? { ...current, steps: current.steps.map(step => step.id === selected.id ? { ...step, hotspots: step.hotspots.map(item => item.id === target.id ? { ...item, ...values } : item) } : step) } : current)
  }
  async function applyHotspotPatch(stepId: string, hotspotId: string, values: Partial<HotspotData>) {
    setDemo(current => current ? { ...current, steps: current.steps.map(step => step.id === stepId ? { ...step, hotspots: step.hotspots.map(item => item.id === hotspotId ? { ...item, ...values } : item) } : step) } : current)
    try {
      const updated = await api.updateHotspot(id, stepId, hotspotId, values)
      setDemo(current => current ? { ...current, steps: current.steps.map(step => step.id === stepId ? { ...step, hotspots: step.hotspots.map(item => item.id === hotspotId ? updated : item) } : step) } : current)
      setSelectedHotspotId(current => current === hotspotId ? updated.id : current)
    } catch (value) { toast.error((value as Error).message); throw value }
  }
  async function patchHotspot(values: Partial<HotspotData>, target = selectedHotspot, beforeOverride?: Partial<HotspotData>) {
    if (!selected || !target) return
    const stepId = selected.id
    const before = beforeOverride || previousValues(target, values)
    try {
      await applyHotspotPatch(stepId, target.id, values)
      if (!sameValue(before, values)) history.record({
        label: t('history.hotspot'),
        undo: () => applyHotspotPatch(stepId, target.id, cloneValue(before)),
        redo: () => applyHotspotPatch(stepId, target.id, cloneValue(values)),
      })
    } catch { /* apply helper already notified the user */ }
  }
  async function chooseTarget(selection: { selector: SelectorInfo; rect: Rect }) {
    if (!selected) return
    if (selectedHotspot) {
      await patchHotspot({ selector: selection.selector, fallback_rect: selection.rect })
    } else {
      const created = await api.createHotspot(id, selected.id, { selector: selection.selector, fallback_rect: selection.rect, trigger: 'click', action: { type: 'next' }, tooltip: defaultTooltip(demo?.content_locale), style: defaultStyle })
      setDemo(current => current ? { ...current, steps: current.steps.map(step => step.id === selected.id ? { ...step, hotspots: [...step.hotspots, created] } : step) } : current)
      setSelectedHotspotId(created.id)
    }
    setTab('hotspot')
  }
  async function addHotspot() {
    if (!selected) return
    const stepId = selected.id
    const payload = { selector: {}, fallback_rect: { x: .5, y: .5, w: .08, h: .06 }, trigger: 'click' as const, action: { type: 'next' as const }, tooltip: defaultTooltip(demo?.content_locale), style: defaultStyle }
    try {
      const created = await api.createHotspot(id, stepId, payload)
      let hotspotId = created.id
      const refresh = async (selectId?: string) => {
        const fresh = await api.demo(id); setDemo(fresh)
        setSelectedHotspotId(selectId || fresh.steps.find(step => step.id === stepId)?.hotspots[0]?.id || null)
      }
      await refresh(hotspotId); setTab('hotspot'); setCanvasMode('edit')
      history.record({
        label: t('history.addHotspot'),
        undo: async () => { await api.deleteHotspot(id, stepId, hotspotId); await refresh() },
        redo: async () => { hotspotId = (await api.createHotspot(id, stepId, payload)).id; await refresh(hotspotId) },
      })
    } catch (value) { toast.error((value as Error).message) }
  }
  async function deleteSelectedHotspot() {
    if (!selected || !selectedHotspot) return
    const stepId = selected.id
    const payload = {
      selector: cloneValue(selectedHotspot.selector), fallback_rect: cloneValue(selectedHotspot.fallback_rect),
      trigger: selectedHotspot.trigger, action: cloneValue(selectedHotspot.action), tooltip: cloneValue(selectedHotspot.tooltip), style: cloneValue(selectedHotspot.style),
    }
    let hotspotId = selectedHotspot.id
    const refresh = async (selectId?: string) => {
      const fresh = await api.demo(id); setDemo(fresh)
      setSelectedHotspotId(selectId || fresh.steps.find(step => step.id === stepId)?.hotspots[0]?.id || null)
    }
    try {
      await api.deleteHotspot(id, stepId, hotspotId)
      await refresh()
      history.record({
        label: t('history.deleteHotspot'),
        undo: async () => { hotspotId = (await api.createHotspot(id, stepId, payload)).id; await refresh(hotspotId) },
        redo: async () => { await api.deleteHotspot(id, stepId, hotspotId); await refresh() },
      })
    } catch (value) {
      toast.error(value instanceof Error ? value.message : t('common:errors.operationFailed'))
    }
  }
  async function moveHotspot(item: HotspotData, offset: number) {
    if (!selected) return
    const ordered = [...selected.hotspots].sort((a, b) => a.position - b.position)
    const from = ordered.findIndex(value => value.id === item.id)
    const target = from + offset
    if (from < 0 || target < 0 || target >= ordered.length) return
    try {
      await api.updateHotspot(id, selected.id, item.id, { position: target })
      const fresh = await api.demo(id)
      setDemo(fresh)
      setSelectedHotspotId(item.id)
    } catch (value) { toast.error((value as Error).message) }
  }
  async function move(stepId: string, offset: number) {
    if (!demo) return
    const steps = [...demo.steps], from = steps.findIndex(step => step.id === stepId), to = from + offset
    if (to < 0 || to >= steps.length) return
    const before = steps.map(step => step.id)
    ;[steps[from], steps[to]] = [steps[to], steps[from]]
    const after = steps.map(step => step.id)
    try {
      setDemo(await api.reorder(id, after))
      history.record({
        label: t('history.reorder'),
        undo: async () => setDemo(await api.reorder(id, before)),
        redo: async () => setDemo(await api.reorder(id, after)),
      })
    } catch (value) { toast.error((value as Error).message) }
  }
  async function duplicateStep(stepId: string) {
    if (!demo) return
    try {
      const duplicate = await api.duplicateStep(id, stepId)
      let duplicateId = duplicate.id
      const refresh = async (selectId?: string) => {
        const fresh = await api.demo(id); setDemo(fresh)
        if (selectId) { setSelectedId(selectId); setSelectedHotspotId(fresh.steps.find(step => step.id === selectId)?.hotspots[0]?.id || null) }
      }
      await refresh(duplicateId)
      history.record({
        label: t('history.duplicateStep'),
        undo: async () => { await api.deleteStep(id, duplicateId); await refresh(stepId) },
        redo: async () => { duplicateId = (await api.duplicateStep(id, stepId)).id; await refresh(duplicateId) },
      })
      setAddStepAfterId(undefined)
      toast.success(t('messages.stepDuplicated'))
    } catch (value) { toast.error((value as Error).message) }
  }
  async function uploadFiles(files: File[], afterStepId: string | null) {
    if (uploadBusy || !files.length || !demo) return
    if (!await guardQuota('record_step')) return
    setUploadBusy(true)
    try {
      const created: Step[] = []
      for (const file of files) {
        const screenshot = await prepareScreenshot(file)
        const meta = { event_id: eventId(), title: t('steps.step', { index: demo.steps.length + created.length + 1 }), body: '', viewport_width: screenshot.width, viewport_height: screenshot.height, hotspot: { x: .5, y: .5, w: .04, h: .04 }, duration: 3 }
        const form = new FormData(); form.append('meta', JSON.stringify(meta)); form.append('screenshot', screenshot.file)
        created.push(await api.uploadStep(id, form))
      }
      const ordered = demo.steps.map(step => step.id)
      const insertAt = afterStepId ? Math.max(0, ordered.indexOf(afterStepId) + 1) : 0
      ordered.splice(insertAt, 0, ...created.map(step => step.id))
      const fresh = await api.reorder(id, ordered)
      setDemo(fresh); setSelectedId(created[0].id); setSelectedHotspotId(created[0].hotspots[0]?.id || null)
      setAddStepAfterId(undefined)
      void refreshCapabilities(true)
      toast.success(t(created.length > 1 ? 'messages.screenshotsAdded' : 'messages.screenshotAdded', { count: created.length }))
    } catch (value) {
      api.demo(id).then(setDemo).catch(() => undefined)
      if (value instanceof ScreenshotPreparationError) toast.error(t(value.code === 'too_large' ? 'messages.screenshotTooLarge' : 'messages.screenshotInvalid'))
      else if (value instanceof ApiError && value.status === 413) toast.error(t('messages.screenshotTooLarge'))
      else toast.error(t('messages.screenshotUploadFailed'))
    } finally {
      setUploadBusy(false)
    }
  }
  async function publish() {
    if (exportAction) return
    if (!await guardQuota('publish')) return
    setExportAction('publish')
    try { setDemo(await api.publish(id)); void refreshCapabilities(true); toast.success(t('messages.published')) }
    catch (value) { toast.error((value as Error).message) }
    finally { setExportAction(null) }
  }
  async function copyMarkdown() {
    if (!demo?.share_url || exportAction) return
    setExportAction('copy-markdown')
    try {
      const token = demo.share_url.split('/').pop(), response = await fetch(`${API_URL}/public/${token}/markdown`)
      if (!response.ok) throw new Error(t('messages.markdownFailed', { status: response.status }))
      await copyText(await response.text()); toast.success(t('messages.markdownCopied'))
    } catch (value) { toast.error((value as Error).message) }
    finally { setExportAction(null) }
  }
  async function copyShareLink() {
    if (!demo?.share_url || exportAction) return
    setExportAction('copy-share')
    try {
      await copyText(demo.share_url)
      toast.success(t('messages.shareCopied'))
    } catch (value) { toast.error((value as Error).message) }
    finally { setExportAction(null) }
  }
  async function startExport(kind: ExportJob['kind']) {
    if (exportAction) return
    if (!await guardQuota('publish')) return
    setExportAction(kind)
    try {
      // Export the current editor state instead of a potentially stale
      // published revision, so timing/Zoom changes take effect immediately.
      setDemo(await api.publish(id))
      const live = await refreshCapabilities(true)
      const quotaAction = kind === 'mp4' ? 'export_video' : 'export'
      if (!quotaAllowed(live, quotaAction)) {
        toast.warning(quotaGuardTitle(live, quotaAction, t, i18n.language))
        return
      }
      const job = await api.createExport(id, kind)
      setJobs(current => [job, ...current.filter(item => item.kind !== kind)])
      void refreshCapabilities(true)
      toast.task(t('messages.exportCreated'), { dedupeKey: job.id, action: { label: t('common:actions.view'), href: '/tasks' } })
    } catch (value) { toast.error((value as Error).message) }
    finally { setExportAction(null) }
  }
  async function generateAI(stepId?: string) {
    if (!await guardQuota('use_ai')) return
    try { const job = await api.generateAI(id, stepId); setAIJob(job); setTab('ai'); void refreshCapabilities(true); toast.task(t('workspace:toast.aiSubmitted'), { dedupeKey: job.id, action: { label: t('common:actions.view'), href: '/tasks' } }) } catch (value) { toast.error((value as Error).message) }
  }
  async function mutateAI(kind: 'revert' | 'reapply') {
    if (!aiJob || aiMutation) return
    setAIMutation(kind)
    try {
      const next = kind === 'revert' ? await api.revertAI(aiJob.id) : await api.reapplyAI(aiJob.id)
      setAIJob(next)
      setDemo(await api.demo(id))
      toast.success(t(kind === 'revert' ? 'ai.revertSuccess' : 'ai.reapplySuccess'))
    } catch (value) { toast.error((value as Error).message) }
    finally { setAIMutation(null) }
  }
  async function prepareRecorder() {
    if (!demo || recorderBusy) return
    if (!await guardQuota('record_step')) return
    setRecorderBusy(true)
    try { await prepareExtensionRecording(demo.id); toast.success(t('messages.recorderReady')) }
    catch (value) { toast.error((value as Error).message === 'extension_not_detected' ? t('messages.extensionNotDetected') : t('messages.recorderFailed')) }
    finally { setRecorderBusy(false) }
  }

  function selectPresentationStep(index: number) {
    if (!demo?.steps.length || !presentationReady) return
    const target = demo.steps[Math.max(0, Math.min(demo.steps.length - 1, index))]
    if (!target || target.id === selected?.id) return
    setPresentationReady(false)
    setPresentationHotspotIndex(0)
    setSelectedId(target.id)
    setSelectedHotspotId(target.hotspots[0]?.id || null)
  }

  function activatePresentation(hotspot: HotspotData) {
    if (!demo || !selected) return
    const index = demo.steps.findIndex(step => step.id === selected.id)
    const ordered = [...selected.hotspots].sort((a, b) => a.position - b.position)
    const currentHotspotIndex = Math.max(0, ordered.findIndex(item => item.id === hotspot.id))
    if (hotspot.action.type === 'goto' && hotspot.action.target_step_id) {
      const target = demo.steps.findIndex(step => step.id === hotspot.action.target_step_id)
      if (target >= 0) selectPresentationStep(target)
      return
    }
    if (hotspot.action.type === 'link' && hotspot.action.url) {
      window.open(hotspot.action.url, '_blank', 'noopener,noreferrer')
      return
    }
    if (hotspot.action.type === 'end') {
      selectPresentationStep(demo.steps.length - 1)
      return
    }
    if (selected.hotspot_mode === 'sequence' && currentHotspotIndex < ordered.length - 1) {
      setPresentationHotspotIndex(currentHotspotIndex + 1)
      return
    }
    selectPresentationStep(index + 1)
  }

  function previousPresentation() {
    if (!demo || !selected || !presentationReady) return
    if (selected.hotspot_mode === 'sequence' && presentationHotspotIndex > 0) {
      setPresentationHotspotIndex(value => Math.max(0, value - 1))
      return
    }
    selectPresentationStep(demo.steps.findIndex(step => step.id === selected.id) - 1)
  }

  function forwardPresentation() {
    if (!demo || !selected || !presentationReady) return
    const ordered = [...selected.hotspots].sort((a, b) => a.position - b.position)
    if (selected.hotspot_mode === 'sequence' && ordered[presentationHotspotIndex]) {
      activatePresentation(ordered[presentationHotspotIndex])
      return
    }
    selectPresentationStep(demo.steps.findIndex(step => step.id === selected.id) + 1)
  }

  function finishTitleEditing() {
    if (!demo) return
    const title = demo.title.trim() || t('untitled')
    setTitleEditing(false)
    setDemo({ ...demo, title })
    patchDemo({ title })
  }

  function defaultZoomRect(step: Step): Rect {
    const hotspot = step.hotspots[0]?.fallback_rect
    if (!hotspot) return { x: .5, y: .5, w: .5, h: .5 }
    const w = Math.min(.9, Math.max(.32, hotspot.w * 3.5))
    const h = Math.min(.9, Math.max(.28, hotspot.h * 4))
    return {
      x: Math.max(w / 2, Math.min(1 - w / 2, hotspot.x)),
      y: Math.max(h / 2, Math.min(1 - h / 2, hotspot.y)),
      w, h,
    }
  }

  function setZoomRect(step: Step, rect: Rect) {
    patchStep(step.id, {
      animation: {
        ...(step.animation || {}),
        zoom: { ...(step.animation?.zoom || {}), enabled: true, duration_ms: step.animation?.zoom?.duration_ms || 3000, transition_duration_ms: step.animation?.zoom?.transition_duration_ms ?? 1200, rect },
      },
    })
  }

  function dragDock(event: React.PointerEvent<HTMLSpanElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    const start = { clientX: event.clientX, clientY: event.clientY, dockX: dockPosition.x, dockY: dockPosition.y }
    const move = (next: PointerEvent) => setDockPosition({
      x: Math.max(8, Math.min(window.innerWidth - 260, start.dockX + next.clientX - start.clientX)),
      y: Math.max(66, Math.min(window.innerHeight - 58, start.dockY + next.clientY - start.clientY)),
    })
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop)
  }

  function dragFloatingPanel(kind: 'steps' | 'inspector', event: React.PointerEvent<HTMLSpanElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    const panel = event.currentTarget.closest('aside')
    const width = panel?.getBoundingClientRect().width || (kind === 'steps' ? 240 : 360)
    const start = { clientX: event.clientX, clientY: event.clientY, ...panelPositions[kind] }
    const move = (next: PointerEvent) => setPanelPositions(current => ({ ...current, [kind]: {
      x: Math.max(8, Math.min(window.innerWidth - width - 8, start.x + next.clientX - start.clientX)),
      y: Math.max(66, Math.min(window.innerHeight - 180, start.y + next.clientY - start.clientY)),
    } }))
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop)
  }

  function resizeFloatingPanel(kind: 'steps' | 'inspector', event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const panel = event.currentTarget.closest('aside')
    const startY = event.clientY
    const startHeight = panel?.getBoundingClientRect().height || (kind === 'steps' ? 500 : 560)
    const move = (next: PointerEvent) => {
      const availableHeight = Math.max(140, window.innerHeight - panelPositions[kind].y - 12)
      const minHeight = Math.min(240, availableHeight)
      const height = Math.max(minHeight, Math.min(availableHeight, startHeight + next.clientY - startY))
      setPanelHeights(current => ({ ...current, [kind]: height }))
    }
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop)
  }

  function floatingPanelStyle(kind: 'steps' | 'inspector'): CSSProperties | undefined {
    if (!focusMode || mobilePanel !== kind) return undefined
    const position = panelPositions[kind]
    const defaultHeight = kind === 'steps' ? 500 : 560
    const availableHeight = `calc(100dvh - ${position.y + 12}px)`
    const resizedHeight = panelHeights[kind]
    return {
      left: position.x,
      right: 'auto',
      top: position.y,
      bottom: 'auto',
      height: resizedHeight === null
        ? `min(${defaultHeight}px, 68dvh, ${availableHeight})`
        : `min(${resizedHeight}px, ${availableHeight})`,
      minHeight: `min(240px, ${availableHeight})`,
      maxHeight: availableHeight,
    }
  }

  if (!demo) return <main className="page"><Link to="/">{t('common:actions.back')}</Link><div className="center-page">{loadError || t('common:status.loading')}</div></main>
  const presentationIndex = Math.max(0, demo.steps.findIndex(step => step.id === selected?.id))
  const actionBusy = exportAction !== null
  const pendingExportKind = exportAction === 'pdf' || exportAction === 'mp4' || exportAction === 'markdown' ? exportAction : null
  const displayAIWarning = (warning: string) => {
    if (/\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(warning)) return t('ai.internalAddressRisk')
    if (/\b(?:admin|administrator|root)\b/i.test(warning)) return t('ai.accountRisk')
    if (/(?:password|passwd|token|secret|密码|口令|密钥)/i.test(warning)) return t('ai.credentialRisk')
    return warning
  }
  return <main className={`editor-page ${detailMode === 'present' ? 'presentation-mode' : 'editing-mode'} ${focusMode ? 'focus-editing' : ''} ${mobilePanel ? `mobile-panel-${mobilePanel}` : ''}`}>
    <div className="editor-topbar">
      <div className="editor-context"><Link to="/" className="back">{t('top.back')}</Link><span className={`status ${demo.status}`}><i />{t(`common:status.${demo.status}`)}</span></div>
      <div className={`editor-title ${titleEditing ? 'editing' : ''}`}>
        {titleEditing
          ? <input autoFocus aria-label={t('top.demoName')} value={demo.title} maxLength={200} onChange={event => setDemo({ ...demo, title: event.target.value })} onBlur={finishTitleEditing} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} />
          : <button title={t('top.editTitle')} onClick={() => setTitleEditing(true)}><strong>{demo.title}</strong><Icon name="edit" size={14} /></button>}
      </div>
      <div className="toolbar-actions">
        {detailMode === 'present' ? <>
          <button className="topbar-action icon-button" onClick={() => { setDetailMode('edit'); setCanvasMode('preview'); window.history.replaceState(null, '', `${window.location.pathname}?mode=edit`) }}><Icon name="edit" />{t('common:actions.edit')}</button>
          <button className="topbar-action icon-button compact-action" title={t('top.fullscreen')} onClick={() => document.documentElement.requestFullscreen()}><Icon name="layout" /></button>
        </> : <><button className="topbar-action icon-button" onClick={() => { setDetailMode('present'); setCanvasMode('preview'); setPresentationReady(false); setPresentationHotspotIndex(0); window.history.replaceState(null, '', window.location.pathname) }}><Icon name="play" />{t('top.present')}</button><button className={`topbar-action icon-button ${focusMode ? 'active' : ''}`} onClick={() => { setFocusMode(value => !value); setMobilePanel(null) }} title={t(focusMode ? 'mobileDock.exitFocus' : 'mobileDock.focus')}><Icon name="layout" />{t(focusMode ? 'mobileDock.exitFocus' : 'mobileDock.focus')}</button></>}
        {demo.share_url && <a className="topbar-action button icon-button compact-action" href={demo.share_url} target="_blank" rel="noreferrer" title={t('top.publicLink')}><Icon name="share" /></a>}
        {detailMode === 'edit' && <QuotaGuard message={!can('record_step') ? quotaTitle('record_step') : ''}><button className="topbar-action icon-button" disabled={recorderBusy || !can('record_step')} onClick={prepareRecorder}>{recorderBusy ? <span className="action-spinner" /> : <Icon name="record" />}{t(recorderBusy ? 'top.preparingRecorder' : 'top.continueRecording')}</button></QuotaGuard>}
        {detailMode === 'edit' && demo.ai_enabled && <QuotaGuard message={!can('use_ai') ? quotaTitle('use_ai') : ''}><button className="topbar-action icon-button" disabled={!can('use_ai') || aiBusy} onClick={() => setAIConfirmOpen(true)}><Icon name="ai" />{t('top.aiOptimize')}</button></QuotaGuard>}
        <LanguageSwitcher account /><HelpLink/>
        <button className={`primary icon-button publish-action ${exportCenterOpen ? 'active' : ''} ${actionBusy ? 'action-pending' : ''}`} aria-busy={actionBusy} disabled={actionBusy} onClick={() => setExportCenterOpen(value => !value)}>{actionBusy ? <span className="action-spinner" /> : <Icon name="share" />}{actionBusy ? t('top.processing') : t('top.shareExport')}</button>
      </div>
    </div>
    {exportCenterOpen && <div className="export-center-layer" onMouseDown={() => setExportCenterOpen(false)}>
      <aside className="export-center" onMouseDown={event => event.stopPropagation()}>
        <header className="export-center-header">
          <span className="export-center-icon"><Icon name="share" size={18} /></span>
          <div><strong>{t('export.title')}</strong><small>{t('export.subtitle')}</small></div>
          <button aria-label={t('common:actions.close')} onClick={() => setExportCenterOpen(false)}>×</button>
        </header>
        <div className="export-center-scroll">
          <section className="export-resource-summary">
            <div className="export-section-heading"><span><Icon name="text" />{t('export.resource')}</span><span className={`status ${demo.status}`}><i />{t(`common:status.${demo.status}`)}</span></div>
            <label>{t('export.description')}<textarea value={demo.description} onFocus={() => rememberEditOrigin('demo.description', demo.description)} onChange={event => setDemo({ ...demo, description: event.target.value })} onBlur={() => patchDemo({ description: demo.description }, { description: takeEditOrigin('demo.description', demo.description) })} placeholder={t('export.descriptionPlaceholder')} /></label>
            <label>{t('common:contentLanguage.label')}<select value={demo.content_locale} onChange={event => patchDemo({ content_locale: event.target.value as Demo['content_locale'] })}><option value="zh-CN">{t('common:contentLanguage.zh-CN')}</option><option value="en">{t('common:contentLanguage.en')}</option></select><small>{t('common:contentLanguage.description')}</small></label>
          </section>

          <section>
            <div className="export-section-heading"><span><Icon name="link" />{t('export.shareLink')}</span></div>
            {demo.share_url ? <div className="share-link-card"><span title={demo.share_url}>{demo.share_url}</span><button className={`icon-button ${exportAction === 'copy-share' ? 'action-pending' : ''}`} aria-busy={exportAction === 'copy-share'} disabled={actionBusy} onClick={copyShareLink}>{exportAction === 'copy-share' ? <span className="action-spinner" /> : <Icon name="copy" />}{exportAction === 'copy-share' ? t('export.copying') : t('common:actions.copy')}</button><a className="icon-button" href={demo.share_url} target="_blank" rel="noreferrer"><Icon name="play" />{t('common:actions.open')}</a></div> : <div className="export-empty-note"><Icon name="link" /><span>{t('export.unpublished')}</span></div>}
            <QuotaGuard fill message={!can('publish') ? quotaTitle('publish') : ''}><button className={`publish-version-button icon-button ${exportAction === 'publish' ? 'action-pending' : ''}`} aria-busy={exportAction === 'publish'} disabled={actionBusy || !can('publish')} onClick={publish}>{exportAction === 'publish' ? <span className="action-spinner" /> : <Icon name="publish" />}{exportAction === 'publish' ? t('export.publishing') : demo.status === 'published' ? t('export.updatePublished') : t('export.publishCreate')}</button></QuotaGuard>
            <ShareLinkManager demo={demo} capabilities={capabilities} onQuotaChanged={() => void refreshCapabilities(true)}/>
          </section>

          <section>
            <div className="export-section-heading"><span><Icon name="download" />{t('export.formats')}</span><small>{t('export.syncHint')}</small></div>
            <div className="export-format-grid">
              <QuotaGuard fill message={!can('export') ? quotaTitle('export') : ''}><button className={exportAction === 'pdf' ? 'action-pending' : ''} aria-busy={exportAction === 'pdf'} disabled={actionBusy || !demo.steps.length || !can('export')} onClick={() => startExport('pdf')}><span><Icon name="text" /></span><div><strong>{exportAction === 'pdf' ? t('export.creatingPdf') : 'PDF'}</strong><small>{exportAction === 'pdf' ? t('export.syncing') : t('export.pdfHint')}</small></div>{exportAction === 'pdf' ? <i className="action-spinner" /> : <Icon name="download" />}</button></QuotaGuard>
              <QuotaGuard fill message={!can('export_video') ? quotaTitle('export_video') : ''}><button className={exportAction === 'mp4' ? 'action-pending' : ''} aria-busy={exportAction === 'mp4'} disabled={actionBusy || !demo.steps.length || !can('export_video')} onClick={() => startExport('mp4')}><span><Icon name="play" /></span><div><strong>{exportAction === 'mp4' ? t('export.creatingVideo') : t('export.video')}</strong><small>{exportAction === 'mp4' ? t('export.syncing') : t('export.videoHint')}</small></div>{exportAction === 'mp4' ? <i className="action-spinner" /> : <Icon name="download" />}</button></QuotaGuard>
              <QuotaGuard fill message={!can('export') ? quotaTitle('export') : ''}><button className={exportAction === 'markdown' ? 'action-pending' : ''} aria-busy={exportAction === 'markdown'} disabled={actionBusy || !demo.steps.length || !can('export')} onClick={() => startExport('markdown')}><span><Icon name="image" /></span><div><strong>{exportAction === 'markdown' ? t('export.creatingPackage') : t('export.package')}</strong><small>{exportAction === 'markdown' ? t('export.syncing') : t('export.packageHint')}</small></div>{exportAction === 'markdown' ? <i className="action-spinner" /> : <Icon name="download" />}</button></QuotaGuard>
              <button className={exportAction === 'copy-markdown' ? 'action-pending' : ''} aria-busy={exportAction === 'copy-markdown'} disabled={actionBusy || !demo.share_url} onClick={copyMarkdown}><span><Icon name="copy" /></span><div><strong>{exportAction === 'copy-markdown' ? t('export.copyingMarkdown') : t('export.copyMarkdown')}</strong><small>{exportAction === 'copy-markdown' ? t('export.fetching') : t('export.copyHint')}</small></div>{exportAction === 'copy-markdown' ? <i className="action-spinner" /> : <Icon name="copy" />}</button>
            </div>
          </section>

          <section className="export-history-section">
            <div className="export-section-heading"><span><Icon name="clock" />{t('export.history')}</span><small>{pendingExportKind ? t('export.creatingTask') : jobs.length ? t('export.recent', { count: jobs.length }) : t('export.none')}</small></div>
            <div className="export-history-list" aria-live="polite">
              {pendingExportKind && <article className="export-history-item creating">
                <span className="export-history-kind"><Icon name={pendingExportKind === 'mp4' ? 'play' : pendingExportKind === 'pdf' ? 'text' : 'image'} /></span>
                <div><strong>{pendingExportKind === 'mp4' ? t('export.video') : pendingExportKind === 'pdf' ? t('export.pdf') : t('export.markdown')}</strong><small>{t('export.creatingDescription')}</small><span className="export-progress indeterminate"><i /></span></div>
                <span className="job-status creating"><i className="action-spinner" />{t('common:status.creating')}</span>
              </article>}
              {jobs.map(job => <article className={`export-history-item ${job.status}`} key={job.id}>
                <span className="export-history-kind"><Icon name={job.kind === 'mp4' ? 'play' : job.kind === 'pdf' ? 'text' : 'image'} /></span>
                <div><strong>{job.kind === 'mp4' ? t('export.video') : job.kind === 'pdf' ? t('export.pdf') : t('export.markdown')}</strong><small>{formatDate(job.created_at)}</small>{['queued', 'running'].includes(job.status) && <span className="export-progress"><i style={{ width: `${job.progress}%` }} /></span>}{job.status === 'failed' && <em title={job.error}>{t('export.failed')} · {job.error_code ? t(`common:errors.codes.${job.error_code}`) : t('export.retry')}</em>}</div>
                {job.status === 'complete' && job.download_url ? <a className="icon-button" href={`${API_URL}${job.download_url}`}><Icon name="download" />{t('common:actions.download')}</a> : <span className={`job-status ${job.status}`}>{job.status === 'failed' ? t('common:status.failed') : job.status === 'cancelled' ? t('common:status.cancelled') : job.status === 'queued' ? t('common:status.queued') : `${job.progress}%`}</span>}
              </article>)}
              {!jobs.length && !pendingExportKind && <div className="export-empty-note history-empty"><Icon name="clock" /><span>{t('export.empty')}</span></div>}
            </div>
          </section>
        </div>
      </aside>
    </div>}
    {detailMode === 'edit' && <nav className="editor-floating-dock" style={{ left: dockPosition.x, top: dockPosition.y }} aria-label={t('mobileDock.label')}>
      <span className="dock-drag-handle" onPointerDown={dragDock} title={t('mobileDock.move')}><Icon name="move" /></span>
      <button className={mobilePanel === 'steps' ? 'active' : ''} onClick={() => setMobilePanel(value => value === 'steps' ? null : 'steps')} title={t('mobileDock.steps')}><Icon name="list" /></button>
      <button className={canvasMode === 'edit' ? 'active' : ''} onClick={() => setCanvasMode(value => value === 'edit' ? 'preview' : 'edit')} title={t('mobileDock.hotspot')}><Icon name="target" /></button>
      <button className={mobilePanel === 'inspector' ? 'active' : ''} onClick={() => setMobilePanel(value => value === 'inspector' ? null : 'inspector')} title={t('mobileDock.inspector')}><Icon name="settings" /></button>
      <button className={focusMode ? 'active' : ''} onClick={() => { setFocusMode(value => !value); setMobilePanel(null) }} title={t(focusMode ? 'mobileDock.exitFocus' : 'mobileDock.focus')}><Icon name="layout" /></button>
    </nav>}
    {detailMode === 'present' ? <section className="immersive-demo">
      {selected ? <>
        <div className="immersive-stage"><SlideStage key={selected.id}
          step={selected} mode="player" fit="viewport" persistZoom theme={demo.theme} navigation={demo.navigation}
          stepIndex={presentationIndex} stepCount={demo.steps.length} activeHotspotId={orderedSelectedHotspots[presentationHotspotIndex]?.id}
          onHotspot={activatePresentation} onGuidePrevious={previousPresentation} onGuideNext={activatePresentation}
          onReady={() => setPresentationReady(true)}
        /></div>
        <nav className="immersive-nav" aria-label={t('presentation.navigation')}>
          <button disabled={!presentationReady || (presentationIndex === 0 && presentationHotspotIndex === 0)} onClick={previousPresentation} aria-label={t('common:actions.previous')}>‹</button>
          <span><b>{presentationIndex + 1}</b><i />{demo.steps.length}{selected.hotspot_mode === 'sequence' && orderedSelectedHotspots.length > 1 && <><i /><b>{presentationHotspotIndex + 1}/{orderedSelectedHotspots.length}</b></>}<small>{selected.title || t('steps.step', { index: presentationIndex + 1 })}</small></span>
          <button disabled={!presentationReady || (presentationIndex === demo.steps.length - 1 && (selected.hotspot_mode !== 'sequence' || presentationHotspotIndex >= orderedSelectedHotspots.length - 1))} onClick={forwardPresentation} aria-label={t('common:actions.next')}>›</button>
        </nav>
      </> : <div className="immersive-empty"><Icon name="image" size={42} /><h2>{t('presentation.empty')}</h2><p>{t('presentation.emptyHint')}</p><button className="primary icon-button" onClick={() => setDetailMode('edit')}><Icon name="edit" />{t('presentation.startEditing')}</button></div>}
    </section> : <div className="editor-layout">
      <aside className="step-list" style={floatingPanelStyle('steps')}>
        <div className="floating-panel-header"><span onPointerDown={event => dragFloatingPanel('steps', event)}><Icon name="move" />{t('mobileDock.steps')}</span><button aria-label={t('common:actions.close')} onClick={() => setMobilePanel(null)}>×</button></div>
        <div className="step-list-scroll">
          <div className="panel-heading"><span>{t('steps.resources')}</span><small>{demo.steps.length}</small></div>
          <input ref={stepUploadRef} className="step-upload-input" disabled={uploadBusy} multiple type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = ''; if (files.length) void uploadFiles(files, addStepAfterId ?? null) }} />
          <AddStepMenu open={addStepAfterId === null} busy={uploadBusy} canDuplicate={false} onToggle={() => setAddStepAfterId(current => current === null ? undefined : null)} onUpload={() => stepUploadRef.current?.click()} onDuplicate={() => undefined} onRecord={() => { setAddStepAfterId(undefined); void prepareRecorder() }} />
          {demo.steps.map((step, index) => <div className="step-entry" key={step.id}>
            <button className={`step-item ${selected?.id === step.id ? 'active' : ''}`} title={step.title || t('steps.step', { index: index + 1 })} onClick={() => { setSelectedId(step.id); setSelectedHotspotId(step.hotspots[0]?.id || null); setSelectedAnnotationIndex(null); setAddStepAfterId(undefined) }}><span>{index + 1}</span><img src={step.image_url} alt="" /><div><strong>{t('steps.step', { index: index + 1 })}</strong><small>{step.render_mode === 'dom' ? 'HTML Clone' : t('steps.screenshot')}</small></div></button>
            <AddStepMenu open={addStepAfterId === step.id} busy={uploadBusy} canDuplicate onToggle={() => setAddStepAfterId(current => current === step.id ? undefined : step.id)} onUpload={() => stepUploadRef.current?.click()} onDuplicate={() => void duplicateStep(step.id)} onRecord={() => { setAddStepAfterId(undefined); void prepareRecorder() }} />
          </div>)}
        </div>
        <div className="floating-panel-resize-handle" role="separator" aria-label={t('mobileDock.resize')} title={t('mobileDock.resize')} onPointerDown={event => resizeFloatingPanel('steps', event)} />
      </aside>
      <section className="editor-main">
        {selected ? <>
          <div className="stage-toolbar">
            <span className="stage-preview-kind">{selected.render_mode === 'dom' ? t('steps.htmlPreview') : t('steps.imageSlide')}</span>
            <span className="stage-title-tag" title={selected.title || t('steps.step', { index: selected.position + 1 })}><Icon name="text" size={12} />{selected.title || t('steps.step', { index: selected.position + 1 })}</span>
            <div className="stage-toolbar-actions">
              <div className="editor-history-actions">
                <button disabled={!history.canUndo || history.busy} title={history.undoLabel ? t('history.undoNamed', { name: history.undoLabel }) : t('history.undo')} onClick={() => void history.undo()}><Icon name="undo" /><span>{t('history.undo')}</span><kbd>{navigator.platform.includes('Mac') ? '⌘Z' : 'Ctrl Z'}</kbd></button>
                <button disabled={!history.canRedo || history.busy} title={history.redoLabel ? t('history.redoNamed', { name: history.redoLabel }) : t('history.redo')} onClick={() => void history.redo()}><Icon name="redo" /><span>{t('history.redo')}</span></button>
              </div>
              <div className="stage-mode-switch"><button className={canvasMode === 'preview' ? 'active' : ''} onClick={() => setCanvasMode('preview')}><Icon name="play" />{t('steps.preview')}</button><button className={canvasMode === 'edit' ? 'active' : ''} onClick={() => setCanvasMode('edit')}><Icon name="target" />{t('steps.editHotspot')}</button></div>
              {selected.snapshot_url && <button className="icon-button" onClick={() => patchStep(selected.id, { render_mode: selected.render_mode === 'dom' ? 'image' : 'dom' })}><Icon name="image" />{selected.render_mode === 'dom' ? t('steps.imageMode') : t('steps.domMode')}</button>}
              <button className="icon-button" onClick={addHotspot}><Icon name="plus" />Hotspot</button>
            </div>
          </div>
          {visibleCaptureWarnings(selected.capture_warnings).map((warning, index) => <div className="capture-warning" key={index}><Icon name="warning" />{warning}</div>)}
          <div className="mac-preview-window">
            <div className="mac-window-bar"><span className="mac-window-controls"><i /><i /><i /></span><span className="mac-window-caption">{selected.render_mode === 'dom' ? 'Interactive HTML' : 'Screenshot Preview'}</span><span /></div>
            <div className="mac-preview-content"><SlideStage key={selected.id}
              step={selected} mode={canvasMode === 'preview' ? 'player' : 'editor'} theme={demo.theme} navigation={demo.navigation}
              showAllHotspots showAllTooltips
              stepIndex={demo.steps.findIndex(step => step.id === selected.id)} stepCount={demo.steps.length} activeHotspotId={selectedHotspot?.id}
              onHotspot={canvasMode === 'preview' ? item => { setSelectedHotspotId(item.id); setTab('tooltip'); setCanvasMode('edit') } : undefined}
              onGuidePrevious={canvasMode === 'preview' ? () => { const index = demo.steps.findIndex(step => step.id === selected.id); const target = demo.steps[Math.max(0, index - 1)]; if (target) { setSelectedId(target.id); setSelectedHotspotId(target.hotspots[0]?.id || null) } } : undefined}
              onGuideNext={canvasMode === 'preview' ? () => { const index = demo.steps.findIndex(step => step.id === selected.id); const target = demo.steps[Math.min(demo.steps.length - 1, index + 1)]; if (target) { setSelectedId(target.id); setSelectedHotspotId(target.hotspots[0]?.id || null) } } : undefined}
              onSelectHotspot={item => { setSelectedHotspotId(item.id); setTab(canvasMode === 'preview' ? 'tooltip' : 'hotspot'); setCanvasMode('edit') }}
              onTarget={canvasMode === 'edit' && tab === 'hotspot' ? chooseTarget : undefined}
              onRectChange={canvasMode === 'edit' ? (item, rect) => { setSelectedHotspotId(item.id); patchHotspot({ fallback_rect: rect }, item) } : undefined}
              showZoomEditor={tab === 'animation' && canvasMode === 'edit'}
              onZoomRectChange={rect => setZoomRect(selected, rect)}
              onZoomDelete={() => patchStep(selected.id, { animation: { ...(selected.animation || {}), zoom: undefined } })}
              showAnnotations={tab === 'annotations' && selected.render_mode === 'image'}
              annotationTool={tab === 'annotations' && selected.render_mode === 'image' && canvasMode === 'edit' ? annotationTool : null}
              annotationsEditable={tab === 'annotations' && selected.render_mode === 'image' && canvasMode === 'edit'}
              selectedAnnotationIndex={selectedAnnotationIndex}
              onAnnotationSelect={setSelectedAnnotationIndex}
              onAnnotationAdd={(annotation: AnnotationRect) => { const index = selected.redactions.length; setSelectedAnnotationIndex(index); void patchStep(selected.id, { redactions: [...selected.redactions, annotation] }) }}
              onAnnotationChange={(index: number, annotation: AnnotationRect) => void patchStep(selected.id, { redactions: selected.redactions.map((item, current) => current === index ? annotation : item) })}
            /></div>
          </div>
          <div className="inline-actions step-order action-category"><span>{t('steps.actions')}</span><button className="icon-button" onClick={() => move(selected.id, -1)}><Icon name="arrowUp" />{t('steps.moveUp')}</button><button className="icon-button" onClick={() => move(selected.id, 1)}><Icon name="arrowDown" />{t('steps.moveDown')}</button><button className="icon-button" onClick={() => void duplicateStep(selected.id)}><Icon name="copy" />{t('steps.duplicateStep')}</button><button className="danger icon-button" onClick={async () => { await api.deleteStep(id, selected.id); const fresh = await api.demo(id); setDemo(fresh); setSelectedId(fresh.steps[0]?.id || null) }}><Icon name="delete" />{t('steps.delete')}</button></div>
        </> : <div className="empty editor-empty"><h2>{t('steps.empty')}</h2><p>{t('steps.emptyHint')}</p></div>}
      </section>
      <InspectorLayoutContext.Provider value={{
        mode: inspectorLayoutMode,
        activeSection: activeInspectorSection,
        toggleSection: section => setActiveInspectorSection(current => current === section ? null : section),
      }}>
      <aside ref={inspectorPanelRef} className={`publish-panel inspector-panel inspector-layout-${inspectorLayoutMode}`} style={floatingPanelStyle('inspector')}>
        <div className="floating-panel-header"><span onPointerDown={event => dragFloatingPanel('inspector', event)}><Icon name="move" />{t('mobileDock.inspector')}</span><button aria-label={t('common:actions.close')} onClick={() => setMobilePanel(null)}>×</button></div>
        <div className="inspector-tabs" role="tablist" aria-label={t('tools.label')}>{inspectorTabs.filter(item => item.value !== 'ai' || demo.ai_enabled).map(item => <button type="button" role="tab" aria-selected={tab === item.value} className={tab === item.value ? 'active' : ''} key={item.value} onClick={() => selectInspectorTab(item.value)}><Icon name={item.icon} /><span>{t(`tabs.${item.value}`)}</span></button>)}</div>
        {tab === 'content' && selected && <div className="inspector-body">
          <InspectorSection icon="text" title={t('content.copyTitle')} description={t('content.copyDescription')}>
            <label>{t('content.stepTitle')}<input value={selected.title} onFocus={() => rememberEditOrigin(`step.${selected.id}.title`, selected.title)} onChange={event => setDemo({ ...demo, steps: demo.steps.map(step => step.id === selected.id ? { ...step, title: event.target.value } : step) })} onBlur={() => patchStep(selected.id, { title: selected.title }, { title: takeEditOrigin(`step.${selected.id}.title`, selected.title) })} /></label>
            <label>{t('content.instructions')}<textarea value={selected.body} onFocus={() => rememberEditOrigin(`step.${selected.id}.body`, selected.body)} onChange={event => setDemo({ ...demo, steps: demo.steps.map(step => step.id === selected.id ? { ...step, body: event.target.value } : step) })} onBlur={() => patchStep(selected.id, { body: selected.body }, { body: takeEditOrigin(`step.${selected.id}.body`, selected.body) })} /></label>
          </InspectorSection>
          <InspectorSection icon="clock" title={t('content.timing')} description={t('content.timingDescription')}>
            <NumberField label={t('content.duration')} value={selected.duration} min={1} max={15} step={.5} onCommit={value => patchStep(selected.id, { duration: value })} />
          </InspectorSection>
          {demo.ai_enabled && <InspectorSection icon="ai" title={t('content.smartCopy')} description={t('content.smartCopyDescription')}><QuotaGuard fill message={!can('use_ai') ? quotaTitle('use_ai') : ''}><button className="icon-button" disabled={!can('use_ai')} onClick={() => generateAI(selected.id)}><Icon name="ai" />{t('content.regenerate')}</button></QuotaGuard></InspectorSection>}
        </div>}
        {tab === 'hotspot' && <div className="inspector-body">
          <InspectorSection icon="target" title={t('hotspot.objects')} description={t('hotspot.objectsDescription')}>
            {selected && <label>{t('hotspot.flowMode')}<select value={selected.hotspot_mode || 'independent'} onChange={event => patchStep(selected.id, { hotspot_mode: event.target.value as Step['hotspot_mode'] })}><option value="independent">{t('hotspot.independent')}</option><option value="sequence">{t('hotspot.sequence')}</option></select><small>{t(selected.hotspot_mode === 'sequence' ? 'hotspot.sequenceHint' : 'hotspot.independentHint')}</small></label>}
            <div className="hotspot-list">{orderedSelectedHotspots.map((item, index) => <div className={item.id === selectedHotspot?.id ? 'active' : ''} key={item.id}><button onClick={() => setSelectedHotspotId(item.id)}><Icon name="target" size={13} /><span>{t('hotspot.item', { index: index + 1 })}</span></button><span><button disabled={index === 0} title={t('steps.moveUp')} onClick={() => void moveHotspot(item, -1)}><Icon name="arrowUp" size={12} /></button><button disabled={index === orderedSelectedHotspots.length - 1} title={t('steps.moveDown')} onClick={() => void moveHotspot(item, 1)}><Icon name="arrowDown" size={12} /></button></span></div>)}</div>
            {selected?.hotspot_mode === 'sequence' && orderedSelectedHotspots.length > 1 && <div className="hotspot-sequence-preview">{orderedSelectedHotspots.map((item, index) => <span className={item.id === selectedHotspot?.id ? 'active' : ''} key={item.id}>{index + 1}</span>)}</div>}
            <button className="icon-button" onClick={addHotspot}><Icon name="plus" />{t('hotspot.add')}</button>
          </InspectorSection>
          {selectedHotspot ? <>
            <InspectorSection icon="cursor" title={t('hotspot.behavior')} description={t('hotspot.behaviorDescription')}>
              <p className="field-note">{t('hotspot.rebindHint')}</p>
              <label>{t('hotspot.trigger')}<select value={selectedHotspot.trigger} onChange={event => patchHotspot({ trigger: event.target.value as 'click' | 'hover' })}><option value="click">{t('hotspot.click')}</option><option value="hover">{t('hotspot.hover')}</option></select></label>
              <label>{t('hotspot.action')}<select value={selectedHotspot.action.type} onChange={event => patchHotspot({ action: { ...selectedHotspot.action, type: event.target.value as HotspotData['action']['type'] } })}><option value="next">{t(selected?.hotspot_mode === 'sequence' ? (selectedHotspotIndex < orderedSelectedHotspots.length - 1 ? 'hotspot.nextHotspot' : 'hotspot.nextPage') : 'hotspot.next')}</option><option value="goto">{t('hotspot.goto')}</option><option value="link">{t('hotspot.link')}</option><option value="end">{t('hotspot.end')}</option></select></label>
              {selectedHotspot.action.type === 'goto' && <label>{t('hotspot.target')}<select value={selectedHotspot.action.target_step_id || ''} onChange={event => patchHotspot({ action: { ...selectedHotspot.action, target_step_id: event.target.value } })}>{demo.steps.map((step, index) => <option value={step.id} key={step.id}>{index + 1}. {step.title}</option>)}</select></label>}
              {selectedHotspot.action.type === 'link' && <label>{t('hotspot.url')}<input value={selectedHotspot.action.url || ''} placeholder="https://" onChange={event => patchHotspot({ action: { ...selectedHotspot.action, url: event.target.value } })} /></label>}
          </InspectorSection>
          <InspectorSection icon="move" title={t('hotspot.position')} description={t('hotspot.positionDescription')}>
              <div className="rect-grid">{(['x', 'y', 'w', 'h'] as const).map(key => <NumberField key={key} label={key.toUpperCase()} value={selectedHotspot.fallback_rect[key]} min={0} max={1} step={.01} decimals={2} onCommit={value => patchHotspot({ fallback_rect: { ...selectedHotspot.fallback_rect, [key]: value } })} />)}</div>
            </InspectorSection>
            <InspectorSection icon="palette" title={t('hotspot.appearance')} description={t('hotspot.appearanceDescription')}>
              <label>{t('hotspot.shape')}<select value={selectedHotspot.style.shape} onChange={event => patchHotspot({ style: { ...selectedHotspot.style, shape: event.target.value as 'rectangle' | 'circle' } })}><option value="rectangle">{t('hotspot.rectangle')}</option><option value="circle">{t('hotspot.circle')}</option></select></label>
              <ColorField label={t('hotspot.color')} value={selectedHotspot.style.color || '#635bff'} onChange={value => patchHotspot({ style: { ...selectedHotspot.style, color: value } })} />
              <div className="toggle-list"><label className="check"><input type="checkbox" checked={selectedHotspot.style.pulse} onChange={event => patchHotspot({ style: { ...selectedHotspot.style, pulse: event.target.checked } })} /><span><strong>{t('hotspot.pulse')}</strong><small>{t('hotspot.pulseHint')}</small></span></label>
              <label className="check"><input type="checkbox" checked={selectedHotspot.style.spotlight} onChange={event => patchHotspot({ style: { ...selectedHotspot.style, spotlight: event.target.checked } })} /><span><strong>{t('hotspot.spotlight')}</strong><small>{t('hotspot.spotlightHint')}</small></span></label></div>
            </InspectorSection>
            <InspectorSection icon="delete" title={t('hotspot.danger')} tone="danger"><button className="danger icon-button" onClick={deleteSelectedHotspot}><Icon name="delete" />{t('hotspot.delete')}</button></InspectorSection>
          </> : null}
        </div>}
        {tab === 'tooltip' && selectedHotspot && <div className="inspector-body">
          <InspectorSection icon="message" title={t('tooltip.copy')} description={t('tooltip.copyDescription')}><label>{t('tooltip.content')}<textarea value={selectedHotspot.tooltip.content} onFocus={() => rememberEditOrigin(`hotspot.${selectedHotspot.id}.tooltip`, selectedHotspot.tooltip)} onChange={event => updateHotspotLocal({ tooltip: { ...selectedHotspot.tooltip, content: event.target.value } })} onBlur={() => patchHotspot({ tooltip: selectedHotspot.tooltip }, selectedHotspot, { tooltip: takeEditOrigin(`hotspot.${selectedHotspot.id}.tooltip`, selectedHotspot.tooltip) })} /></label></InspectorSection>
          <InspectorSection icon="layout" title={t('tooltip.layout')} description={t('tooltip.layoutDescription')}>
            <label>{t('tooltip.placement')}<select value={selectedHotspot.tooltip.placement} onChange={event => patchHotspot({ tooltip: { ...selectedHotspot.tooltip, placement: event.target.value } })}>{['auto','top','top-start','top-end','bottom','bottom-start','bottom-end','left','left-start','left-end','right','right-start','right-end'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
            <RangeField label={t('tooltip.offset')} value={selectedHotspot.tooltip.offset} min={0} max={60} suffix=" px" onChange={value => patchHotspot({ tooltip: { ...selectedHotspot.tooltip, offset: value } })} />
            <NumberField label={t('tooltip.maxWidth')} value={selectedHotspot.tooltip.max_width} min={160} max={800} onCommit={value => patchHotspot({ tooltip: { ...selectedHotspot.tooltip, max_width: value } })} />
          </InspectorSection>
          <InspectorSection icon="eye" title={t('tooltip.display')}><div className="toggle-list"><label className="check"><input type="checkbox" checked={selectedHotspot.tooltip.show_arrow} onChange={event => patchHotspot({ tooltip: { ...selectedHotspot.tooltip, show_arrow: event.target.checked } })} /><span><strong>{t('tooltip.arrow')}</strong><small>{t('tooltip.arrowHint')}</small></span></label></div></InspectorSection>
        </div>}
        {tab === 'theme' && <div className="inspector-body">
          <InspectorSection icon="palette" title={t('theme.brand')} description={t('theme.brandDescription')}>
            <ColorField label={t('theme.primary')} value={demo.theme?.primary_color || '#635bff'} onChange={value => patchDemo({ theme: { ...demo.theme, primary_color: value } })} />
          </InspectorSection>
          <InspectorSection icon="message" title={t('theme.card')} description={t('theme.cardDescription')}>
            <ColorField label={t('theme.cardBackground')} value={demo.theme?.tooltip?.background || '#ffffff'} onChange={value => patchDemo({ theme: { ...demo.theme, tooltip: { ...(demo.theme?.tooltip || {}), background: value } } })} />
            <ColorField label={t('theme.cardText')} value={demo.theme?.tooltip?.text_color || '#172033'} onChange={value => patchDemo({ theme: { ...demo.theme, tooltip: { ...(demo.theme?.tooltip || {}), text_color: value } } })} />
          </InspectorSection>
          <InspectorSection icon="cursor" title={t('theme.navigation')} description={t('theme.navigationDescription')}>
            <div className="field-grid"><label>{t('theme.previousLabel')}<input value={demo.navigation?.previous_label || t('common:actions.previous')} onChange={event => patchDemo({ navigation: { ...demo.navigation, previous_label: event.target.value } })} /></label><label>{t('theme.nextLabel')}<input value={demo.navigation?.next_label || t('common:actions.next')} onChange={event => patchDemo({ navigation: { ...demo.navigation, next_label: event.target.value } })} /></label></div>
            <ColorField label={t('theme.previousBackground')} value={demo.navigation?.previous_color || '#ffffff'} onChange={value => patchDemo({ navigation: { ...demo.navigation, previous_color: value } })} />
            <ColorField label={t('theme.previousText')} value={demo.navigation?.text_color || '#172033'} onChange={value => patchDemo({ navigation: { ...demo.navigation, text_color: value } })} />
            <ColorField label={t('theme.nextBackground')} value={demo.navigation?.next_color || '#635bff'} onChange={value => patchDemo({ navigation: { ...demo.navigation, next_color: value } })} />
            <ColorField label={t('theme.nextText')} value={demo.navigation?.next_text_color || '#ffffff'} onChange={value => patchDemo({ navigation: { ...demo.navigation, next_text_color: value } })} />
            <RangeField label={t('theme.radius')} value={demo.navigation?.radius ?? 9} min={0} max={24} suffix=" px" onChange={value => patchDemo({ navigation: { ...demo.navigation, radius: value } })} />
          </InspectorSection>
          <InspectorSection icon="eye" title={t('theme.visibility')}><div className="toggle-list">
            <label className="check"><input type="checkbox" checked={demo.navigation?.show_previous !== false} onChange={event => patchDemo({ navigation: { ...demo.navigation, show_previous: event.target.checked } })} /><span><strong>{t('theme.showPrevious')}</strong></span></label>
            <label className="check"><input type="checkbox" checked={demo.navigation?.show_next !== false} onChange={event => patchDemo({ navigation: { ...demo.navigation, show_next: event.target.checked } })} /><span><strong>{t('theme.showNext')}</strong></span></label>
            <label className="check"><input type="checkbox" checked={demo.navigation?.show_progress !== false} onChange={event => patchDemo({ navigation: { ...demo.navigation, show_progress: event.target.checked } })} /><span><strong>{t('theme.showProgress')}</strong></span></label>
          </div></InspectorSection>
        </div>}
        {tab === 'annotations' && selected && <div className="inspector-body">
          <InspectorSection icon="image" title={t('annotations.title')} description={t('annotations.description')}>
            {selected.render_mode !== 'image' ? <div className="annotation-mode-note"><Icon name="warning" /><div><strong>{t('annotations.imageOnly')}</strong><small>{t('annotations.imageOnlyHint')}</small></div><button className="icon-button" onClick={() => patchStep(selected.id, { render_mode: 'image' })}><Icon name="image" />{t('steps.imageMode')}</button></div> : <>
              <div className="annotation-tools">{(['mosaic', 'blur'] as const).map(tool => <button key={tool} className={annotationTool === tool ? 'active' : ''} onClick={() => setAnnotationTool(tool)}><Icon name={tool === 'mosaic' ? 'grid' : 'eyeOff'} /><strong>{t(`annotations.${tool}`)}</strong><small>{t(`annotations.${tool}Hint`)}</small></button>)}</div>
              <p className="field-note">{t('annotations.drawHint')}</p>
            </>}
          </InspectorSection>
          {selected.redactions?.length > 0 && <InspectorSection icon="list" title={t('annotations.items')} description={t('annotations.itemsDescription')}>
            <div className="annotation-list">{selected.redactions.map((annotation, index) => <div className={selectedAnnotationIndex === index ? 'selected' : ''} key={index} onClick={() => { setSelectedAnnotationIndex(index); setCanvasMode('edit') }}><span className={`annotation-swatch ${annotation.kind || 'cover'}`} /><div><strong>{t(`annotations.${annotation.kind || 'cover'}`)}</strong><small>{Math.round(annotation.w * 100)}% × {Math.round(annotation.h * 100)}%</small></div><button className="danger" title={t('common:actions.delete')} onClick={event => { event.stopPropagation(); setSelectedAnnotationIndex(current => current === index ? null : current !== null && current > index ? current - 1 : current); void patchStep(selected.id, { redactions: selected.redactions.filter((_, current) => current !== index) }) }}><Icon name="delete" /></button></div>)}</div>
            <button className="danger icon-button" onClick={() => { setSelectedAnnotationIndex(null); void patchStep(selected.id, { redactions: [] }) }}><Icon name="delete" />{t('annotations.clear')}</button>
          </InspectorSection>}
        </div>}
        {tab === 'animation' && selected && <div className="inspector-body">
          <InspectorSection icon="animation" title={t('animation.zoom')} description={t('animation.zoomDescription')}>
            {selected.animation?.zoom?.rect ? <>
              <div className="animation-status"><span><i />{t('animation.enabled')}</span><small>{t('animation.dragHint')}</small></div>
              <div className="field-grid">
                <NumberField label={t('animation.transition')} value={selected.animation.zoom.transition_duration_ms ?? 1200} min={0} max={5000} step={100} onCommit={value => patchStep(selected.id, { animation: { ...(selected.animation || {}), zoom: { ...selected.animation!.zoom!, transition_duration_ms: value } } })} />
                <NumberField label={t('animation.duration')} value={selected.animation.zoom.duration_ms || 3000} min={500} max={10000} step={250} onCommit={value => patchStep(selected.id, { animation: { ...(selected.animation || {}), zoom: { ...selected.animation!.zoom!, duration_ms: value } } })} />
              </div>
              <p className="field-note">{t('animation.mp4Hint')}</p>
              <button className="danger icon-button" onClick={() => patchStep(selected.id, { animation: { ...(selected.animation || {}), zoom: undefined } })}><Icon name="delete" />{t('animation.delete')}</button>
            </> : <>
              <p className="field-note">{t('animation.addHint')}</p>
              <button className="primary icon-button" onClick={() => setZoomRect(selected, defaultZoomRect(selected))}><Icon name="plus" />{t('animation.add')}</button>
            </>}
          </InspectorSection>
          <InspectorSection icon="play" title={t('animation.autoplay')} description={t('animation.autoplayDescription')}>
            <div className="toggle-list"><label className="check"><input type="checkbox" checked={demo.playback?.autoplay === true} onChange={event => patchDemo({ playback: { ...demo.playback, autoplay: event.target.checked } })} /><span><strong>{t('animation.autoplay')}</strong><small>{t('animation.autoplayHint')}</small></span></label></div>
            <div className="field-grid">
              <NumberField label={t('animation.stepDuration')} value={demo.playback?.step_duration_ms ?? 2000} min={250} max={60000} step={250} onCommit={value => patchDemo({ playback: { ...demo.playback, step_duration_ms: value } })} />
              <NumberField label={t('animation.transitionDelay')} value={demo.playback?.transition_delay_ms ?? 1000} min={0} max={30000} step={250} onCommit={value => patchDemo({ playback: { ...demo.playback, transition_delay_ms: value } })} />
            </div>
            <div className="toggle-list"><label className="check"><input type="checkbox" checked={demo.playback?.loop === true} onChange={event => patchDemo({ playback: { ...demo.playback, loop: event.target.checked } })} /><span><strong>{t('animation.loop')}</strong><small>{t('animation.loopHint')}</small></span></label></div>
          </InspectorSection>
        </div>}
        {tab === 'ai' && <div className="inspector-body">
          <InspectorSection icon="ai" title={t('ai.generate')} description={t('ai.generateDescription')}>
            <QuotaGuard fill message={!can('use_ai') ? quotaTitle('use_ai') : ''}><button className="primary icon-button" disabled={!can('use_ai') || aiBusy} onClick={() => generateAI()}><Icon name="ai" />{t('ai.generateAll')}</button></QuotaGuard>
            <p className="field-note">{t('ai.background')}</p>
          </InspectorSection>
          {aiJob && <InspectorSection icon="settings" title={t('ai.recent')}><div className={`ai-job ${aiJob.status} ${aiJob.result?.reverted ? 'reverted' : ''}`}><strong>{aiJob.status === 'complete' ? t(aiJob.result?.reverted ? 'ai.reverted' : 'ai.complete') : aiJob.status === 'failed' ? t('ai.failed') : aiJob.status === 'cancelled' ? t('common:status.cancelled') : t('ai.running')}</strong><span>{aiJob.progress}% · {aiJob.model}</span>{aiJob.status === 'complete' && aiJob.can_revert && <button disabled={aiMutation !== null} onClick={() => void mutateAI('revert')}>{t(aiMutation === 'revert' ? 'ai.reverting' : 'ai.revert')}</button>}{aiJob.status === 'complete' && aiJob.can_reapply && <button className="primary" disabled={aiMutation !== null} onClick={() => void mutateAI('reapply')}>{t(aiMutation === 'reapply' ? 'ai.reapplying' : 'ai.reapply')}</button>}</div></InspectorSection>}
          {aiJob?.status === 'complete' && aiChangeReport && <InspectorSection icon="copy" title={t('ai.review')} description={t('ai.reviewDescription')}>
            {aiChangeReport.demo?.fields && Object.keys(aiChangeReport.demo.fields).length > 0 && <section className="ai-change-group"><header><Icon name="text" /><strong>{t('ai.demoInfo')}</strong></header>
              {(['title', 'description'] as const).map(field => aiChangeReport.demo?.fields?.[field] && <AIFieldComparison key={field} label={t(`ai.fields.${field}`)} change={aiChangeReport.demo.fields[field]} originalLabel={t('ai.original')} generatedLabel={t('ai.generated')} appliedLabel={t('ai.applied')} retainedLabel={t('ai.retained')} emptyLabel={t('ai.empty')} />)}
            </section>}
            <div className="ai-step-change-list">{(aiChangeReport.steps || []).slice().sort((a, b) => a.position - b.position).map((item, index) => <details key={item.id}>
              <summary><span>{t('ai.stepReview', { index: item.position + 1 })}</span><small>{t('ai.fieldCount', { count: Object.keys(item.fields || {}).length })}</small></summary>
              <div>{(['title', 'body'] as const).map(field => item.fields?.[field] && <AIFieldComparison key={field} label={t(`ai.fields.${field}`)} change={item.fields[field]} originalLabel={t('ai.original')} generatedLabel={t('ai.generated')} appliedLabel={t('ai.applied')} retainedLabel={t('ai.retained')} emptyLabel={t('ai.empty')} />)}
                {(item.hotspots || []).map((hotspot, hotspotIndex) => <AIFieldComparison key={hotspot.id} label={`${t('ai.fields.tooltip')} ${hotspotIndex + 1}`} change={hotspot.tooltip} originalLabel={t('ai.original')} generatedLabel={t('ai.generated')} appliedLabel={t('ai.applied')} retainedLabel={t('ai.retained')} emptyLabel={t('ai.empty')} />)}
                {(item.warnings?.length || item.redundant) && <div className="ai-step-review-note">{item.warnings?.map((warning, warningIndex) => <span key={warningIndex}><Icon name="warning" />{displayAIWarning(warning)}</span>)}{item.redundant && <span><Icon name="warning" />{t('ai.redundant')}</span>}</div>}
              </div>
            </details>)}</div>
            {!(aiChangeReport.steps || []).length && !Object.keys(aiChangeReport.demo?.fields || {}).length && <p className="field-note">{t('ai.noChanges')}</p>}
          </InspectorSection>}
          {(selected?.ai_metadata?.warnings?.length || selected?.ai_metadata?.redundant) && <InspectorSection icon="warning" title={t('ai.suggestions')}>
            <p className="field-note">{t('ai.suggestionsDescription')}</p>
            {selected?.ai_metadata?.warnings?.map((warning, index) => <div className="ai-warning" key={index}><Icon name="warning" />{displayAIWarning(warning)}</div>)}
            {selected?.ai_metadata?.redundant && <div className="ai-warning"><Icon name="warning" />{t('ai.redundant')}</div>}
          </InspectorSection>}
          <InspectorSection icon="eye" title={t('ai.dataRules')}><p className="field-note">{t('ai.dataRulesHint')}</p></InspectorSection>
        </div>}
        <div className="floating-panel-resize-handle" role="separator" aria-label={t('mobileDock.resize')} title={t('mobileDock.resize')} onPointerDown={event => resizeFloatingPanel('inspector', event)} />
      </aside>
      </InspectorLayoutContext.Provider>
    </div>}
    {aiConfirmOpen && <div className="library-dialog-layer ai-confirm-layer" onMouseDown={event => { if (event.target === event.currentTarget) setAIConfirmOpen(false) }}>
      <section className="library-dialog ai-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-confirm-title">
        <header><span><Icon name="ai" /></span><div><strong id="ai-confirm-title">{t('ai.confirmTitle')}</strong><small>{t('ai.confirmSubtitle')}</small></div><button aria-label={t('common:actions.close')} onClick={() => setAIConfirmOpen(false)}>×</button></header>
        <div className="library-dialog-body ai-confirm-body">
          <p>{t('ai.confirmDescription')}</p>
          <section><strong>{t('ai.confirmScope')}</strong><ul><li>{t('ai.confirmDemoFields')}</li><li>{t('ai.confirmStepFields')}</li><li>{t('ai.confirmHotspotFields')}</li></ul></section>
          <div className="ai-confirm-note"><Icon name="warning" /><span>{t('ai.confirmRule')}</span></div>
        </div>
        <footer className="dialog-actions"><button onClick={() => setAIConfirmOpen(false)}>{t('common:actions.cancel')}</button><button className="primary icon-button" onClick={() => { setAIConfirmOpen(false); void generateAI() }}><Icon name="ai" />{t('ai.confirmAction')}</button></footer>
      </section>
    </div>}
  </main>
}
