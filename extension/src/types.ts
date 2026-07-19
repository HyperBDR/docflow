export type Credentials = { api: string; token: string; web?: string }
export type RecordingTarget = { demoId: string; organizationId: string; title: string; contentLocale: Locale; aiEnabled: boolean; aiContext: string }
export type RecordingMode = 'html' | 'screenshot'
export type Locale = 'zh-CN' | 'en'
export type RecordingPreferences = { aiEnabled?: boolean; contentLocale?: Locale }
export type Recording = {
  rootTabId: number
  activeTabId: number
  trackedTabIds: number[]
  demoId: string
  api: string
  web?: string
  token: string
  screenshot: string
  active: boolean
  paused: boolean
  capturing: boolean
  phase: '' | 'uploading'
  steps: number
  mode: RecordingMode
  aiEnabled: boolean
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
}
