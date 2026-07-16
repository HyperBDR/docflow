export type Credentials = { api: string; token: string; web?: string }
export type RecordingTarget = { demoId: string; organizationId: string; title: string; contentLocale: Locale; aiEnabled: boolean }
export type RecordingMode = 'html' | 'screenshot'
export type Locale = 'zh-CN' | 'en'
export type Recording = {
  rootTabId: number
  activeTabId: number
  trackedTabIds: number[]
  demoId: string
  api: string
  token: string
  screenshot: string
  active: boolean
  paused: boolean
  capturing: boolean
  phase: '' | 'uploading'
  steps: number
  mode: RecordingMode
  aiEnabled: boolean
  locale: Locale
  contentLocale: Locale
  autoCreated: boolean
}
export type Rect = { x: number; y: number; w: number; h: number }

export type CapturedSnapshot = {
  version: number
  snapshot: Record<string, unknown>
  captured_at: string
  viewport: { width: number; height: number }
}
