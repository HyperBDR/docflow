import test from 'node:test'
import assert from 'node:assert/strict'
import { moveAnnotation, resizeAnnotation } from '../src/editor/annotationRects.ts'

const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} should be close to ${expected}`)
const rect = { x: .2, y: .3, w: .4, h: .25, kind: 'mosaic' }

test('moves an annotation without changing its size and clamps it to the canvas', () => {
  const moved = moveAnnotation(rect, .7, -.5)
  closeTo(moved.x, .6); closeTo(moved.y, 0)
  closeTo(moved.w, .4); closeTo(moved.h, .25)
})

test('resizes one annotation edge while preserving opposite edges', () => {
  const west = resizeAnnotation(rect, 'w', .1, 0)
  closeTo(west.x, .3); closeTo(west.w, .3); closeTo(west.x + west.w, .6)
  const northEast = resizeAnnotation(rect, 'ne', .2, .1)
  closeTo(northEast.x, .2); closeTo(northEast.y, .4)
  closeTo(northEast.x + northEast.w, .8); closeTo(northEast.y + northEast.h, .55)
})
