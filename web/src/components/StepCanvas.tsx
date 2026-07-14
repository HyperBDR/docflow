import { useRef, useState } from 'react'
import type { Rect, Step } from '../types'

export default function StepCanvas({ step, onChange }: { step: Step; onChange: (values: Partial<Step>) => void }) {
  const [mode, setMode] = useState<'hotspot' | 'redact'>('hotspot')
  const [start, setStart] = useState<{ x: number; y: number } | null>(null)
  const frame = useRef<HTMLDivElement>(null)
  const point = (event: React.PointerEvent) => {
    const box = frame.current!.getBoundingClientRect()
    return { x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)), y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)) }
  }
  function down(event: React.PointerEvent) {
    if (mode === 'hotspot') {
      const p = point(event)
      onChange({ hotspot: { x: p.x, y: p.y, w: .04, h: .04 } })
    } else setStart(point(event))
  }
  function up(event: React.PointerEvent) {
    if (mode !== 'redact' || !start) return
    const end = point(event)
    const rect: Rect = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), w: Math.abs(end.x - start.x), h: Math.abs(end.y - start.y) }
    setStart(null)
    if (rect.w > .005 && rect.h > .005) onChange({ redactions: [...step.redactions, rect] })
  }
  return <div>
    <div className="canvas-tools"><button className={mode === 'hotspot' ? 'selected' : ''} onClick={() => setMode('hotspot')}>定位热点</button><button className={mode === 'redact' ? 'selected' : ''} onClick={() => setMode('redact')}>绘制遮挡</button>{step.redactions.length > 0 && <button onClick={() => onChange({ redactions: [] })}>清除遮挡</button>}</div>
    <div className="step-canvas" ref={frame} onPointerDown={down} onPointerUp={up}>
      <img src={step.image_url} draggable={false} alt={step.title} />
      <span className="hotspot" style={{ left: `${step.hotspot.x * 100}%`, top: `${step.hotspot.y * 100}%`, width: `${Math.max(step.hotspot.w, .025) * 100}%`, height: `${Math.max(step.hotspot.h, .025) * 100}%` }} />
      {step.redactions.map((rect, index) => <span key={index} className="redaction" style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }} />)}
    </div>
  </div>
}
