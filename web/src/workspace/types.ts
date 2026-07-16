export type WorkspaceJobStatus = 'queued' | 'running' | 'complete' | 'failed' | 'cancelled'

export type WorkspaceJob = {
  id: string
  job_type: 'ai' | 'export'
  kind: string
  status: WorkspaceJobStatus
  progress: number
  resource_id: string
  resource_title: string
  owner_name: string
  error_code?: string | null
  created_at: string
  updated_at: string
  download_url?: string | null
}

export type WorkspaceTrendPoint = {
  date: string
  resources: number
  views: number
  ai_tokens: number
  jobs: number
}

export type WorkspaceResource = {
  id: string
  title: string
  status: 'draft' | 'published'
  step_count: number
  views: number
  updated_at: string
}

export type WorkspaceOverview = {
  organization_id: string
  organization_name: string
  organization_kind: 'personal' | 'team'
  member_count: number
  resources: number
  draft_resources: number
  published_resources: number
  steps: number
  storage_bytes: number
  views: number
  unique_viewers: number
  exports: number
  ai_requests: number
  ai_tokens: number
  failed_jobs: number
  active_jobs: number
  job_summary: Record<WorkspaceJobStatus, number>
  trend: WorkspaceTrendPoint[]
  recent_resources: WorkspaceResource[]
  recent_jobs: WorkspaceJob[]
}

export type WorkspaceJobPage = {
  items: WorkspaceJob[]
  total: number
  page: number
  page_size: number
  summary: Record<WorkspaceJobStatus, number>
}
