export type ChartCoordinate = { x: number; y: number }

export function smoothPath(points: ChartCoordinate[]) {
  if (!points.length) return ''
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`
  return points.slice(1).reduce((path, point, index) => {
    const previous = points[index]
    const middleX = (previous.x + point.x) / 2
    return `${path} C ${middleX} ${previous.y}, ${middleX} ${point.y}, ${point.x} ${point.y}`
  }, `M ${points[0].x} ${points[0].y}`)
}

export function chartTickIndices(length: number, maximum = 7) {
  const count = Math.min(maximum, length)
  if (count <= 1) return length ? [0] : []
  return Array.from(new Set(Array.from({ length: count }, (_, index) => Math.round(index * (length - 1) / (count - 1)))))
}

export function sampledPointIndices(length: number, maximum = 36) {
  if (!length) return []
  const step = Math.max(1, Math.ceil(length / maximum))
  return Array.from({ length }, (_, index) => index).filter(index => index % step === 0 || index === length - 1)
}
