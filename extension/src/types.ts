export type Credentials = { api: string; token: string; web?: string }
export type RecordingMode = 'html' | 'screenshot'
export type Recording = {
  tabId: number
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
}
export type Rect = { x: number; y: number; w: number; h: number }

export type CapturedSnapshot = {
  version: number
  snapshot: Record<string, unknown>
  captured_at: string
  viewport: { width: number; height: number }
}
