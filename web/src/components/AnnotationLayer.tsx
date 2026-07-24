import { useRef, useState } from 'react'
import type { AnnotationRect } from '../types'
import { moveAnnotation, resizeAnnotation, type AnnotationResizeEdge } from '../editor/annotationRects'

export type AnnotationTool = 'mosaic' | 'blur'

const pointIn = (event: PointerEvent | React.PointerEvent, frame: HTMLElement) => {
  const box = frame.getBoundingClientRect()
  return {
    x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)),
    y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)),
  }
}

const fromPoints = (start: { x: number; y: number }, end: { x: number; y: number }, kind: AnnotationTool): AnnotationRect => ({
  x: Math.min(start.x, end.x), y: Math.min(start.y, end.y),
  w: Math.abs(end.x - start.x), h: Math.abs(end.y - start.y),
  kind,
})

export default function AnnotationLayer({ annotations, tool, editable = false, selectedIndex, onSelect, onAdd, onChange }: {
  annotations: AnnotationRect[]
  tool: AnnotationTool | null
  editable?: boolean
  selectedIndex?: number | null
  onSelect?: (index: number | null) => void
  onAdd?: (annotation: AnnotationRect) => void
  onChange?: (index: number, annotation: AnnotationRect) => void
}) {
  const frame = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<AnnotationRect | null>(null)
  const [liveEdit, setLiveEdit] = useState<{ index: number; annotation: AnnotationRect } | null>(null)

  const startDrawing = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!tool || !frame.current || event.target !== event.currentTarget) return
    event.preventDefault(); event.stopPropagation()
    onSelect?.(null)
    const layer = event.currentTarget, start = pointIn(event, frame.current)
    layer.setPointerCapture(event.pointerId)
    const move = (next: PointerEvent) => setDraft(fromPoints(start, pointIn(next, layer), tool))
    const finish = (next: PointerEvent) => {
      const value = fromPoints(start, pointIn(next, layer), tool)
      layer.removeEventListener('pointermove', move)
      layer.removeEventListener('pointerup', finish)
      layer.removeEventListener('pointercancel', cancel)
      setDraft(null)
      if (value.w >= .006 && value.h >= .006) onAdd?.(value)
    }
    const cancel = () => {
      layer.removeEventListener('pointermove', move)
      layer.removeEventListener('pointerup', finish)
      layer.removeEventListener('pointercancel', cancel)
      setDraft(null)
    }
    layer.addEventListener('pointermove', move)
    layer.addEventListener('pointerup', finish)
    layer.addEventListener('pointercancel', cancel)
  }

  const startEditing = (index: number, event: React.PointerEvent<HTMLSpanElement>) => {
    if (!editable || !frame.current) return
    event.preventDefault(); event.stopPropagation()
    onSelect?.(index)
    const mark = event.currentTarget, frameBox = frame.current.getBoundingClientRect()
    const startX = event.clientX, startY = event.clientY, initial = annotations[index]
    const edge = (event.target as HTMLElement).closest<HTMLElement>('[data-annotation-resize]')?.dataset.annotationResize as AnnotationResizeEdge | undefined
    mark.setPointerCapture(event.pointerId)
    const valueAt = (next: PointerEvent) => {
      const dx = (next.clientX - startX) / frameBox.width, dy = (next.clientY - startY) / frameBox.height
      return edge ? resizeAnnotation(initial, edge, dx, dy) : moveAnnotation(initial, dx, dy)
    }
    const cleanup = () => {
      mark.removeEventListener('pointermove', move)
      mark.removeEventListener('pointerup', finish)
      mark.removeEventListener('pointercancel', cancel)
    }
    const move = (next: PointerEvent) => setLiveEdit({ index, annotation: valueAt(next) })
    const finish = (next: PointerEvent) => {
      const annotation = valueAt(next)
      cleanup(); setLiveEdit(null); onChange?.(index, annotation)
    }
    const cancel = () => { cleanup(); setLiveEdit(null) }
    mark.addEventListener('pointermove', move)
    mark.addEventListener('pointerup', finish)
    mark.addEventListener('pointercancel', cancel)
  }

  const visible = annotations.map((annotation, index) => liveEdit?.index === index ? liveEdit.annotation : annotation)
  return <div ref={frame} className={`annotation-layer ${tool ? 'drawing' : ''} ${editable ? 'editing' : ''}`} onPointerDown={startDrawing} onClick={event => { if (tool) { event.preventDefault(); event.stopPropagation() } }}>
    {[...visible, ...(draft ? [draft] : [])].map((annotation, index) => <span
      key={`${index}-${annotation.kind || 'cover'}`}
      className={`annotation-mark ${annotation.kind || 'cover'} ${draft && index === annotations.length ? 'draft' : ''} ${selectedIndex === index ? 'selected' : ''}`}
      style={{
        left: `${annotation.x * 100}%`, top: `${annotation.y * 100}%`,
        width: `${annotation.w * 100}%`, height: `${annotation.h * 100}%`,
        backgroundColor: annotation.kind === 'cover' || !annotation.kind ? annotation.color || '#23272f' : undefined,
      }}
      onPointerDown={event => { if (index < annotations.length) startEditing(index, event) }}
      onClick={event => { event.preventDefault(); event.stopPropagation(); if (index < annotations.length) onSelect?.(index) }}
    >{selectedIndex === index && editable && <>
      {(['n','ne','e','se','s','sw','w','nw'] as const).map(edge => <i key={edge} className={`annotation-resize annotation-resize-${edge}`} data-annotation-resize={edge} />)}
    </>}</span>)}
  </div>
}
