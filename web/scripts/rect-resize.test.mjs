import test from 'node:test'
import assert from 'node:assert/strict'
import { resizeCenteredRect } from '../src/editor/rectResize.ts'

const rect = { x: .5, y: .5, w: .4, h: .2 }
const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} should be close to ${expected}`)

test('resizes one edge while preserving its opposite edge', () => {
  const west = resizeCenteredRect(rect, 'w', .1, 0)
  closeTo(west.x, .55); closeTo(west.y, .5); closeTo(west.w, .3); closeTo(west.h, .2)
  closeTo(west.x + west.w / 2, .7)

  const north = resizeCenteredRect(rect, 'n', 0, .05)
  closeTo(north.y + north.h / 2, .6)
  closeTo(north.x, .5)
  closeTo(north.w, .4)
})

test('bottom-right resize keeps top-left fixed and clamps to the viewport', () => {
  const resized = resizeCenteredRect(rect, 'se', .6, .7)
  closeTo(resized.x - resized.w / 2, .3)
  closeTo(resized.y - resized.h / 2, .4)
  closeTo(resized.x + resized.w / 2, 1)
  closeTo(resized.y + resized.h / 2, 1)
})
