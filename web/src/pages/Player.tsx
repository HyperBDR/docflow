import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { API_URL } from '../api'
import { applyLocale, detectedLocale, formatDate, normalizeLocale, PUBLIC_LOCALE_KEY } from '../i18n'
import SlideStage, { preloadSnapshot } from '../components/SlideStage'
import Icon from '../components/Icon'
import LanguageSwitcher from '../components/LanguageSwitcher'
import type { Demo, HotspotData, Step, StepComment } from '../types'

type Published = Pick<Demo, 'title' | 'description' | 'content_locale' | 'theme' | 'navigation' | 'playback'> & { steps: Step[] }

const defaultTheme = { primary_color: '#635bff', tooltip: { background: '#fff', text_color: '#172033', border_color: '#e2e6ed', radius: 12 } }
const defaultNavigation = { previous_color: '#fff', next_color: '#635bff', text_color: '#172033', next_text_color: '#fff', radius: 9, show_previous: true, show_next: true, show_progress: true }
const defaultPlayback = { autoplay: false, step_duration_ms: 2000, transition_delay_ms: 1000, loop: false }

function stableId(storage: Storage, key: string) {
  let value = storage.getItem(key)
  if (!value) {
    value = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
    storage.setItem(key, value)
  }
  return value
}

export default function Player() {
  const { t } = useTranslation('player')
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
  const [locked, setLocked] = useState(false)
  const [password, setPassword] = useState('')
  const [unlocking, setUnlocking] = useState(false)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [comments, setComments] = useState<StepComment[]>([])
  const [commentName, setCommentName] = useState(() => localStorage.getItem('docflow-comment-name') || '')
  const [commentEmail, setCommentEmail] = useState(() => localStorage.getItem('docflow-comment-email') || '')
  const [commentText, setCommentText] = useState('')
  const [commentBusy, setCommentBusy] = useState(false)
  const visitorId = useMemo(() => stableId(localStorage, 'docflow-visitor-id'), [])
  const sessionId = useMemo(() => stableId(sessionStorage, `docflow-session-${token}`), [token])
  useEffect(() => {
    const requested = params.get('lang')
    void applyLocale(requested ? normalizeLocale(requested) : detectedLocale(PUBLIC_LOCALE_KEY), PUBLIC_LOCALE_KEY)
  }, [])
  function track(event_type: 'view' | 'step_view' | 'interaction' | 'complete', step_id?: string) {
    if (exportMode) return
    fetch(`${publicApi}/public/${token}/events`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event_type, visitor_id: visitorId, session_id: sessionId, step_id, referrer: document.referrer, utm_source: params.get('utm_source') || '', utm_medium: params.get('utm_medium') || '', utm_campaign: params.get('utm_campaign') || '', utm_content: params.get('utm_content') || '', utm_term: params.get('utm_term') || '' }), keepalive: true }).catch(() => undefined)
  }
  function load() { setError(''); return fetch(`${publicApi}/public/${token}`, { credentials: 'include' }).then(response => { if (response.status === 401) { setLocked(true); throw new Error('locked') } if (!response.ok) throw new Error(t('notFound')); return response.json() }).then(async value => {
    value.steps = value.steps.map((step: Step) => ({
      ...step,
      image_url: `${publicApi}/public/${token}/assets/${step.id}.webp`,
      // Exported documents and videos need pixel fidelity, not DOM editing.
      // The recorded screenshot is the visual source of truth and avoids
      // missing external CSS, webfonts and runtime-only application styles.
      render_mode: exportMode ? 'image' : step.render_mode,
      snapshot_url: !exportMode && step.render_mode === 'dom' ? `${publicApi}/public/${token}/slides/${step.id}/snapshot${step.snapshot_version ? `?v=${encodeURIComponent(step.snapshot_version)}` : ''}` : undefined,
    }))
    if (exportMode) await applyLocale(value.content_locale || 'zh-CN', PUBLIC_LOCALE_KEY)
    setLocked(false); setDemo(value); setIndex(Math.min(requestedStep, Math.max(0, value.steps.length - 1))); track('view')
  }).catch(value => { if (value.message !== 'locked') setError(value.message) }) }
  useEffect(() => { void load() }, [token, publicApi, requestedStep])
  useEffect(() => setReady(false), [index])
  useEffect(() => {
    if (!demo || exportMode || !ready || !demo.steps[index]) return
    const stepId = demo.steps[index].id
    track('step_view', stepId)
    if (index === demo.steps.length - 1) track('complete', stepId)
  }, [demo, exportMode, index, ready])
  useEffect(() => {
    if (!demo || exportMode) return
    const warm = (offsets: number[]) => offsets.forEach(offset => {
      const candidate = demo.steps[index + offset]
      if (!candidate) return
      const image = new Image()
      image.fetchPriority = offset === 1 ? 'high' : 'low'
      image.src = candidate.image_url
      if (candidate.render_mode === 'dom') preloadSnapshot(candidate.snapshot_url).catch(() => undefined)
    })
    // Warm the next visual immediately. Less likely navigation targets can use
    // the remaining idle bandwidth without competing with the current step.
    warm([1, -1])
    const deferred = window.setTimeout(() => warm([2, 3]), 180)
    return () => window.clearTimeout(deferred)
  }, [demo, exportMode, index])
  useEffect(() => {
    if (!demo || exportMode || !demo.steps[index]) return
    setComments([]); setCommentText('')
    fetch(`${publicApi}/public/${token}/comments?step_id=${encodeURIComponent(demo.steps[index].id)}`, { credentials: 'include' }).then(response => response.ok ? response.json() : []).then(setComments).catch(() => undefined)
  }, [demo, exportMode, index, publicApi, token])
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

  async function unlock(event: React.FormEvent) {
    event.preventDefault(); setUnlocking(true); setError('')
    try {
      const response = await fetch(`${publicApi}/public/${token}/unlock`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
      if (!response.ok) throw new Error(t('passwordIncorrect'))
      await load()
    } catch (value) { setError(value instanceof Error ? value.message : t('passwordIncorrect')) } finally { setUnlocking(false) }
  }
  if (!demo && locked) return <main className="player-shell player-locked"><form onSubmit={unlock}><span><Icon name="lock" size={24} /></span><h1>{t('passwordTitle')}</h1><p>{t('passwordHint')}</p><input autoFocus type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder={t('passwordPlaceholder')} /><button className="primary" disabled={unlocking || !password}>{unlocking ? t('unlocking') : t('unlock')}</button>{error && <small>{error}</small>}</form></main>
  if (!demo) return <main className="player-shell center-page">{error || t('loading')}</main>
  const step = demo.steps[index]
  if (!step) return <main className="player-shell center-page">{t('empty')}</main>
  const theme = { ...defaultTheme, ...(demo.theme || {}), tooltip: { ...defaultTheme.tooltip, ...(demo.theme?.tooltip || {}) } }
  const navigation = {
    ...defaultNavigation,
    previous_label: demo.content_locale === 'en' ? 'Previous' : '上一步',
    next_label: demo.content_locale === 'en' ? 'Next' : '下一步',
    ...(demo.navigation || {}),
  }

  function goTo(next: number) {
    if (!ready) return
    const target = Math.max(0, Math.min(demo!.steps.length - 1, next))
    if (target === index) return
    setReady(false)
    setIndex(target)
  }

  function activate(hotspot: HotspotData) {
    track('interaction', step.id)
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

  async function submitComment(event: React.FormEvent) {
    event.preventDefault(); if (!commentText.trim()) return
    setCommentBusy(true)
    try {
      const response = await fetch(`${publicApi}/public/${token}/comments`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ step_id: step.id, visitor_id: visitorId, author_name: commentName || t('guest'), author_email: commentEmail, content: commentText }) })
      if (!response.ok) throw new Error(t('submitFailed'))
      const comment = await response.json(); setComments(current => [comment, ...current]); setCommentText(''); localStorage.setItem('docflow-comment-name', commentName); localStorage.setItem('docflow-comment-email', commentEmail)
    } catch (value) { setError(value instanceof Error ? value.message : t('submitFailed')) } finally { setCommentBusy(false) }
  }

  return <main className={`player-shell ${exportMode ? 'export-mode' : ''}`} data-export-ready={ready ? 'true' : 'false'} data-step-index={index} style={{ '--player-primary': theme.primary_color } as React.CSSProperties}>
    <header><div><strong>{demo.title}</strong><span>{index + 1} / {demo.steps.length}</span></div><div className="player-header-actions">{!exportMode && <LanguageSwitcher publicMode compact />}<button onClick={() => document.documentElement.requestFullscreen()}>{t('fullscreen')}</button></div></header>
    <section className={`player-stage ${ready ? 'ready' : 'loading'}`}><SlideStage
      step={step} mode="player" fit="viewport" persistZoom exportZoomProgress={exportZoomProgress} theme={theme} navigation={navigation} stepIndex={index} stepCount={demo.steps.length}
      onHotspot={activate} onGuidePrevious={() => goTo(index - 1)} onGuideNext={activate} onReady={() => setReady(true)}
    /></section>
    <footer>
      <button
        hidden={!navigation.show_previous} disabled={!ready || index === 0} onClick={() => goTo(index - 1)}
        style={{ background: navigation.previous_color, color: navigation.text_color, borderRadius: navigation.radius }}
      >← {navigation.previous_label}</button>
      <div><h2>{step.title || t('step', { index: index + 1 })}</h2><p>{step.body}</p>{navigation.show_progress && <div className="player-progress"><span style={{ width: `${(index + 1) / demo.steps.length * 100}%`, background: theme.primary_color }} /></div>}</div>
      <button
        hidden={!navigation.show_next} disabled={!ready || index === demo.steps.length - 1} onClick={() => goTo(index + 1)}
        style={{ background: navigation.next_color, color: navigation.next_text_color, borderRadius: navigation.radius }}
      >{navigation.next_label} →</button>
    </footer>
    {!exportMode && <><button className="player-comment-toggle" onClick={() => setCommentsOpen(value => !value)}><Icon name="message" /><span>{t('comments')}</span>{comments.length > 0 && <b>{comments.length}</b>}</button>{commentsOpen && <aside className="player-comments"><header><div><strong>{t('commentTitle')}</strong><small>{t('commentSubtitle', { index: index + 1 })}</small></div><button onClick={() => setCommentsOpen(false)}>×</button></header><div className="player-comment-list">{comments.map(comment => <article key={comment.id}><div><strong>{comment.author_name}</strong><time>{formatDate(comment.created_at)}</time></div><p>{comment.content}</p></article>)}{!comments.length && <div className="player-comment-empty"><Icon name="message" size={28} /><p>{t('commentEmpty')}</p></div>}</div><form onSubmit={submitComment}><div><input value={commentName} onChange={event => setCommentName(event.target.value)} placeholder={t('namePlaceholder')} maxLength={100} /><input type="email" value={commentEmail} onChange={event => setCommentEmail(event.target.value)} placeholder={t('emailPlaceholder')} maxLength={320} /></div><textarea required value={commentText} onChange={event => setCommentText(event.target.value)} placeholder={t('commentPlaceholder')} maxLength={5000} /><button className="primary" disabled={commentBusy || !commentText.trim()}>{commentBusy ? t('submitting') : t('submit')}</button></form></aside>}</>}
  </main>
}
