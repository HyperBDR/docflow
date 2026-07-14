import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { API_URL } from '../api'
import type { Step } from '../types'

type Published = { title: string; description: string; steps: Step[] }

export default function Player() {
  const { token } = useParams()
  const [demo, setDemo] = useState<Published | null>(null)
  const [index, setIndex] = useState(0)
  const [error, setError] = useState('')
  useEffect(() => { fetch(`${API_URL}/public/${token}`).then(response => { if (!response.ok) throw new Error('演示不存在或已撤销'); return response.json() }).then(setDemo).catch(value => setError(value.message)) }, [token])
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight' || event.key === ' ') setIndex(value => Math.min((demo?.steps.length || 1) - 1, value + 1))
      if (event.key === 'ArrowLeft') setIndex(value => Math.max(0, value - 1))
    }
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler)
  }, [demo])
  if (!demo) return <main className="player-shell center-page">{error || '正在加载演示…'}</main>
  const step = demo.steps[index]
  if (!step) return <main className="player-shell center-page">这个演示还没有步骤。</main>
  return <main className="player-shell">
    <header><div><strong>{demo.title}</strong><span>{index + 1} / {demo.steps.length}</span></div><button onClick={() => document.documentElement.requestFullscreen()}>全屏</button></header>
    <section className="player-stage">
      <div className="player-frame"><img src={step.image_url} alt={step.title} /><button aria-label="下一步" className="player-hotspot" onClick={() => setIndex(value => Math.min(demo.steps.length - 1, value + 1))} style={{ left: `${step.hotspot.x * 100}%`, top: `${step.hotspot.y * 100}%`, width: `${Math.max(step.hotspot.w, .035) * 100}%`, height: `${Math.max(step.hotspot.h, .035) * 100}%` }} /></div>
    </section>
    <footer><button disabled={index === 0} onClick={() => setIndex(index - 1)}>← 上一步</button><div><h2>{step.title || `步骤 ${index + 1}`}</h2><p>{step.body}</p></div><button disabled={index === demo.steps.length - 1} onClick={() => setIndex(index + 1)}>下一步 →</button></footer>
  </main>
}

