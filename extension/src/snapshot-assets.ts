const INLINEABLE_FONT_TYPES = new Set([
  'font/woff', 'font/woff2', 'font/ttf', 'font/otf',
  'application/font-woff', 'application/font-woff2',
  'application/x-font-woff', 'application/x-font-woff2',
  'application/x-font-ttf', 'application/x-font-truetype',
  'application/x-font-otf', 'application/vnd.ms-fontobject',
])

const ASSET_MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
}

function normalizedContentType(contentType: string) {
  return contentType.toLowerCase().split(';')[0].trim()
}

export function isInlineableSnapshotAsset(contentType: string) {
  const type = normalizedContentType(contentType)
  return type.startsWith('image/') || INLINEABLE_FONT_TYPES.has(type)
}

/**
 * CDNs frequently serve icon fonts as application/octet-stream (or omit the
 * Content-Type entirely). Use a known file extension as a constrained
 * fallback; arbitrary binary responses are never embedded.
 */
export function snapshotAssetMime(contentType: string, sourceUrl = ''): string | null {
  const type = normalizedContentType(contentType)
  if (isInlineableSnapshotAsset(type)) return type
  try {
    const extension = new URL(sourceUrl).pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || ''
    return ASSET_MIME_BY_EXTENSION[extension] || null
  } catch {
    const extension = sourceUrl.split(/[?#]/, 1)[0].match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || ''
    return ASSET_MIME_BY_EXTENSION[extension] || null
  }
}

function startsWithBytes(data: Uint8Array, signature: number[]) {
  return data.length >= signature.length && signature.every((value, index) => data[index] === value)
}

/** Detect common sfnt/web-font containers without trusting the URL or MIME. */
export function sniffSnapshotFontMime(data: Uint8Array): string | null {
  if (startsWithBytes(data, [0x77, 0x4f, 0x46, 0x46])) return 'font/woff' // wOFF
  if (startsWithBytes(data, [0x77, 0x4f, 0x46, 0x32])) return 'font/woff2' // wOF2
  if (startsWithBytes(data, [0x4f, 0x54, 0x54, 0x4f])) return 'font/otf' // OTTO
  if (
    startsWithBytes(data, [0x00, 0x01, 0x00, 0x00])
    || startsWithBytes(data, [0x74, 0x72, 0x75, 0x65]) // true
    || startsWithBytes(data, [0x74, 0x79, 0x70, 0x31]) // typ1
    || startsWithBytes(data, [0x74, 0x74, 0x63, 0x66]) // ttcf collection
  ) return 'font/ttf'
  return null
}

export function serializedStyleText(node: Record<string, any>): string {
  if (node.type === 3 && (node.isStyle || node.textContent)) return String(node.textContent || '')
  if (node.type !== 2 || String(node.tagName).toLowerCase() !== 'style') return ''
  const attrs = node.attributes || {}
  return String(attrs._cssText || attrs._csstext || '')
}

export function replaceSerializedStyleText(node: Record<string, any>, css: string) {
  if (node.type === 3) {
    node.textContent = css
    return
  }
  node.attributes = { ...(node.attributes || {}), _cssText: css }
  delete node.attributes._csstext
}

/** rrweb removes rel/href after converting a linked sheet to _cssText. */
export function isSerializedStylesheetLink(node: Record<string, any>): boolean {
  if (node.type !== 2 || String(node.tagName).toLowerCase() !== 'link') return false
  const attrs = node.attributes || {}
  return String(attrs.rel || '').toLowerCase().includes('stylesheet')
    || typeof attrs._cssText === 'string'
    || typeof attrs._csstext === 'string'
}

export function uniqueCssAssetUrls(css: string, limit = 160): string[] {
  const values: string[] = []
  const seen = new Set<string>()
  for (const match of css.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
    const raw = match[2].trim()
    if (!raw || raw.startsWith('data:') || raw.startsWith('#') || seen.has(raw)) continue
    seen.add(raw)
    values.push(raw)
    if (values.length >= limit) break
  }
  return values
}

export function svgDataUrlWithFragment(dataUrl: string, sourceUrl: string) {
  if (!dataUrl.toLowerCase().startsWith('data:image/svg+xml')) return dataUrl
  try {
    const fragment = new URL(sourceUrl).hash
    return fragment ? `${dataUrl}${fragment}` : dataUrl
  } catch {
    return dataUrl
  }
}
