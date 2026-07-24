export type InspectorLayoutMode = 'expanded' | 'accordion' | 'detail'

export function resolveInspectorLayoutMode(panelHeight: number): InspectorLayoutMode {
  // Match production's three adaptive states. ResizeObserver updates the
  // measured height while the floating panel is dragged or resized.
  if (panelHeight < 520) return 'detail'
  if (panelHeight < 720) return 'accordion'
  return 'expanded'
}
