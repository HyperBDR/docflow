export type Credentials = { api: string; token: string; web?: string }
export type RecordingTarget = { demoId: string; organizationId: string; title: string; contentLocale: Locale; aiEnabled: boolean; aiContext: string; createdAt?: string }
export type RecordingMode = 'html' | 'screenshot'
export type Locale = 'zh-CN' | 'en'
export type RecordingPreferences = { aiEnabled?: boolean; contentLocale?: Locale; privacyEnabled?: boolean }
export type ExtensionUpdate = {
  channel: string
  current_version: string
  latest_version?: string | null
  minimum_version?: string | null
  update_available: boolean
  required: boolean
  download_url?: string | null
  sha256?: string | null
  size_bytes?: number | null
  release_notes: string
  published_at?: string | null
}
export type Recording = {
  rootTabId: number
  activeTabId: number
  trackedTabIds: number[]
  demoId: string
  sessionId: string
  api: string
  web?: string
  token: string
  screenshot: string
  active: boolean
  paused: boolean
  capturing: boolean
  phase: '' | 'capturing' | 'uploading'
  steps: number
  mode: RecordingMode
  aiEnabled: boolean
  privacyEnabled: boolean
  captureFeedbackDurationMs: number
  error?: string
  locale: Locale
  contentLocale: Locale
  autoCreated: boolean
  stepQuotaLimit?: number
  stepQuotaRemaining?: number
}
export type Rect = { x: number; y: number; w: number; h: number }

export type CapturedSnapshot = {
  version: number
  snapshot: Record<string, unknown>
  captured_at: string
  viewport: { width: number; height: number }
  privacy_masking?: boolean
}
