import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveInspectorLayoutMode } from '../src/editor/inspectorLayout.ts'

test('inspector matches the production height-based layout', () => {
  assert.equal(resolveInspectorLayoutMode(519), 'detail')
  assert.equal(resolveInspectorLayoutMode(520), 'accordion')
  assert.equal(resolveInspectorLayoutMode(719), 'accordion')
  assert.equal(resolveInspectorLayoutMode(720), 'expanded')
})
