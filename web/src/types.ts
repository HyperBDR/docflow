export type Rect = { x: number; y: number; w: number; h: number }

export type SelectorInfo = { css?: string; node_id?: number; tag?: string; role?: string; aria_label?: string; text?: string }
export type HotspotAction = { type: 'next' | 'goto' | 'link' | 'end'; target_step_id?: string; url?: string }
export type TooltipConfig = { content: string; placement: string; alignment: 'start' | 'center' | 'end'; offset: number; max_width: number; show_arrow: boolean }
export type HotspotStyle = { shape: 'rectangle' | 'circle'; pulse: boolean; spotlight: boolean; padding: number; color: string; overlay_opacity: number }
export type HotspotData = {
  id: string
  position: number
  selector: SelectorInfo
  fallback_rect: Rect
  trigger: 'click' | 'hover'
  action: HotspotAction
  tooltip: TooltipConfig
  style: HotspotStyle
}

export type Step = {
  id: string
  event_id: string
  position: number
  title: string
  body: string
  viewport_width: number
  viewport_height: number
  hotspot: Rect
  redactions: Rect[]
  duration: number
  image_url: string
  render_mode: 'image' | 'dom'
  snapshot_url?: string
  page_context: Record<string, unknown>
  scroll_state: Record<string, number>
  capture_warnings: string[]
  manual_fields: string[]
  ai_metadata: { warnings?: string[]; redundant?: boolean; job_id?: string }
  animation: { zoom?: { enabled?: boolean; rect?: Rect; duration_ms?: number } }
  hotspots: HotspotData[]
}

export type Demo = {
  id: string
  title: string
  description: string
  status: 'draft' | 'published'
  created_at: string
  updated_at: string
  steps: Step[]
  thumbnail_url?: string
  share_url?: string
  theme: Record<string, any>
  navigation: Record<string, any>
  playback: { autoplay?: boolean; step_duration_ms?: number; transition_delay_ms?: number; loop?: boolean }
  manual_fields: string[]
  ai_enabled: boolean
}

export type ExportJob = {
  id: string
  kind: 'pdf' | 'mp4' | 'markdown'
  status: 'queued' | 'running' | 'complete' | 'failed'
  progress: number
  error?: string
  download_url?: string
}

export type AIJob = {
  id: string
  demo_id: string
  step_id?: string
  status: 'queued' | 'running' | 'complete' | 'failed'
  progress: number
  model: string
  result: Record<string, any>
  error?: string
  can_revert: boolean
}
