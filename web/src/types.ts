export type Rect = { x: number; y: number; w: number; h: number }

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
}

export type Demo = {
  id: string
  title: string
  description: string
  status: 'draft' | 'published'
  created_at: string
  updated_at: string
  steps: Step[]
  share_url?: string
}

export type ExportJob = {
  id: string
  kind: 'pdf' | 'mp4' | 'markdown'
  status: 'queued' | 'running' | 'complete' | 'failed'
  progress: number
  error?: string
  download_url?: string
}

