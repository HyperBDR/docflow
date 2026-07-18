import { FloatingPortal, flip, offset, shift, useFloating } from '@floating-ui/react'
import { useLayoutEffect, type ReactNode } from 'react'

export type ChartPointer = { x: number; y: number }

export default function FloatingChartTooltip({ children, className, pointer }: {
  children: ReactNode
  className: string
  pointer: ChartPointer
}) {
  const { floatingStyles, refs, update } = useFloating({
    placement: 'right-start',
    strategy: 'fixed',
    middleware: [offset({ mainAxis: 12, crossAxis: 8 }), flip({ padding: 8 }), shift({ padding: 8 })],
  })

  useLayoutEffect(() => {
    refs.setPositionReference({
      getBoundingClientRect: () => new DOMRect(pointer.x, pointer.y, 0, 0),
    })
    void update()
  }, [pointer.x, pointer.y, refs, update])

  return <FloatingPortal>
    <div ref={refs.setFloating} className={className} style={floatingStyles} aria-hidden="true">
      {children}
    </div>
  </FloatingPortal>
}
