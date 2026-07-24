export const DEFAULT_CAPTURE_FEEDBACK_DURATION_MS = 1100
export const MIN_CAPTURE_FEEDBACK_DURATION_MS = 500
export const MAX_CAPTURE_FEEDBACK_DURATION_MS = 3000
export const CAPTURE_SUCCESS_MIN_MS = 180
export const CAPTURE_RESPONSE_TIMEOUT_MS = 2_500

export function captureFeedbackDuration(value: unknown) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_CAPTURE_FEEDBACK_DURATION_MS
  return Math.max(MIN_CAPTURE_FEEDBACK_DURATION_MS, Math.min(MAX_CAPTURE_FEEDBACK_DURATION_MS, Math.round(parsed)))
}

export function captureSuccessDelay(elapsedMs: number, feedbackDurationMs = DEFAULT_CAPTURE_FEEDBACK_DURATION_MS) {
  return Math.max(CAPTURE_SUCCESS_MIN_MS, captureFeedbackDuration(feedbackDurationMs) - Math.max(0, elapsedMs))
}
