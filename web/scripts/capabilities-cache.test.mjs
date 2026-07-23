import assert from 'node:assert/strict'
import test from 'node:test'
import { cachedCapabilities, invalidateCapabilities } from '../src/workspace/capabilitiesClient.ts'

test('deduplicates in-flight capabilities requests and reuses fresh values', async () => {
  invalidateCapabilities()
  let calls = 0
  const loader = async () => ({ sequence: ++calls })
  const first = cachedCapabilities('space:demo', loader)
  const second = cachedCapabilities('space:demo', loader)
  assert.equal(first, second)
  assert.equal((await first).sequence, 1)
  assert.equal((await cachedCapabilities('space:demo', loader)).sequence, 1)
  assert.equal(calls, 1)
})

test('force refresh bypasses a fresh value but still joins in-flight work', async () => {
  invalidateCapabilities()
  let calls = 0
  const loader = async () => ({ sequence: ++calls })
  await cachedCapabilities('space:demo', loader)
  const forced = cachedCapabilities('space:demo', loader, { force: true })
  const joined = cachedCapabilities('space:demo', loader, { force: true })
  assert.equal(forced, joined)
  assert.equal((await forced).sequence, 2)
  assert.equal(calls, 2)
})
