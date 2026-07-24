import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CAPTURE_RESPONSE_TIMEOUT_MS, CAPTURE_SUCCESS_MIN_MS, DEFAULT_CAPTURE_FEEDBACK_DURATION_MS,
  captureFeedbackDuration, captureSuccessDelay,
} from '../src/capture-feedback.ts'

test('keeps fast captures visible and always shows a success confirmation', () => {
  assert.equal(DEFAULT_CAPTURE_FEEDBACK_DURATION_MS, 1100)
  assert.equal(CAPTURE_SUCCESS_MIN_MS, 180)
  assert.equal(CAPTURE_RESPONSE_TIMEOUT_MS, 2500)
  assert.equal(100 + captureSuccessDelay(100), 1100)
  assert.equal(100 + captureSuccessDelay(100, 1500), 1500)
  assert.equal(captureSuccessDelay(1000), 180)
  assert.equal(captureSuccessDelay(1200), 180)
})

test('normalizes remotely configured capture feedback duration', () => {
  assert.equal(captureFeedbackDuration(499), 500)
  assert.equal(captureFeedbackDuration(1450), 1450)
  assert.equal(captureFeedbackDuration(3001), 3000)
  assert.equal(captureFeedbackDuration('invalid'), 1100)
})
