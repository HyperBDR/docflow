import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { API_URL } from '../api'
import SlideStage from '../components/SlideStage'
import type { Demo, HotspotData, Step } from '../types'

type Published = Pick<Demo, 'title' | 'description' | 'theme' | 'navigation' | 'playback'> & { steps: Step[] }

const defaultTheme = { primary_color: '#635bff', tooltip: { background: '#fff', text_color: '#172033', border_color: '#e2e6ed', radius: 12 } }
const defaultNavigation = { previous_label: '上一步', next_label: '下一步', previous_color: '#fff', next_color: '#635bff', text_color: '#172033', next_text_color: '#fff', radius: 9, show_previous: true, show_next: true, show_progress: true }
const defaultPlayback = { autoplay: false, step_duration_ms: 2000, transition_delay_ms: 1000, loop: false }

export default function Player() {
  const { token } = useParams()
  const params = new URLSearchParams(window.location.search)
  const publicApi = params.get('api') || API_URL
  const requestedStep = Math.max(0, Number(params.get('step') || 0))
  const exportMode = params.get('export') === '1'
  const [demo, setDemo] = useState<Published | null>(null)
  const [index, setIndex] = useState(0)
  const [ready, setReady] = useState(false)
  const [exportZoomProgress, setExportZoomProgress] = useState<number | undefined>(exportMode ? 0 : undefined)
  const [error, setError] = useState('')
  useEffect(() => { fetch(`${publicApi}/public/${token}`).then(response => { if (!response.ok) throw new Error('演示不存在或已撤销'); return response.json() }).then(value => {
    value.steps = value.steps.map((step: Step) => ({
      ...step,
      image_url: `${publicApi}/public/${token}/assets/${step.id}.webp`,
      // Exported documents and videos need pixel fidelity, not DOM editing.
      // The recorded screenshot is the visual source of truth and avoids
      // missing external CSS, webfonts and runtime-only application styles.
      render_mode: exportMode ? 'image' : step.render_mode,
      snapshot_url: !exportMode && step.render_mode === 'dom' ? `${publicApi}/public/${token}/slides/${step.id}/snapshot` : undefined,
    }))
    setDemo(value); setIndex(Math.min(requestedStep, Math.max(0, value.steps.length - 1)))
  }).catch(value => setError(value.message)) }, [token, publicApi, requestedStep])
  useEffect(() => setReady(false), [index])
  useEffect(() => {
    if (!exportMode) return
    const target = window as typeof window & { __DOCFLOW_SET_ZOOM_PROGRESS__?: (progress: number) => Promise<void> }
    target.__DOCFLOW_SET_ZOOM_PROGRESS__ = (progress: number) => new Promise(resolve => {
      setExportZoomProgress(Math.max(0, Math.min(1, Number(progress) || 0)))
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
    return () => { delete target.__DOCFLOW_SET_ZOOM_PROGRESS__ }
  }, [exportMode, index])
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!ready) return
      if (event.key === 'ArrowRight' || event.key === ' ') goTo(index + 1)
      if (event.key === 'ArrowLeft') goTo(index - 1)
    }
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler)
  }, [demo, index, ready])
  useEffect(() => {
    if (!demo || exportMode || !ready) return
    const playback = { ...defaultPlayback, ...(demo.playback || {}) }
    if (!playback.autoplay || demo.steps.length < 2) return
    const duration = Math.max(250, Math.min(60000, Number(playback.step_duration_ms) || 2000))
    const transitionDelay = Math.max(0, Math.min(30000, Number(playback.transition_delay_ms) || 0))
    const timer = window.setTimeout(() => {
      if (index < demo.steps.length - 1) goTo(index + 1)
      else if (playback.loop) goTo(0)
    }, duration + transitionDelay)
    return () => window.clearTimeout(timer)
  }, [demo, exportMode, index, ready])

  if (!demo) return <main className="player-shell center-page">{error || '正在加载演示…'}</main>
  const step = demo.steps[index]
  if (!step) return <main className="player-shell center-page">这个演示还没有步骤。</main>
  const theme = { ...defaultTheme, ...(demo.theme || {}), tooltip: { ...defaultTheme.tooltip, ...(demo.theme?.tooltip || {}) } }
  const navigation = { ...defaultNavigation, ...(demo.navigation || {}) }

  function goTo(next: number) {
    if (!ready) return
    const target = Math.max(0, Math.min(demo!.steps.length - 1, next))
    if (target === index) return
    setReady(false)
    setIndex(target)
  }

  function activate(hotspot: HotspotData) {
    if (hotspot.action.type === 'goto' && hotspot.action.target_step_id) {
      const target = demo!.steps.findIndex(item => item.id === hotspot.action.target_step_id)
      if (target >= 0) goTo(target)
      return
    }
    if (hotspot.action.type === 'link' && hotspot.action.url) {
      window.open(hotspot.action.url, '_blank', 'noopener,noreferrer')
      return
    }
    if (hotspot.action.type === 'end') {
      goTo(demo!.steps.length - 1)
      return
    }
    goTo(index + 1)
  }

  return <main className={`player-shell ${exportMode ? 'export-mode' : ''}`} data-export-ready={ready ? 'true' : 'false'} data-step-index={index} style={{ '--player-primary': theme.primary_color } as React.CSSProperties}>
    <header><div><strong>{demo.title}</strong><span>{index + 1} / {demo.steps.length}</span></div><button onClick={() => document.documentElement.requestFullscreen()}>全屏</button></header>
    <section className={`player-stage ${ready ? 'ready' : 'loading'}`}><SlideStage key={step.id}
      step={step} mode="player" fit="viewport" persistZoom exportZoomProgress={exportZoomProgress} theme={theme} navigation={navigation} stepIndex={index} stepCount={demo.steps.length}
      onHotspot={activate} onGuidePrevious={() => goTo(index - 1)} onGuideNext={activate} onReady={() => setReady(true)}
    /></section>
    <footer>
      <button
        hidden={!navigation.show_previous} disabled={!ready || index === 0} onClick={() => goTo(index - 1)}
        style={{ background: navigation.previous_color, color: navigation.text_color, borderRadius: navigation.radius }}
      >← {navigation.previous_label}</button>
      <div><h2>{step.title || `步骤 ${index + 1}`}</h2><p>{step.body}</p>{navigation.show_progress && <div className="player-progress"><span style={{ width: `${(index + 1) / demo.steps.length * 100}%`, background: theme.primary_color }} /></div>}</div>
      <button
        hidden={!navigation.show_next} disabled={!ready || index === demo.steps.length - 1} onClick={() => goTo(index + 1)}
        style={{ background: navigation.next_color, color: navigation.next_text_color, borderRadius: navigation.radius }}
      >{navigation.next_label} →</button>
    </footer>
  </main>
}
