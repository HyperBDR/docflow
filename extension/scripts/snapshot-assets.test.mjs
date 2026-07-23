import assert from 'node:assert/strict'
import test from 'node:test'
import { isInlineableSnapshotAsset, stripEmbeddedFonts } from '../src/snapshot-assets.ts'

test('keeps inline images but rejects font binaries', () => {
  assert.equal(isInlineableSnapshotAsset('image/png'), true)
  assert.equal(isInlineableSnapshotAsset('font/woff2'), false)
  assert.equal(isInlineableSnapshotAsset('application/font-woff'), false)
})

test('removes embedded font URLs without touching background images', () => {
  const css = '@font-face{src:url("data:font/woff2;base64,d09GMgAB")}.hero{background:url(data:image/png;base64,AA==)}'
  const result = stripEmbeddedFonts(css)
  assert.equal(result.includes('data:font'), false)
  assert.equal(result.includes('data:image/png'), true)
})
