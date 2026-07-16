import { createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { API_URL, api } from '../api'
import { copyText } from '../clipboard'
import { formatDate } from '../i18n'
import Icon, { type IconName } from '../components/Icon'
import LanguageSwitcher from '../components/LanguageSwitcher'
import SlideStage from '../components/SlideStage'
import { prepareExtensionRecording } from '../extensionBridge'
import type { AIJob, Demo, ExportJob, HotspotData, Rect, SelectorInfo, Step } from '../types'

type InspectorTab = 'content' | 'hotspot' | 'tooltip' | 'theme' | 'animation' | 'ai'
type CanvasMode = 'preview' | 'edit'
type DetailMode = 'present' | 'edit'
type ExportCenterAction = 'publish' | 'copy-share' | 'copy-markdown' | ExportJob['kind'] | null
type InspectorLayoutMode = 'expanded' | 'accordion' | 'detail'
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
  { value: 'tooltip', icon: 'edit' }, { value: 'theme', icon: 'palette' },
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

function AIFieldComparison({ label, change, originalLabel, generatedLabel, appliedLabel, retainedLabel, emptyLabel }: { label: string; change: AIFieldChange; originalLabel: string; generatedLabel: string; appliedLabel: string; retainedLabel: string; emptyLabel: string }) {
  const before = String(change.before ?? '').trim()
  const after = String(change.after ?? '').trim()
  return <article className="ai-change-field">
    <header><strong>{label}</strong><span className={change.applied ? 'applied' : 'retained'}>{change.applied ? appliedLabel : retainedLabel}</span></header>
    <div><section><small>{originalLabel}</small><p>{before || emptyLabel}</p></section><section><small>{generatedLabel}</small><p>{after || emptyLabel}</p></section></div>
  </article>
}

function visibleCaptureWarnings(warnings: string[] = []) {
  const legacyAudit = /^(removed unsafe|removed external|removed recorder or browser-extension|removed injected|Video playback is not included|Cross-origin iframe content may use a raster fallback)/i
  return warnings.filter(warning => !legacyAudit.test(warning))
}

function eventId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

export default function Editor() {
  const { t } = useTranslation('editor')
  const { id = '' } = useParams()
  const [demo, setDemo] = useState<Demo | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedHotspotId, setSelectedHotspotId] = useState<string | null>(null)
  const [canvasMode, setCanvasMode] = useState<CanvasMode>('preview')
  const [detailMode, setDetailMode] = useState<DetailMode>(() => new URLSearchParams(window.location.search).get('mode') === 'edit' ? 'edit' : 'present')
  const [titleEditing, setTitleEditing] = useState(false)
  const [presentationReady, setPresentationReady] = useState(false)
  const [tab, setTab] = useState<InspectorTab>('content')
  const [focusMode, setFocusMode] = useState(false)
  const [mobilePanel, setMobilePanel] = useState<'steps' | 'inspector' | null>(null)
  const [dockPosition, setDockPosition] = useState({ x: 16, y: 78 })
  const [panelPositions, setPanelPositions] = useState({
    steps: { x: 18, y: 82 },
    inspector: { x: Math.max(18, window.innerWidth - 378), y: 82 },
  })
  const [panelHeights, setPanelHeights] = useState<{ steps: number | null; inspector: number | null }>({ steps: null, inspector: null })
  const inspectorPanelRef = useRef<HTMLElement>(null)
  const [inspectorPanelHeight, setInspectorPanelHeight] = useState(window.innerHeight)
  const [activeInspectorSection, setActiveInspectorSection] = useState<string | null>(null)
  const [jobs, setJobs] = useState<ExportJob[]>([])
  const [aiJob, setAIJob] = useState<AIJob | null>(null)
  const [exportCenterOpen, setExportCenterOpen] = useState(false)
  const [exportAction, setExportAction] = useState<ExportCenterAction>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [recorderBusy, setRecorderBusy] = useState(false)
  const selected = useMemo(() => demo?.steps.find(step => step.id === selectedId) || demo?.steps[0], [demo, selectedId])
  const selectedHotspot = useMemo(() => selected?.hotspots.find(item => item.id === selectedHotspotId) || selected?.hotspots[0], [selected, selectedHotspotId])
  const aiChangeReport = aiJob?.result?.changes as AIChangeReport | undefined
  const inspectorLayoutMode: InspectorLayoutMode = inspectorPanelHeight < 520 ? 'detail' : inspectorPanelHeight < 720 ? 'accordion' : 'expanded'
  const defaultInspectorSection = useMemo(() => ({
    content: t('content.copyTitle'),
    hotspot: t('hotspot.objects'),
    tooltip: t('tooltip.copy'),
    theme: t('theme.brand'),
    animation: 'Zoom and Pan',
    ai: t('ai.generate'),
  })[tab], [tab, t])

  useEffect(() => {
    Promise.all([api.demo(id), api.latestAI(id), api.exports(id).catch(() => [])]).then(([value, latest, exportJobs]) => {
      setDemo(value); setSelectedId(value.steps[0]?.id || null); setSelectedHotspotId(value.steps[0]?.hotspots[0]?.id || null); setAIJob(latest); setJobs(exportJobs)
    }).catch(value => setError(value.message))
  }, [id])
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
    const timer = window.setInterval(async () => setJobs(await Promise.all(jobs.map(job => job.status === 'complete' || job.status === 'failed' ? job : api.export(job.id)))), 1500)
    return () => clearInterval(timer)
  }, [jobs])
  useEffect(() => {
    if (!aiJob || !['queued', 'running'].includes(aiJob.status)) return
    const timer = window.setInterval(async () => {
      const next = await api.aiJob(aiJob.id)
      setAIJob(next)
      if (next.status === 'complete') {
        const fresh = await api.demo(id); setDemo(fresh); setNotice(t('messages.aiComplete'))
      }
      if (next.status === 'failed') setError(next.error_code ? t(`common:errors.codes.${next.error_code}`) : t('messages.aiFailed'))
    }, 1800)
    return () => clearInterval(timer)
  }, [aiJob?.id, aiJob?.status, id])
  useEffect(() => {
    if (detailMode !== 'present' || !demo || !presentationReady) return
    const handler = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.matches('input, textarea, select')) return
      const index = demo.steps.findIndex(step => step.id === selected?.id)
      if (event.key === 'ArrowRight') selectPresentationStep(index + 1)
      if (event.key === 'ArrowLeft') selectPresentationStep(index - 1)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [detailMode, demo, selected?.id, presentationReady])
  useEffect(() => {
    if (detailMode !== 'present' || !demo || !selected || !presentationReady || !demo.playback?.autoplay || demo.steps.length < 2) return
    const duration = Math.max(250, Math.min(60000, Number(demo.playback.step_duration_ms) || 2000))
    const delay = Math.max(0, Math.min(30000, Number(demo.playback.transition_delay_ms) || 0))
    const index = demo.steps.findIndex(step => step.id === selected.id)
    const timer = window.setTimeout(() => {
      if (index < demo.steps.length - 1) selectPresentationStep(index + 1)
      else if (demo.playback?.loop) selectPresentationStep(0)
    }, duration + delay)
    return () => window.clearTimeout(timer)
  }, [detailMode, demo, selected?.id, presentationReady])

  async function patchDemo(values: Partial<Demo>) {
    setDemo(current => current ? { ...current, ...values } : current)
    try { setDemo(await api.updateDemo(id, values)) } catch (value) { setError((value as Error).message) }
  }
  async function patchStep(stepId: string, values: Partial<Step>) {
    setDemo(current => current ? { ...current, steps: current.steps.map(step => step.id === stepId ? { ...step, ...values } : step) } : current)
    try {
      const updated = await api.updateStep(id, stepId, values)
      setDemo(current => current ? { ...current, steps: current.steps.map(step => step.id === stepId ? updated : step) } : current)
    } catch (value) { setError((value as Error).message) }
  }
  function updateStepLocal(stepId: string, values: Partial<Step>) {
    setDemo(current => current ? { ...current, steps: current.steps.map(step => step.id === stepId ? { ...step, ...values } : step) } : current)
  }
  function updateHotspotLocal(values: Partial<HotspotData>, target = selectedHotspot) {
    if (!selected || !target) return
    setDemo(current => current ? { ...current, steps: current.steps.map(step => step.id === selected.id ? { ...step, hotspots: step.hotspots.map(item => item.id === target.id ? { ...item, ...values } : item) } : step) } : current)
  }
  async function patchHotspot(values: Partial<HotspotData>, target = selectedHotspot) {
    if (!selected || !target) return
    updateHotspotLocal(values, target)
    try {
      const updated = await api.updateHotspot(id, selected.id, target.id, values)
      setDemo(current => current ? { ...current, steps: current.steps.map(step => step.id === selected.id ? { ...step, hotspots: step.hotspots.map(item => item.id === updated.id ? updated : item) } : step) } : current)
    } catch (value) { setError((value as Error).message) }
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
    const created = await api.createHotspot(id, selected.id, { selector: {}, fallback_rect: { x: .5, y: .5, w: .08, h: .06 }, trigger: 'click', action: { type: 'next' }, tooltip: defaultTooltip(demo?.content_locale), style: defaultStyle })
    setDemo(current => current ? { ...current, steps: current.steps.map(step => step.id === selected.id ? { ...step, hotspots: [...step.hotspots, created] } : step) } : current)
    setSelectedHotspotId(created.id); setTab('hotspot'); setCanvasMode('edit')
  }
  async function move(stepId: string, offset: number) {
    if (!demo) return
    const steps = [...demo.steps], from = steps.findIndex(step => step.id === stepId), to = from + offset
    if (to < 0 || to >= steps.length) return
    ;[steps[from], steps[to]] = [steps[to], steps[from]]
    setDemo(await api.reorder(id, steps.map(step => step.id)))
  }
  async function upload(file: File) {
    const bitmap = await createImageBitmap(file)
    const meta = { event_id: eventId(), title: t('steps.step', { index: (demo?.steps.length || 0) + 1 }), body: '', viewport_width: bitmap.width, viewport_height: bitmap.height, hotspot: { x: .5, y: .5, w: .04, h: .04 }, duration: 3 }
    bitmap.close()
    const form = new FormData(); form.append('meta', JSON.stringify(meta)); form.append('screenshot', file)
    const step = await api.uploadStep(id, form)
    setDemo(current => current ? { ...current, steps: [...current.steps, step] } : current); setSelectedId(step.id); setSelectedHotspotId(step.hotspots[0]?.id || null)
  }
  async function publish() {
    if (exportAction) return
    setExportAction('publish'); setError(''); setNotice('')
    try { setDemo(await api.publish(id)); setNotice(t('messages.published')) }
    catch (value) { setError((value as Error).message) }
    finally { setExportAction(null) }
  }
  async function copyMarkdown() {
    if (!demo?.share_url || exportAction) return
    setExportAction('copy-markdown'); setError(''); setNotice('')
    try {
      const token = demo.share_url.split('/').pop(), response = await fetch(`${API_URL}/public/${token}/markdown`)
      if (!response.ok) throw new Error(t('messages.markdownFailed', { status: response.status }))
      await copyText(await response.text()); setNotice(t('messages.markdownCopied'))
    } catch (value) { setError((value as Error).message) }
    finally { setExportAction(null) }
  }
  async function copyShareLink() {
    if (!demo?.share_url || exportAction) return
    setExportAction('copy-share'); setError(''); setNotice('')
    try {
      await copyText(demo.share_url)
      setNotice(t('messages.shareCopied'))
    } catch (value) { setError((value as Error).message) }
    finally { setExportAction(null) }
  }
  async function startExport(kind: ExportJob['kind']) {
    if (exportAction) return
    setExportAction(kind); setError(''); setNotice('')
    try {
      // Export the current editor state instead of a potentially stale
      // published revision, so timing/Zoom changes take effect immediately.
      setDemo(await api.publish(id))
      const job = await api.createExport(id, kind)
      setJobs(current => [job, ...current.filter(item => item.kind !== kind)])
      setNotice(t('messages.exportCreated'))
    } catch (value) { setError((value as Error).message) }
    finally { setExportAction(null) }
  }
  async function generateAI(stepId?: string) {
    try { setAIJob(await api.generateAI(id, stepId)); setTab('ai') } catch (value) { setError((value as Error).message) }
  }
  async function prepareRecorder() {
    if (!demo || recorderBusy) return
    setRecorderBusy(true); setError(''); setNotice('')
    try { await prepareExtensionRecording(demo.id); setNotice(t('messages.recorderReady')) }
    catch (value) { setError((value as Error).message === 'extension_not_detected' ? t('messages.extensionNotDetected') : t('messages.recorderFailed')) }
    finally { setRecorderBusy(false) }
  }

  function selectPresentationStep(index: number) {
    if (!demo?.steps.length || !presentationReady) return
    const target = demo.steps[Math.max(0, Math.min(demo.steps.length - 1, index))]
    if (!target || target.id === selected?.id) return
    setPresentationReady(false)
    setSelectedId(target.id)
    setSelectedHotspotId(target.hotspots[0]?.id || null)
  }

  function activatePresentation(hotspot: HotspotData) {
    if (!demo || !selected) return
    const index = demo.steps.findIndex(step => step.id === selected.id)
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
    selectPresentationStep(index + 1)
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

  if (!demo) return <main className="page"><Link to="/">{t('common:actions.back')}</Link><div className="center-page">{error || t('common:status.loading')}</div></main>
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
        </> : <><button className="topbar-action icon-button" onClick={() => { setDetailMode('present'); setCanvasMode('preview'); setPresentationReady(false); window.history.replaceState(null, '', window.location.pathname) }}><Icon name="play" />{t('top.present')}</button><button className={`topbar-action icon-button ${focusMode ? 'active' : ''}`} onClick={() => { setFocusMode(value => !value); setMobilePanel(null) }} title={t(focusMode ? 'mobileDock.exitFocus' : 'mobileDock.focus')}><Icon name="layout" />{t(focusMode ? 'mobileDock.exitFocus' : 'mobileDock.focus')}</button></>}
        {demo.share_url && <a className="topbar-action button icon-button compact-action" href={demo.share_url} target="_blank" rel="noreferrer" title={t('top.publicLink')}><Icon name="share" /></a>}
        {detailMode === 'edit' && <button className="topbar-action icon-button" disabled={recorderBusy} onClick={prepareRecorder}>{recorderBusy ? <span className="action-spinner" /> : <Icon name="record" />}{t(recorderBusy ? 'top.preparingRecorder' : 'top.continueRecording')}</button>}
        {detailMode === 'edit' && demo.ai_enabled && <button className="topbar-action icon-button" onClick={() => generateAI()}><Icon name="ai" />{t('top.aiOptimize')}</button>}
        <LanguageSwitcher account />
        <button className={`primary icon-button publish-action ${exportCenterOpen ? 'active' : ''} ${actionBusy ? 'action-pending' : ''}`} aria-busy={actionBusy} disabled={actionBusy} onClick={() => setExportCenterOpen(value => !value)}>{actionBusy ? <span className="action-spinner" /> : <Icon name="share" />}{actionBusy ? t('top.processing') : t('top.shareExport')}</button>
      </div>
    </div>
    {error && <div className="toast error" onClick={() => setError('')}>{error}</div>}{notice && <div className="toast success" onClick={() => setNotice('')}>{notice}</div>}
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
            <label>{t('export.description')}<textarea value={demo.description} onChange={event => setDemo({ ...demo, description: event.target.value })} onBlur={() => patchDemo({ description: demo.description })} placeholder={t('export.descriptionPlaceholder')} /></label>
            <label>{t('common:contentLanguage.label')}<select value={demo.content_locale} onChange={event => patchDemo({ content_locale: event.target.value as Demo['content_locale'] })}><option value="zh-CN">{t('common:contentLanguage.zh-CN')}</option><option value="en">{t('common:contentLanguage.en')}</option></select><small>{t('common:contentLanguage.description')}</small></label>
          </section>

          <section>
            <div className="export-section-heading"><span><Icon name="link" />{t('export.shareLink')}</span></div>
            {demo.share_url ? <div className="share-link-card"><span title={demo.share_url}>{demo.share_url}</span><button className={`icon-button ${exportAction === 'copy-share' ? 'action-pending' : ''}`} aria-busy={exportAction === 'copy-share'} disabled={actionBusy} onClick={copyShareLink}>{exportAction === 'copy-share' ? <span className="action-spinner" /> : <Icon name="copy" />}{exportAction === 'copy-share' ? t('export.copying') : t('common:actions.copy')}</button><a className="icon-button" href={demo.share_url} target="_blank" rel="noreferrer"><Icon name="play" />{t('common:actions.open')}</a></div> : <div className="export-empty-note"><Icon name="link" /><span>{t('export.unpublished')}</span></div>}
            <button className={`publish-version-button icon-button ${exportAction === 'publish' ? 'action-pending' : ''}`} aria-busy={exportAction === 'publish'} disabled={actionBusy} onClick={publish}>{exportAction === 'publish' ? <span className="action-spinner" /> : <Icon name="publish" />}{exportAction === 'publish' ? t('export.publishing') : demo.status === 'published' ? t('export.updatePublished') : t('export.publishCreate')}</button>
          </section>

          <section>
            <div className="export-section-heading"><span><Icon name="download" />{t('export.formats')}</span><small>{t('export.syncHint')}</small></div>
            <div className="export-format-grid">
              <button className={exportAction === 'pdf' ? 'action-pending' : ''} aria-busy={exportAction === 'pdf'} disabled={actionBusy || !demo.steps.length} onClick={() => startExport('pdf')}><span><Icon name="text" /></span><div><strong>{exportAction === 'pdf' ? t('export.creatingPdf') : 'PDF'}</strong><small>{exportAction === 'pdf' ? t('export.syncing') : t('export.pdfHint')}</small></div>{exportAction === 'pdf' ? <i className="action-spinner" /> : <Icon name="download" />}</button>
              <button className={exportAction === 'mp4' ? 'action-pending' : ''} aria-busy={exportAction === 'mp4'} disabled={actionBusy || !demo.steps.length} onClick={() => startExport('mp4')}><span><Icon name="play" /></span><div><strong>{exportAction === 'mp4' ? t('export.creatingVideo') : t('export.video')}</strong><small>{exportAction === 'mp4' ? t('export.syncing') : t('export.videoHint')}</small></div>{exportAction === 'mp4' ? <i className="action-spinner" /> : <Icon name="download" />}</button>
              <button className={exportAction === 'markdown' ? 'action-pending' : ''} aria-busy={exportAction === 'markdown'} disabled={actionBusy || !demo.steps.length} onClick={() => startExport('markdown')}><span><Icon name="image" /></span><div><strong>{exportAction === 'markdown' ? t('export.creatingPackage') : t('export.package')}</strong><small>{exportAction === 'markdown' ? t('export.syncing') : t('export.packageHint')}</small></div>{exportAction === 'markdown' ? <i className="action-spinner" /> : <Icon name="download" />}</button>
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
                {job.status === 'complete' && job.download_url ? <a className="icon-button" href={`${API_URL}${job.download_url}`}><Icon name="download" />{t('common:actions.download')}</a> : <span className={`job-status ${job.status}`}>{job.status === 'failed' ? t('common:status.failed') : job.status === 'queued' ? t('common:status.queued') : `${job.progress}%`}</span>}
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
          stepIndex={presentationIndex} stepCount={demo.steps.length} activeHotspotId={selected.hotspots[0]?.id}
          onHotspot={activatePresentation} onGuidePrevious={() => selectPresentationStep(presentationIndex - 1)} onGuideNext={activatePresentation}
          onReady={() => setPresentationReady(true)}
        /></div>
        <nav className="immersive-nav" aria-label={t('presentation.navigation')}>
          <button disabled={!presentationReady || presentationIndex === 0} onClick={() => selectPresentationStep(presentationIndex - 1)} aria-label={t('common:actions.previous')}>‹</button>
          <span><b>{presentationIndex + 1}</b><i />{demo.steps.length}<small>{selected.title || t('steps.step', { index: presentationIndex + 1 })}</small></span>
          <button disabled={!presentationReady || presentationIndex === demo.steps.length - 1} onClick={() => selectPresentationStep(presentationIndex + 1)} aria-label={t('common:actions.next')}>›</button>
        </nav>
      </> : <div className="immersive-empty"><Icon name="image" size={42} /><h2>{t('presentation.empty')}</h2><p>{t('presentation.emptyHint')}</p><button className="primary icon-button" onClick={() => setDetailMode('edit')}><Icon name="edit" />{t('presentation.startEditing')}</button></div>}
    </section> : <div className="editor-layout">
      <aside className="step-list" style={floatingPanelStyle('steps')}>
        <div className="floating-panel-header"><span onPointerDown={event => dragFloatingPanel('steps', event)}><Icon name="move" />{t('mobileDock.steps')}</span><button aria-label={t('common:actions.close')} onClick={() => setMobilePanel(null)}>×</button></div>
        <div className="step-list-scroll">
          <div className="panel-heading"><span>{t('steps.resources')}</span><small>{demo.steps.length}</small></div><label className="upload-button icon-button"><Icon name="image" />{t('steps.addScreenshot')}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => event.target.files?.[0] && upload(event.target.files[0])} /></label>
          {demo.steps.map((step, index) => <button className={`step-item ${selected?.id === step.id ? 'active' : ''}`} title={step.title || t('steps.step', { index: index + 1 })} key={step.id} onClick={() => { setSelectedId(step.id); setSelectedHotspotId(step.hotspots[0]?.id || null) }}><span>{index + 1}</span><img src={step.image_url} alt="" /><div><strong>{t('steps.step', { index: index + 1 })}</strong><small>{step.render_mode === 'dom' ? 'HTML Clone' : t('steps.screenshot')}</small></div></button>)}
        </div>
        <div className="floating-panel-resize-handle" role="separator" aria-label={t('mobileDock.resize')} title={t('mobileDock.resize')} onPointerDown={event => resizeFloatingPanel('steps', event)} />
      </aside>
      <section className="editor-main">
        {selected ? <>
          <div className="stage-toolbar">
            <span className="stage-preview-kind">{selected.render_mode === 'dom' ? t('steps.htmlPreview') : t('steps.imageSlide')}</span>
            <span className="stage-title-tag" title={selected.title || t('steps.step', { index: selected.position + 1 })}><Icon name="text" size={12} />{selected.title || t('steps.step', { index: selected.position + 1 })}</span>
            <div className="stage-toolbar-actions"><div className="stage-mode-switch"><button className={canvasMode === 'preview' ? 'active' : ''} onClick={() => setCanvasMode('preview')}><Icon name="play" />{t('steps.preview')}</button><button className={canvasMode === 'edit' ? 'active' : ''} onClick={() => setCanvasMode('edit')}><Icon name="target" />{t('steps.editHotspot')}</button></div>{selected.snapshot_url && <button className="icon-button" onClick={() => patchStep(selected.id, { render_mode: selected.render_mode === 'dom' ? 'image' : 'dom' })}><Icon name="image" />{selected.render_mode === 'dom' ? t('steps.imageMode') : t('steps.domMode')}</button>}<button className="icon-button" onClick={addHotspot}><Icon name="plus" />Hotspot</button></div>
          </div>
          {visibleCaptureWarnings(selected.capture_warnings).map((warning, index) => <div className="capture-warning" key={index}><Icon name="warning" />{warning}</div>)}
          <div className="mac-preview-window">
            <div className="mac-window-bar"><span className="mac-window-controls"><i /><i /><i /></span><span className="mac-window-caption">{selected.render_mode === 'dom' ? 'Interactive HTML' : 'Screenshot Preview'}</span><span /></div>
            <div className="mac-preview-content"><SlideStage key={selected.id}
              step={selected} mode={canvasMode === 'preview' ? 'player' : 'editor'} theme={demo.theme} navigation={demo.navigation}
              stepIndex={demo.steps.findIndex(step => step.id === selected.id)} stepCount={demo.steps.length} activeHotspotId={selectedHotspot?.id}
              onHotspot={canvasMode === 'preview' ? item => { setSelectedHotspotId(item.id); setTab('tooltip'); setCanvasMode('edit') } : undefined}
              onGuidePrevious={canvasMode === 'preview' ? () => { const index = demo.steps.findIndex(step => step.id === selected.id); const target = demo.steps[Math.max(0, index - 1)]; if (target) { setSelectedId(target.id); setSelectedHotspotId(target.hotspots[0]?.id || null) } } : undefined}
              onGuideNext={canvasMode === 'preview' ? () => { const index = demo.steps.findIndex(step => step.id === selected.id); const target = demo.steps[Math.min(demo.steps.length - 1, index + 1)]; if (target) { setSelectedId(target.id); setSelectedHotspotId(target.hotspots[0]?.id || null) } } : undefined}
              onSelectHotspot={canvasMode === 'edit' ? item => { setSelectedHotspotId(item.id); setTab('hotspot') } : undefined}
              onTarget={canvasMode === 'edit' ? chooseTarget : undefined}
              onRectChange={canvasMode === 'edit' ? (item, rect) => { setSelectedHotspotId(item.id); patchHotspot({ fallback_rect: rect }, item) } : undefined}
              showZoomEditor={tab === 'animation' && canvasMode === 'edit'}
              onZoomRectChange={rect => setZoomRect(selected, rect)}
              onZoomDelete={() => patchStep(selected.id, { animation: { ...(selected.animation || {}), zoom: undefined } })}
            /></div>
          </div>
          <div className="inline-actions step-order action-category"><span>{t('steps.actions')}</span><button className="icon-button" onClick={() => move(selected.id, -1)}><Icon name="arrowUp" />{t('steps.moveUp')}</button><button className="icon-button" onClick={() => move(selected.id, 1)}><Icon name="arrowDown" />{t('steps.moveDown')}</button><button className="danger icon-button" onClick={async () => { await api.deleteStep(id, selected.id); const fresh = await api.demo(id); setDemo(fresh); setSelectedId(fresh.steps[0]?.id || null) }}><Icon name="delete" />{t('steps.delete')}</button></div>
        </> : <div className="empty editor-empty"><h2>{t('steps.empty')}</h2><p>{t('steps.emptyHint')}</p></div>}
      </section>
      <InspectorLayoutContext.Provider value={{
        mode: inspectorLayoutMode,
        activeSection: activeInspectorSection,
        toggleSection: section => setActiveInspectorSection(current => current === section ? null : section),
      }}>
      <aside ref={inspectorPanelRef} className={`publish-panel inspector-panel inspector-layout-${inspectorLayoutMode}`} style={floatingPanelStyle('inspector')}>
        <div className="floating-panel-header"><span onPointerDown={event => dragFloatingPanel('inspector', event)}><Icon name="move" />{t('mobileDock.inspector')}</span><button aria-label={t('common:actions.close')} onClick={() => setMobilePanel(null)}>×</button></div>
        <div className="inspector-tabs">{inspectorTabs.filter(item => item.value !== 'ai' || demo.ai_enabled).map(item => <button className={tab === item.value ? 'active' : ''} key={item.value} onClick={() => { setTab(item.value); if (item.value === 'animation') setCanvasMode('edit') }}><Icon name={item.icon} /><span>{t(`tabs.${item.value}`)}</span></button>)}</div>
        {tab === 'content' && selected && <div className="inspector-body">
          <InspectorSection icon="text" title={t('content.copyTitle')} description={t('content.copyDescription')}>
            <label>{t('content.stepTitle')}<input value={selected.title} onChange={event => setDemo({ ...demo, steps: demo.steps.map(step => step.id === selected.id ? { ...step, title: event.target.value } : step) })} onBlur={() => patchStep(selected.id, { title: selected.title })} /></label>
            <label>{t('content.instructions')}<textarea value={selected.body} onChange={event => setDemo({ ...demo, steps: demo.steps.map(step => step.id === selected.id ? { ...step, body: event.target.value } : step) })} onBlur={() => patchStep(selected.id, { body: selected.body })} /></label>
          </InspectorSection>
          <InspectorSection icon="clock" title={t('content.timing')} description={t('content.timingDescription')}>
            <label>{t('content.duration')}<input type="number" min="1" max="15" step=".5" value={selected.duration} onChange={event => patchStep(selected.id, { duration: Number(event.target.value) })} /></label>
          </InspectorSection>
          {demo.ai_enabled && <InspectorSection icon="ai" title={t('content.smartCopy')} description={t('content.smartCopyDescription')}><button className="icon-button" onClick={() => generateAI(selected.id)}><Icon name="ai" />{t('content.regenerate')}</button></InspectorSection>}
        </div>}
        {tab === 'hotspot' && <div className="inspector-body">
          <InspectorSection icon="target" title={t('hotspot.objects')} description={t('hotspot.objectsDescription')}>
            <div className="hotspot-list">{selected?.hotspots.map((item, index) => <button className={item.id === selectedHotspot?.id ? 'active' : ''} onClick={() => setSelectedHotspotId(item.id)} key={item.id}><Icon name="target" size={13} />{t('hotspot.item', { index: index + 1 })}</button>)}</div>
            <button className="icon-button" onClick={addHotspot}><Icon name="plus" />{t('hotspot.add')}</button>
          </InspectorSection>
          {selectedHotspot ? <>
            <InspectorSection icon="cursor" title={t('hotspot.behavior')} description={t('hotspot.behaviorDescription')}>
              <p className="field-note">{t('hotspot.rebindHint')}</p>
              <label>{t('hotspot.trigger')}<select value={selectedHotspot.trigger} onChange={event => patchHotspot({ trigger: event.target.value as 'click' | 'hover' })}><option value="click">{t('hotspot.click')}</option><option value="hover">{t('hotspot.hover')}</option></select></label>
              <label>{t('hotspot.action')}<select value={selectedHotspot.action.type} onChange={event => patchHotspot({ action: { ...selectedHotspot.action, type: event.target.value as HotspotData['action']['type'] } })}><option value="next">{t('hotspot.next')}</option><option value="goto">{t('hotspot.goto')}</option><option value="link">{t('hotspot.link')}</option><option value="end">{t('hotspot.end')}</option></select></label>
              {selectedHotspot.action.type === 'goto' && <label>{t('hotspot.target')}<select value={selectedHotspot.action.target_step_id || ''} onChange={event => patchHotspot({ action: { ...selectedHotspot.action, target_step_id: event.target.value } })}>{demo.steps.map((step, index) => <option value={step.id} key={step.id}>{index + 1}. {step.title}</option>)}</select></label>}
              {selectedHotspot.action.type === 'link' && <label>{t('hotspot.url')}<input value={selectedHotspot.action.url || ''} placeholder="https://" onChange={event => patchHotspot({ action: { ...selectedHotspot.action, url: event.target.value } })} /></label>}
            </InspectorSection>
            <InspectorSection icon="move" title={t('hotspot.position')} description={t('hotspot.positionDescription')}>
              <div className="rect-grid">{(['x', 'y', 'w', 'h'] as const).map(key => <label key={key}>{key.toUpperCase()}<input type="number" min="0" max="1" step=".01" value={selectedHotspot.fallback_rect[key].toFixed(2)} onChange={event => patchHotspot({ fallback_rect: { ...selectedHotspot.fallback_rect, [key]: Number(event.target.value) } })} /></label>)}</div>
            </InspectorSection>
            <InspectorSection icon="palette" title={t('hotspot.appearance')} description={t('hotspot.appearanceDescription')}>
              <label>{t('hotspot.shape')}<select value={selectedHotspot.style.shape} onChange={event => patchHotspot({ style: { ...selectedHotspot.style, shape: event.target.value as 'rectangle' | 'circle' } })}><option value="rectangle">{t('hotspot.rectangle')}</option><option value="circle">{t('hotspot.circle')}</option></select></label>
              <ColorField label={t('hotspot.color')} value={selectedHotspot.style.color || '#635bff'} onChange={value => patchHotspot({ style: { ...selectedHotspot.style, color: value } })} />
              <div className="toggle-list"><label className="check"><input type="checkbox" checked={selectedHotspot.style.pulse} onChange={event => patchHotspot({ style: { ...selectedHotspot.style, pulse: event.target.checked } })} /><span><strong>{t('hotspot.pulse')}</strong><small>{t('hotspot.pulseHint')}</small></span></label>
              <label className="check"><input type="checkbox" checked={selectedHotspot.style.spotlight} onChange={event => patchHotspot({ style: { ...selectedHotspot.style, spotlight: event.target.checked } })} /><span><strong>{t('hotspot.spotlight')}</strong><small>{t('hotspot.spotlightHint')}</small></span></label></div>
            </InspectorSection>
            <InspectorSection icon="delete" title={t('hotspot.danger')} tone="danger"><button className="danger icon-button" onClick={async () => { await api.deleteHotspot(id, selected!.id, selectedHotspot.id); const fresh = await api.demo(id); setDemo(fresh); setSelectedHotspotId(fresh.steps.find(step => step.id === selected!.id)?.hotspots[0]?.id || null) }}><Icon name="delete" />{t('hotspot.delete')}</button></InspectorSection>
          </> : null}
        </div>}
        {tab === 'tooltip' && selectedHotspot && <div className="inspector-body">
          <InspectorSection icon="message" title={t('tooltip.copy')} description={t('tooltip.copyDescription')}><label>{t('tooltip.content')}<textarea value={selectedHotspot.tooltip.content} onChange={event => updateHotspotLocal({ tooltip: { ...selectedHotspot.tooltip, content: event.target.value } })} onBlur={() => patchHotspot({ tooltip: selectedHotspot.tooltip })} /></label></InspectorSection>
          <InspectorSection icon="layout" title={t('tooltip.layout')} description={t('tooltip.layoutDescription')}>
            <label>{t('tooltip.placement')}<select value={selectedHotspot.tooltip.placement} onChange={event => patchHotspot({ tooltip: { ...selectedHotspot.tooltip, placement: event.target.value } })}>{['auto','top','top-start','top-end','bottom','bottom-start','bottom-end','left','left-start','left-end','right','right-start','right-end'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
            <RangeField label={t('tooltip.offset')} value={selectedHotspot.tooltip.offset} min={0} max={60} suffix=" px" onChange={value => patchHotspot({ tooltip: { ...selectedHotspot.tooltip, offset: value } })} />
            <label>{t('tooltip.maxWidth')}<input type="number" min="160" max="800" value={selectedHotspot.tooltip.max_width} onChange={event => patchHotspot({ tooltip: { ...selectedHotspot.tooltip, max_width: Number(event.target.value) } })} /></label>
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
        {tab === 'animation' && selected && <div className="inspector-body">
          <InspectorSection icon="animation" title="Zoom and Pan" description={t('animation.zoomDescription')}>
            {selected.animation?.zoom?.rect ? <>
              <div className="animation-status"><span><i />{t('animation.enabled')}</span><small>{t('animation.dragHint')}</small></div>
              <div className="field-grid">
                <label>{t('animation.transition')}<input type="number" min="0" max="5000" step="100" value={selected.animation.zoom.transition_duration_ms ?? 1200} onChange={event => updateStepLocal(selected.id, { animation: { ...(selected.animation || {}), zoom: { ...selected.animation.zoom, transition_duration_ms: Number(event.target.value) } } })} onBlur={() => patchStep(selected.id, { animation: selected.animation })} /></label>
                <label>{t('animation.duration')}<input type="number" min="500" max="10000" step="250" value={selected.animation.zoom.duration_ms || 3000} onChange={event => updateStepLocal(selected.id, { animation: { ...(selected.animation || {}), zoom: { ...selected.animation.zoom, duration_ms: Number(event.target.value) } } })} onBlur={() => patchStep(selected.id, { animation: selected.animation })} /></label>
              </div>
              <p className="field-note">{t('animation.mp4Hint')}</p>
              <button className="danger icon-button" onClick={() => patchStep(selected.id, { animation: { ...(selected.animation || {}), zoom: undefined } })}><Icon name="delete" />{t('animation.delete')}</button>
            </> : <>
              <p className="field-note">{t('animation.addHint')}</p>
              <button className="primary icon-button" onClick={() => setZoomRect(selected, defaultZoomRect(selected))}><Icon name="plus" />{t('animation.add')}</button>
            </>}
          </InspectorSection>
          <InspectorSection icon="play" title="Autoplay" description={t('animation.autoplayDescription')}>
            <div className="toggle-list"><label className="check"><input type="checkbox" checked={demo.playback?.autoplay === true} onChange={event => patchDemo({ playback: { ...demo.playback, autoplay: event.target.checked } })} /><span><strong>{t('animation.autoplay')}</strong><small>{t('animation.autoplayHint')}</small></span></label></div>
            <div className="field-grid">
              <label>{t('animation.stepDuration')}<input type="number" min="250" max="60000" step="250" value={demo.playback?.step_duration_ms ?? 2000} onChange={event => setDemo({ ...demo, playback: { ...demo.playback, step_duration_ms: Number(event.target.value) } })} onBlur={() => patchDemo({ playback: demo.playback })} /></label>
              <label>{t('animation.transitionDelay')}<input type="number" min="0" max="30000" step="250" value={demo.playback?.transition_delay_ms ?? 1000} onChange={event => setDemo({ ...demo, playback: { ...demo.playback, transition_delay_ms: Number(event.target.value) } })} onBlur={() => patchDemo({ playback: demo.playback })} /></label>
            </div>
            <div className="toggle-list"><label className="check"><input type="checkbox" checked={demo.playback?.loop === true} onChange={event => patchDemo({ playback: { ...demo.playback, loop: event.target.checked } })} /><span><strong>{t('animation.loop')}</strong><small>{t('animation.loopHint')}</small></span></label></div>
          </InspectorSection>
        </div>}
        {tab === 'ai' && <div className="inspector-body">
          <InspectorSection icon="ai" title={t('ai.generate')} description={t('ai.generateDescription')}>
            <button className="primary icon-button" disabled={Boolean(aiJob && ['queued','running'].includes(aiJob.status))} onClick={() => generateAI()}><Icon name="ai" />{t('ai.generateAll')}</button>
            <p className="field-note">{t('ai.background')}</p>
          </InspectorSection>
          {aiJob && <InspectorSection icon="settings" title={t('ai.recent')}><div className={`ai-job ${aiJob.status}`}><strong>{aiJob.status === 'complete' ? t('ai.complete') : aiJob.status === 'failed' ? t('ai.failed') : t('ai.running')}</strong><span>{aiJob.progress}% · {aiJob.model}</span>{aiJob.status === 'complete' && aiJob.can_revert && <button onClick={async () => { setAIJob(await api.revertAI(aiJob.id)); setDemo(await api.demo(id)) }}>{t('ai.revert')}</button>}</div></InspectorSection>}
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
  </main>
}
