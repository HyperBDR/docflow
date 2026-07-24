import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('DOM enrichment never blocks the captured page interaction', async () => {
  const source = await readFile(new URL('../src/background.ts', import.meta.url), 'utf8')
  const start = source.indexOf('async function captureAndQueueStep')
  const end = source.indexOf('\nasync function pause', start)
  const capture = source.slice(start, end)
  assert.ok(start >= 0 && end > start)
  assert.doesNotMatch(capture, /await enrichSnapshot\(/)
  assert.match(capture, /const enrichment = state\.mode === 'html'/)
  assert.match(capture, /queue\.then\(async \(\) => recordStep\(data, await enrichment/)
})
