export function isInlineableSnapshotAsset(contentType: string) {
  return contentType.startsWith('image/')
}

export function stripEmbeddedFonts(css: string) {
  // Fonts commonly account for more than 80% of a snapshot and the same
  // base64 payload is often repeated in several stylesheet nodes. Replay can
  // use its safe system-font fallback without carrying private font binaries.
  return css.replace(/url\(\s*(['"]?)data:(?:font\/|application\/font)[^\)]*\)/gi, 'url("")')
}
