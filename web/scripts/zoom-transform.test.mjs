import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateZoomTransform, transformRect } from '../src/editor/zoomTransform.ts'

const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} should be close to ${expected}`)

test('clamps zoom translation so the transformed page always covers the viewport', () => {
  for (const rect of [
    { x: .16, y: .18, w: .32, h: .3 },
    { x: .84, y: .82, w: .32, h: .3 },
    { x: .5, y: .5, w: .5, h: .5 },
  ]) {
    for (const progress of [.1, .35, .7, 1]) {
      const transform = calculateZoomTransform(rect, progress)
      assert.ok(transform.x <= 0)
      assert.ok(transform.y <= 0)
      assert.ok(transform.x + transform.scale >= 1)
      assert.ok(transform.y + transform.scale >= 1)
    }
  }
})

test('uses the same zoom mapping for hotspot centers and sizes', () => {
  const transform = calculateZoomTransform({ x: .2, y: .25, w: .4, h: .35 }, .65)
  const hotspot = transformRect({ x: .22, y: .28, w: .08, h: .06 }, transform)
  closeTo(hotspot.x, .22 * transform.scale + transform.x)
  closeTo(hotspot.y, .28 * transform.scale + transform.y)
  closeTo(hotspot.w, .08 * transform.scale)
  closeTo(hotspot.h, .06 * transform.scale)
})
