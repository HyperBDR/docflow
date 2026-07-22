import { arrow, autoUpdate, flip, FloatingArrow, offset, shift, useFloating, type Placement, type VirtualElement } from '@floating-ui/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
import type { HotspotData, Rect, SelectorInfo, Step } from '../types'

const snapshotCache = new Map<string, Promise<Record<string, unknown>>>()
const SNAPSHOT_CACHE_LIMIT = 12

export function preloadSnapshot(url?: string) {
  if (!url) return Promise.resolve(null)
  const cached = snapshotCache.get(url)
  if (cached) return cached
  const pending = fetch(url, { credentials: 'include' })
    .then(response => { if (!response.ok) throw new Error(i18n.t('guide.snapshotFailed', { ns: 'player' })); return response.json() })
    .catch(error => { snapshotCache.delete(url); throw error })
  snapshotCache.set(url, pending)
  while (snapshotCache.size > SNAPSHOT_CACHE_LIMIT) snapshotCache.delete(snapshotCache.keys().next().value!)
  return pending
}

type TargetSelection = { selector: SelectorInfo; rect: Rect }
type RasterRegion = { x: number; y: number; w: number; h: number; kind: 'iframe' | 'video' | 'canvas' }

function rasterRegions(context: Record<string, unknown>): RasterRegion[] {
  const source = context.raster_regions
  if (!Array.isArray(source)) return []
  return source.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const value = item as Record<string, unknown>
    const x = Number(value.x), y = Number(value.y), w = Number(value.w), h = Number(value.h)
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return []
    const kind: RasterRegion['kind'] = value.kind === 'video' || value.kind === 'canvas' ? value.kind : 'iframe'
    return [{ x, y, w, h, kind }]
  }).slice(0, 40)
}

type Props = {
  step: Step
  mode: 'player' | 'editor'
  fit?: 'width' | 'viewport'
  activeHotspotId?: string
  theme?: Record<string, any>
  navigation?: Record<string, any>
  stepIndex?: number
  stepCount?: number
  onHotspot?: (hotspot: HotspotData) => void
  onSelectHotspot?: (hotspot: HotspotData) => void
  onTarget?: (selection: TargetSelection) => void
  onReady?: () => void
  onGuidePrevious?: () => void
  onGuideNext?: (hotspot: HotspotData) => void
  onRectChange?: (hotspot: HotspotData, rect: Rect) => void
  showZoomEditor?: boolean
  persistZoom?: boolean
  exportZoomProgress?: number
  onZoomRectChange?: (rect: Rect) => void
  onZoomDelete?: () => void
}

function placement(value?: string, alignment?: string): Placement {
  const allowed = new Set(['top', 'top-start', 'top-end', 'bottom', 'bottom-start', 'bottom-end', 'left', 'left-start', 'left-end', 'right', 'right-start', 'right-end'])
  if (allowed.has(value || '')) {
    if (value?.includes('-') || !alignment || alignment === 'center') return value as Placement
    const aligned = `${value}-${alignment}`
    return allowed.has(aligned) ? aligned as Placement : value as Placement
  }
  return alignment === 'start' || alignment === 'end' ? `bottom-${alignment}` : 'bottom'
}

function HotspotLayer({ hotspot, rect, active, mode, wrapper, theme, navigation, stepIndex = 0, stepCount = 1, onActivate, onSelect, onGuidePrevious, onGuideNext, onRectChange }: {
  hotspot: HotspotData; rect: Rect; active: boolean; mode: Props['mode']; wrapper: HTMLDivElement | null
  theme?: Record<string, any>; navigation?: Record<string, any>; stepIndex?: number; stepCount?: number
  onActivate?: () => void; onSelect?: () => void; onGuidePrevious?: () => void; onGuideNext?: () => void; onRectChange?: (rect: Rect) => void
}) {
  const { t } = useTranslation('player')
  const arrowRef = useRef<SVGSVGElement>(null)
  const { refs, floatingStyles, context } = useFloating({
    placement: placement(hotspot.tooltip?.placement, hotspot.tooltip?.alignment),
    strategy: 'fixed',
    middleware: [offset(hotspot.tooltip?.offset ?? 12), flip({ padding: 12 }), shift({ padding: 12 }), arrow({ element: arrowRef })],
    whileElementsMounted: autoUpdate,
  })
  useLayoutEffect(() => {
    if (!wrapper) return
    const virtual: VirtualElement = {
      getBoundingClientRect: () => {
        const box = wrapper.getBoundingClientRect()
        const width = rect.w * box.width
        const height = rect.h * box.height
        const left = box.left + (rect.x - rect.w / 2) * box.width
        const top = box.top + (rect.y - rect.h / 2) * box.height
        return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) }
      },
    }
    refs.setPositionReference(virtual)
  }, [wrapper, rect, refs])

  const color = hotspot.style?.color || theme?.primary_color || '#635bff'
  const hotspotBackground = /^#[0-9a-f]{6}$/i.test(color) ? `${color}1f` : 'rgba(99, 91, 255, .12)'
  const tooltipTheme = theme?.tooltip || {}
  const guideNavigation = {
    previous_label: t('common:actions.previous'), next_label: t('common:actions.next'), previous_color: '#ffffff', next_color: color,
    text_color: '#172033', next_text_color: '#ffffff', radius: 9, show_previous: true, show_next: true,
    ...(navigation || {}),
  }
  const hotspotPadding = hotspot.style?.padding ?? 6
  const startDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (mode !== 'editor' || !wrapper) return
    event.preventDefault(); event.stopPropagation()
    const button = event.currentTarget, box = wrapper.getBoundingClientRect(), startX = event.clientX, startY = event.clientY
    const resizing = (event.target as HTMLElement).classList.contains('hotspot-resize-handle')
    button.setPointerCapture(event.pointerId)
    const move = (next: PointerEvent) => {
      const dx = (next.clientX - startX) / box.width, dy = (next.clientY - startY) / box.height
      if (resizing) {
        button.style.width = `${Math.max(.015, Math.min(1, rect.w + dx * 2)) * 100}%`
        button.style.height = `${Math.max(.015, Math.min(1, rect.h + dy * 2)) * 100}%`
      } else {
        button.style.left = `${Math.max(0, Math.min(1, rect.x + dx)) * 100}%`
        button.style.top = `${Math.max(0, Math.min(1, rect.y + dy)) * 100}%`
      }
    }
    const up = (next: PointerEvent) => {
      const dx = (next.clientX - startX) / box.width, dy = (next.clientY - startY) / box.height
      const updated = resizing
        ? { ...rect, w: Math.max(.015, Math.min(1, rect.w + dx * 2)), h: Math.max(.015, Math.min(1, rect.h + dy * 2)) }
        : { ...rect, x: Math.max(0, Math.min(1, rect.x + dx)), y: Math.max(0, Math.min(1, rect.y + dy)) }
      button.removeEventListener('pointermove', move); button.removeEventListener('pointerup', up)
      onRectChange?.(updated)
    }
    button.addEventListener('pointermove', move); button.addEventListener('pointerup', up)
  }
  return <>
    <button
      type="button"
      aria-label={hotspot.tooltip?.content || t('guide.hotspot')}
      className={`interactive-hotspot ${hotspot.style?.pulse ? 'pulse' : ''} ${mode === 'editor' ? 'editing' : ''}`}
      style={{
        left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `calc(${Math.max(rect.w, .012) * 100}% + ${hotspotPadding * 2}px)`,
        height: `calc(${Math.max(rect.h, .012) * 100}% + ${hotspotPadding * 2}px)`, borderRadius: hotspot.style?.shape === 'circle' ? '999px' : '9px',
        borderColor: color, color, backgroundColor: hotspotBackground,
        boxShadow: hotspot.style?.spotlight && active ? `0 0 0 9999px rgba(17,24,39,${hotspot.style.overlay_opacity ?? .45})` : undefined,
      }}
      onClick={event => { event.stopPropagation(); mode === 'editor' ? onSelect?.() : onActivate?.() }}
      onMouseEnter={() => { if (mode === 'player' && hotspot.trigger === 'hover') onActivate?.() }}
      onPointerDown={startDrag}
    >{mode === 'editor' && <span className="hotspot-resize-handle" />}</button>
    {active && hotspot.tooltip?.content && <div
      ref={refs.setFloating}
      className="interactive-tooltip"
      style={{
        ...floatingStyles, maxWidth: hotspot.tooltip.max_width || 320,
        background: tooltipTheme.background || '#fff', color: tooltipTheme.text_color || '#172033',
        borderColor: tooltipTheme.border_color || '#e2e6ed', borderRadius: tooltipTheme.radius ?? 12,
      }}
    >
      {hotspot.tooltip.show_arrow !== false && <FloatingArrow ref={arrowRef} context={context} width={18} height={9} tipRadius={2} fill={tooltipTheme.background || '#fff'} stroke={tooltipTheme.border_color || '#e2e6ed'} strokeWidth={1} />}
      <span className="tooltip-kicker"><i style={{ background: color }} />{t('guide.kicker')}</span>
      <strong>{hotspot.tooltip.content}</strong>
      <small>{hotspot.trigger === 'hover' ? t('guide.hoverHint') : t('guide.clickHint')}</small>
      <div className="tooltip-actions">
        {guideNavigation.show_previous !== false && <button
          type="button" disabled={stepIndex <= 0 || !onGuidePrevious}
          onClick={event => { event.preventDefault(); event.stopPropagation(); onGuidePrevious?.() }}
          style={{ background: guideNavigation.previous_color, color: guideNavigation.text_color, borderRadius: guideNavigation.radius }}
        ><span>←</span>{guideNavigation.previous_label}</button>}
        <span className="tooltip-step">{Math.min(stepIndex + 1, stepCount)} / {stepCount}</span>
        {guideNavigation.show_next !== false && <button
          type="button" disabled={!onGuideNext || (stepIndex >= stepCount - 1 && hotspot.action.type === 'next')}
          onClick={event => { event.preventDefault(); event.stopPropagation(); onGuideNext?.() }}
          style={{ background: guideNavigation.next_color, color: guideNavigation.next_text_color, borderColor: guideNavigation.next_color, borderRadius: guideNavigation.radius }}
        >{guideNavigation.next_label}<span>→</span></button>}
      </div>
    </div>}
  </>
}

function ZoomRegionLayer({ rect, wrapper, hotspots, onChange, onPreview, onDelete }: {
  rect: Rect
  wrapper: HTMLDivElement | null
  hotspots: HotspotData[]
  onChange?: (rect: Rect) => void
  onPreview: () => void
  onDelete?: () => void
}) {
  const { t } = useTranslation('player')
  const [help, setHelp] = useState(false)
  const primary = hotspots[0]?.fallback_rect
  const containsPrimary = !primary || (
    primary.x - primary.w / 2 >= rect.x - rect.w / 2
    && primary.x + primary.w / 2 <= rect.x + rect.w / 2
    && primary.y - primary.h / 2 >= rect.y - rect.h / 2
    && primary.y + primary.h / 2 <= rect.y + rect.h / 2
  )
  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!wrapper) return
    event.preventDefault(); event.stopPropagation()
    const region = event.currentTarget, box = wrapper.getBoundingClientRect(), startX = event.clientX, startY = event.clientY
    const resizing = (event.target as HTMLElement).classList.contains('zoom-resize-handle')
    region.setPointerCapture(event.pointerId)
    const calculate = (next: PointerEvent) => {
      const dx = (next.clientX - startX) / box.width, dy = (next.clientY - startY) / box.height
      if (resizing) return {
        ...rect,
        w: Math.max(.12, Math.min(2 * Math.min(rect.x, 1 - rect.x), rect.w + dx * 2)),
        h: Math.max(.12, Math.min(2 * Math.min(rect.y, 1 - rect.y), rect.h + dy * 2)),
      }
      return {
        ...rect,
        x: Math.max(rect.w / 2, Math.min(1 - rect.w / 2, rect.x + dx)),
        y: Math.max(rect.h / 2, Math.min(1 - rect.h / 2, rect.y + dy)),
      }
    }
    const move = (next: PointerEvent) => {
      const value = calculate(next)
      Object.assign(region.style, { left: `${value.x * 100}%`, top: `${value.y * 100}%`, width: `${value.w * 100}%`, height: `${value.h * 100}%` })
    }
    const up = (next: PointerEvent) => {
      region.removeEventListener('pointermove', move); region.removeEventListener('pointerup', up)
      onChange?.(calculate(next))
    }
    region.addEventListener('pointermove', move); region.addEventListener('pointerup', up)
  }
  return <>
    <div className="zoom-region-editor" style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }} onPointerDown={startDrag}>
      <span className="zoom-region-label">Zoom area</span><span className="zoom-resize-handle" />
    </div>
    <div className="zoom-region-controls" style={{ left: `${rect.x * 100}%`, top: `${Math.min(.94, rect.y + rect.h / 2) * 100}%` }} onClick={event => event.stopPropagation()}>
      <button className="zoom-preview" onClick={onPreview}><span>▶</span>Zoom Preview</button>
      <button title={t('guide.deleteZoom')} onClick={onDelete}>×</button>
      <button title={t('guide.zoomHelpTitle')} onClick={() => setHelp(value => !value)}>?</button>
      {!containsPrimary && <button className="zoom-warning" title={t('guide.zoomWarning')}>!</button>}
      {help && <div className="zoom-help">{t('guide.zoomHelp')}</div>}
    </div>
  </>
}

function zoomedRect(rect: Rect, scale: number, offsetX: number, offsetY: number): Rect {
  return { x: rect.x * scale + offsetX, y: rect.y * scale + offsetY, w: rect.w * scale, h: rect.h * scale }
}

export default function SlideStage({ step, mode, fit = 'width', activeHotspotId, theme, navigation, stepIndex = 0, stepCount = 1, onHotspot, onSelectHotspot, onTarget, onReady, onGuidePrevious, onGuideNext, onRectChange, showZoomEditor = false, persistZoom = false, exportZoomProgress, onZoomRectChange, onZoomDelete }: Props) {
  const { t } = useTranslation('player')
  const shellRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [snapshot, setSnapshot] = useState<Record<string, unknown> | null>(null)
  const [loadedSnapshotUrl, setLoadedSnapshotUrl] = useState('')
  const [frameReadyVersion, setFrameReadyVersion] = useState(0)
  const [dynamicRects, setDynamicRects] = useState<Record<string, Rect>>({})
  const [error, setError] = useState('')
  const [scale, setScale] = useState(1)
  const [contentReady, setContentReady] = useState(false)
  const [previewReady, setPreviewReady] = useState(false)
  const [zoomActive, setZoomActive] = useState(false)
  const zoomTimer = useRef<number | undefined>(undefined)
  const fallbackRegions = useMemo(() => rasterRegions(step.page_context || {}), [step.id, step.page_context])
  const legacyIframeFallback = fallbackRegions.length === 0 && step.capture_warnings?.some(warning => warning.startsWith('Cross-origin iframe content may use a raster fallback'))
  const useDom = step.render_mode === 'dom' && Boolean(step.snapshot_url) && !legacyIframeFallback
  const zoom = step.animation?.zoom
  const zoomRect = zoom?.rect
  const zoomTransitionDuration = Math.max(0, Math.min(5000, Number(zoom?.transition_duration_ms ?? 1200)))
  const deterministicZoom = exportZoomProgress !== undefined
  const effectiveZoomProgress = deterministicZoom ? Math.max(0, Math.min(1, exportZoomProgress)) : zoomActive ? 1 : 0
  const zoomVisible = effectiveZoomProgress > 0

  const runZoomPreview = useCallback(() => {
    if (!zoomRect) return
    window.clearTimeout(zoomTimer.current)
    setZoomActive(true)
    if (!persistZoom) zoomTimer.current = window.setTimeout(() => setZoomActive(false), zoom.duration_ms || 3000)
  }, [persistZoom, zoom?.duration_ms, zoomRect])

  useEffect(() => {
    setError(''); setDynamicRects({}); setContentReady(false); setPreviewReady(false); setZoomActive(false)
    const notifyCachedImage = requestAnimationFrame(() => {
      const image = wrapperRef.current?.querySelector('img')
      if (!image?.complete || image.naturalWidth <= 0) return
      setPreviewReady(true)
      if (!useDom) setContentReady(true)
      if (!useDom || mode === 'player') onReady?.()
    })
    if (!useDom || !step.snapshot_url) {
      setSnapshot(null); setLoadedSnapshotUrl('')
      return () => cancelAnimationFrame(notifyCachedImage)
    }
    const url = step.snapshot_url
    let cancelled = false
    preloadSnapshot(url)
      .then(value => { if (!cancelled && value) { setSnapshot(value); setLoadedSnapshotUrl(url) } })
      .catch(value => { if (!cancelled) setError(value.message) })
    return () => { cancelled = true; cancelAnimationFrame(notifyCachedImage) }
  }, [step.id, step.snapshot_url, useDom, mode])

  useEffect(() => {
    const target = fit === 'viewport' ? shellRef.current : wrapperRef.current
    if (!target) return
    const update = () => {
      const widthScale = target.clientWidth / step.viewport_width
      const heightScale = fit === 'viewport' ? target.clientHeight / step.viewport_height : Number.POSITIVE_INFINITY
      setScale(Math.max(.01, Math.min(widthScale, heightScale, fit === 'viewport' ? Number.POSITIVE_INFINITY : 1)))
    }
    const observer = new ResizeObserver(update); observer.observe(target); update()
    return () => observer.disconnect()
  }, [fit, step.viewport_width, step.viewport_height])

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return
      // READY can be emitted again after the iframe is recreated following a
      // failed reconstruction. A counter guarantees that the load effect runs
      // again instead of being swallowed by an already-true boolean state.
      if (event.data?.type === 'DOCFLOW_READY') setFrameReadyVersion(value => value + 1)
      if (event.data?.type === 'DOCFLOW_LOADED') { setContentReady(true); onReady?.() }
      if (event.data?.type === 'DOCFLOW_RECTS') setDynamicRects(event.data.rects || {})
      if (event.data?.type === 'DOCFLOW_HOTSPOT') {
        const hotspot = step.hotspots.find(item => item.id === event.data.hotspotId)
        if (hotspot) onHotspot?.(hotspot)
      }
      if (event.data?.type === 'DOCFLOW_TARGET') onTarget?.({ selector: event.data.selector, rect: event.data.rect })
      if (event.data?.type === 'DOCFLOW_ERROR') setError(event.data.error || t('guide.rebuildFailed'))
    }
    window.addEventListener('message', listener)
    return () => window.removeEventListener('message', listener)
  }, [step.hotspots, onHotspot, onTarget, onReady])

  useEffect(() => {
    if (!snapshot || loadedSnapshotUrl !== step.snapshot_url || frameReadyVersion === 0 || !iframeRef.current?.contentWindow) return
    if (mode === 'player' && !previewReady) return
    const loadDom = () => iframeRef.current?.contentWindow?.postMessage({
      type: 'DOCFLOW_LOAD', snapshot, hotspots: step.hotspots, mode, scroll: step.scroll_state,
    }, '*')
    if (mode !== 'player') { loadDom(); return }
    // DOM reconstruction can occupy the renderer's main thread. Let the
    // screenshot and fallback hotspot paint first, then hydrate while idle.
    if (window.requestIdleCallback) {
      const idle = window.requestIdleCallback(loadDom, { timeout: 900 })
      return () => window.cancelIdleCallback(idle)
    }
    const timer = window.setTimeout(loadDom, 120)
    return () => window.clearTimeout(timer)
  }, [snapshot, loadedSnapshotUrl, frameReadyVersion, step.id, step.snapshot_url, step.hotspots, step.scroll_state, mode, previewReady])

  useEffect(() => {
    if (!error) return
    const frame = requestAnimationFrame(() => { setContentReady(true); onReady?.() })
    return () => cancelAnimationFrame(frame)
  }, [error, onReady])

  useEffect(() => {
    if (deterministicZoom || mode !== 'player' || !contentReady || !zoom?.enabled || !zoomRect) return
    const start = window.setTimeout(runZoomPreview, 250)
    return () => { window.clearTimeout(start); window.clearTimeout(zoomTimer.current); setZoomActive(false) }
  }, [deterministicZoom, mode, contentReady, step.id, zoom?.enabled, zoomRect?.x, zoomRect?.y, zoomRect?.w, zoomRect?.h, runZoomPreview])

  useEffect(() => () => window.clearTimeout(zoomTimer.current), [])

  const activeId = activeHotspotId || step.hotspots[0]?.id
  const stageHeight = fit === 'viewport' ? Math.max(1, step.viewport_height * scale) : Math.max(240, step.viewport_height * scale)
  const stageWidth = fit === 'viewport' ? Math.max(1, step.viewport_width * scale) : undefined
  const fallback = !useDom || Boolean(error)
  const interactionReady = contentReady || (mode === 'player' && previewReady)
  const showDomFrame = useDom && !error && Boolean(snapshot)
  const showScreenshot = fallback || !contentReady
  const zoomTransform = useMemo(() => {
    if (!zoomRect || effectiveZoomProgress <= 0) return { scale: 1, x: 0, y: 0, css: 'translate(0, 0) scale(1)' }
    const targetScale = Math.max(1, Math.min(4, Math.min(1 / zoomRect.w, 1 / zoomRect.h) * .94))
    const targetX = .5 - zoomRect.x * targetScale, targetY = .5 - zoomRect.y * targetScale
    const zoomScale = 1 + (targetScale - 1) * effectiveZoomProgress
    const x = targetX * effectiveZoomProgress, y = targetY * effectiveZoomProgress
    return { scale: zoomScale, x, y, css: `translate(${x * 100}%, ${y * 100}%) scale(${zoomScale})` }
  }, [effectiveZoomProgress, zoomRect?.x, zoomRect?.y, zoomRect?.w, zoomRect?.h])
  // SnapshotFrame is trusted DocFlow code and needs same-origin access to the
  // script-free inner iframe created by rrweb. Captured content stays in the
  // inner iframe, whose sandbox does not permit scripts.
  return <div ref={shellRef} className={`slide-stage-shell ${fit === 'viewport' ? 'viewport-fit' : ''}`}>
    {error && <div className="capture-warning">{t('guide.fallback', { error })}</div>}
    <div
      ref={wrapperRef}
      className={`slide-stage ${mode} ${zoomVisible ? 'zoom-previewing' : ''}`}
      style={{ width: stageWidth, height: stageHeight, aspectRatio: `${step.viewport_width}/${step.viewport_height}` }}
      onClick={event => {
        if (mode !== 'editor' || !fallback || !onTarget) return
        const box = event.currentTarget.getBoundingClientRect()
        onTarget({ selector: {}, rect: { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height, w: .05, h: .05 } })
      }}
    >
      <div className={`slide-visual-surface ${zoomVisible ? 'zoom-active' : ''}`} style={{ transform: zoomTransform.css, transitionDuration: deterministicZoom ? '0ms' : `${zoomTransitionDuration}ms` }}>
        {showScreenshot && <img src={step.image_url} draggable={false} alt={step.title} onLoad={() => {
          setPreviewReady(true)
          if (fallback) setContentReady(true)
          if (fallback || mode === 'player') onReady?.()
        }} />}
        {showDomFrame && <iframe
          ref={iframeRef}
          title={step.title}
          src="/snapshot-frame"
          sandbox="allow-scripts allow-same-origin"
          style={{ width: step.viewport_width, height: step.viewport_height, transform: `scale(${scale})`, opacity: contentReady ? 1 : 0 }}
        />}
        {showDomFrame && contentReady && fallbackRegions.map((region, index) => <div
          className="raster-fallback-region"
          key={`${region.kind}-${index}`}
          style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.w * 100}%`, height: `${region.h * 100}%` }}
        ><img src={step.image_url} alt="" draggable={false} style={{
          width: `${100 / region.w}%`, height: `${100 / region.h}%`,
          left: `${-region.x / region.w * 100}%`, top: `${-region.y / region.h * 100}%`,
        }} /></div>)}
      </div>
      {!contentReady && !previewReady && <div className="slide-transition-loading"><span /><b>{t('guide.loadingNext')}</b></div>}
      {!contentReady && previewReady && useDom && <div className="slide-background-loading"><span />{t('guide.loadingPage')}</div>}
      {interactionReady && step.hotspots.map(hotspot => <HotspotLayer
        key={hotspot.id} hotspot={hotspot} rect={zoomedRect(dynamicRects[hotspot.id] || hotspot.fallback_rect, zoomTransform.scale, zoomTransform.x, zoomTransform.y)}
        active={hotspot.id === activeId} mode={mode} wrapper={wrapperRef.current} theme={theme} navigation={navigation} stepIndex={stepIndex} stepCount={stepCount}
        onActivate={() => onHotspot?.(hotspot)} onSelect={() => onSelectHotspot?.(hotspot)}
        onGuidePrevious={onGuidePrevious} onGuideNext={() => onGuideNext?.(hotspot)}
        onRectChange={rect => onRectChange?.(hotspot, rect)}
      />)}
      {interactionReady && showZoomEditor && zoomRect && !zoomVisible && <ZoomRegionLayer rect={zoomRect} wrapper={wrapperRef.current} hotspots={step.hotspots} onChange={onZoomRectChange} onPreview={runZoomPreview} onDelete={onZoomDelete} />}
    </div>
  </div>
}
