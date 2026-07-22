import assert from 'node:assert/strict'
import test from 'node:test'
import { settleSnapshotAnimations } from '../src/snapshotAnimations.ts'

function animation(endTime, { finishThrows = false } = {}) {
  return {
    effect: { getComputedTiming: () => ({ endTime }) },
    finished: false,
    cancelled: false,
    finish() {
      if (finishThrows) throw new Error('cannot finish')
      this.finished = true
    },
    cancel() { this.cancelled = true },
  }
}

test('finishes entrance animations and cancels continuous animations', () => {
  const entrance = animation(550)
  const spinner = animation(Infinity)
  const result = settleSnapshotAnimations({ getAnimations: () => [entrance, spinner] })

  assert.deepEqual(result, { finished: 1, cancelled: 1 })
  assert.equal(entrance.finished, true)
  assert.equal(entrance.cancelled, false)
  assert.equal(spinner.finished, false)
  assert.equal(spinner.cancelled, true)
})

test('cancels animations that a browser cannot finish safely', () => {
  const unsupported = animation(300, { finishThrows: true })
  const missingEffect = animation(0)
  missingEffect.effect = null
  const result = settleSnapshotAnimations({ getAnimations: () => [unsupported, missingEffect] })

  assert.deepEqual(result, { finished: 0, cancelled: 2 })
  assert.equal(unsupported.cancelled, true)
  assert.equal(missingEffect.cancelled, true)
})
