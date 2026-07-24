import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveHotspotRect } from '../src/editor/hotspotRect.ts'

const fallback = { x: .2, y: .3, w: .1, h: .08 }
const dynamic = { x: .2, y: -.15, w: .1, h: .08 }

test('DOM preview follows the live element rectangle while scrolling', () => {
  assert.equal(resolveHotspotRect('player', true, fallback, dynamic), dynamic)
})

test('image previews and hotspot editing retain the persisted fallback rectangle', () => {
  assert.equal(resolveHotspotRect('player', false, fallback, dynamic), fallback)
  assert.equal(resolveHotspotRect('editor', true, fallback, dynamic), fallback)
  assert.equal(resolveHotspotRect('player', true, fallback), fallback)
})
