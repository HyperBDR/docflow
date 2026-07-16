declare const __DOCFLOW_API_URL__: string
declare const __DOCFLOW_WEB_URL__: string

export const configuredApiUrl = __DOCFLOW_API_URL__.replace(/\/$/, '')
export const configuredWebUrl = __DOCFLOW_WEB_URL__.replace(/\/$/, '')
export const configuredWebOrigin = new URL(configuredWebUrl).origin

export function isConfiguredWebPage(url?: string) {
  if (!url) return false
  try { return new URL(url).origin === configuredWebOrigin } catch { return false }
}

export function isRecordableUrl(url?: string) {
  // DocFlow itself can also be the product being demonstrated. Keep the
  // trusted-origin check above for account bridge messages, but do not use it
  // to exclude otherwise normal HTTP(S) pages from recording.
  return Boolean(url && /^https?:\/\//i.test(url))
}
