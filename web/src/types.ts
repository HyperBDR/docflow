export type Rect = { x: number; y: number; w: number; h: number }
export type Locale = 'zh-CN' | 'en'
export type UserRole = 'user' | 'admin'
export type User = {
  id: string
  email: string
  name: string
  role: UserRole
  is_active: boolean
  ui_locale: Locale
  current_organization_id?: string | null
  active_organization_id?: string | null
  created_at: string
}
export type OrganizationRole = 'owner' | 'admin' | 'editor' | 'viewer'
export type Organization = { id: string; name: string; slug: string; kind: 'personal' | 'team'; status: 'active' | 'archived'; role: OrganizationRole; access_source: 'membership' | 'platform_admin'; member_count: number; demo_count: number; created_at: string }
export type OrganizationMember = { id: string; user_id: string; name: string; email: string; role: OrganizationRole; is_active: boolean; created_at: string }
export type AdminMembership = { id: string; organization_id: string; organization_name: string; organization_slug: string; organization_kind: 'personal' | 'team'; role: OrganizationRole; is_current: boolean; created_at: string }
export type Invitation = { id: string; email: string; role: OrganizationRole; organization_id: string; organization_name: string; invite_url?: string; expires_at: string; accepted_at?: string; created_at: string }
export type AdminOrganization = { id: string; name: string; slug: string; kind: 'personal' | 'team'; status: 'active' | 'archived'; owner_name: string; owner_email: string; member_count: number; demo_count: number; storage_bytes: number; created_by_email: string; created_at: string; archived_at?: string }
export type AuditLog = { id: string; actor_id?: string; actor_name: string; actor_email: string; organization_id?: string; organization_name: string; action: string; target_type: string; target_id: string; target_label: string; before: Record<string, unknown>; after: Record<string, unknown>; ip_address: string; user_agent: string; source: string; outcome: string; created_at: string }
export type RecycleItem = { id: string; item_type: 'user' | 'resource' | 'team_space'; title: string; owner_email: string; deleted_at: string; deleted_by_name: string; expires_at: string }

export type UserStats = {
  demos: number
  steps: number
  published_demos: number
  views: number
  unique_viewers: number
  exports: number
  storage_bytes: number
}

export type AdminUser = User & { stats: UserStats; memberships: AdminMembership[] }
export type PageResult<T> = { items: T[]; total: number; page: number; page_size: number }
export type AIModelConfig = {
  id: string; name: string; provider: string; base_url: string; model: string; enabled: boolean; is_default: boolean
  vision_enabled: boolean; timeout_seconds: number; temperature: number; extra_options: Record<string, unknown>
  api_key_configured: boolean; created_at: string; updated_at: string
}
export type AIModelInput = Omit<AIModelConfig, 'id' | 'provider' | 'api_key_configured' | 'created_at' | 'updated_at'> & { api_key?: string }
export type AIPlatformSettings = { enabled: boolean; chunk_size: number; configured_models: number; enabled_models: number; effective: boolean; updated_at: string }
export type AIUsagePoint = { key: string; label: string; requests: number; input_tokens: number; output_tokens: number; total_tokens: number; avg_first_token_ms?: number | null; avg_latency_ms: number }
export type AIUsageSummary = { totals: AIUsagePoint; trend: AIUsagePoint[]; by_user: AIUsagePoint[]; by_organization: AIUsagePoint[]; by_model: AIUsagePoint[]; by_resource: AIUsagePoint[]; by_status: AIUsagePoint[]; by_operation: AIUsagePoint[] }
export type AIUsageRecord = {
  id: string; request_id: string; model_config_id?: string | null; model_name: string; user_id?: string | null; user_name: string; user_email: string
  organization_id?: string | null; organization_name: string; demo_id?: string | null; demo_title: string; operation: string; status: 'success' | 'failed'
  input_tokens: number; output_tokens: number; total_tokens: number; first_token_ms?: number | null; latency_ms: number
  request_detail: Record<string, unknown>; response_detail: Record<string, unknown>; error: string; created_at: string
}
export type StorageConfig = {
  id: string; name: string; kind: 'local' | 's3'; enabled: boolean; is_default: boolean
  local_path: string; endpoint_url: string; region: string; bucket: string; prefix: string
  force_path_style: boolean; direct_download: boolean; public_base_url: string
  credentials_configured: boolean; object_count: number; total_bytes: number; created_at: string; updated_at: string
}
export type StorageConfigInput = Omit<StorageConfig, 'id' | 'credentials_configured' | 'object_count' | 'total_bytes' | 'created_at' | 'updated_at'> & { access_key?: string; secret_key?: string }
export type StorageObject = { key: string; name: string; is_directory: boolean; size: number; updated_at?: string | null }
export type AdminOverview = {
  users: number
  active_users: number
  admins: number
  organizations: number
  demos: number
  draft_demos: number
  published_demos: number
  steps: number
  views: number
  unique_viewers: number
  exports: number
  ai_requests: number
  ai_tokens: number
  failed_jobs: number
  storage_bytes: number
  trend: { date: string; users: number; demos: number; views: number; ai_tokens: number }[]
  demo_status: { key: string; label: string; value: number; secondary: number }[]
  content_locales: { key: string; label: string; value: number; secondary: number }[]
  top_organizations: { key: string; label: string; value: number; secondary: number }[]
  recent_failed_jobs: { id: string; job_type: 'ai' | 'export'; kind: string; resource_id: string; resource_title: string; user_name: string; user_email: string; error: string; created_at: string }[]
  recent_exports: { id: string; kind: string; status: string; progress: number; resource_id: string; resource_title: string; user_name: string; user_email: string; created_at: string }[]
  top_resources: { id: string; title: string; owner_name: string; owner_email: string; views: number; unique_viewers: number; last_viewed_at?: string | null }[]
}

export type AdminResourceOwner = { id: string; name: string; email: string }
export type AdminResource = {
  id: string
  title: string
  description: string
  status: 'draft' | 'published'
  content_locale: Locale
  owner: AdminResourceOwner
  step_count: number
  views: number
  unique_viewers: number
  storage_bytes: number
  thumbnail_url?: string
  created_at: string
  updated_at: string
}
export type AdminResourceDetail = AdminResource & { demo: Demo }

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
  snapshot_version?: string
  page_context: Record<string, unknown>
  scroll_state: Record<string, number>
  capture_warnings: string[]
  manual_fields: string[]
  ai_metadata: { warnings?: string[]; redundant?: boolean; job_id?: string }
  animation: { zoom?: { enabled?: boolean; rect?: Rect; duration_ms?: number; transition_duration_ms?: number } }
  hotspots: HotspotData[]
}

export type Demo = {
  id: string
  organization_id: string
  title: string
  description: string
  content_locale: Locale
  status: 'draft' | 'published'
  created_at: string
  updated_at: string
  created_by: { id: string; name: string; email: string }
  steps: Step[]
  thumbnail_url?: string
  share_url?: string
  theme: Record<string, any>
  navigation: Record<string, any>
  playback: { autoplay?: boolean; step_duration_ms?: number; transition_delay_ms?: number; loop?: boolean }
  manual_fields: string[]
  ai_enabled: boolean
  category_id?: string | null
  tags: Tag[]
}

export type Category = { id: string; name: string; parent_id?: string; color: string; position: number }
export type Tag = { id: string; name: string; color: string }
export type StepComment = { id: string; step_id: string; author_name: string; author_email?: string; content: string; status?: string; created_at: string }
export type Analytics = {
  filtered_out: boolean
  range?: { from: string; to: string }
  summary: { total_views: number; unique_viewers: number; engagement: number; completion: number }
  steps: { id: string; position: number; title: string; viewers: number; conversion: number }[]
  devices: { operating_systems?: { name: string; value: number }[]; browsers?: { name: string; value: number }[]; device_types?: { name: string; value: number }[]; locations?: { name: string; value: number }[] }
  leads: { name: string; email: string; comment: string; step_id: string; created_at: string }[]
  comments: StepComment[]
}

export type ExportJob = {
  id: string
  kind: 'pdf' | 'mp4' | 'markdown'
  status: 'queued' | 'running' | 'complete' | 'failed'
  progress: number
  error?: string
  error_code?: string
  download_url?: string
  created_at: string
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
  error_code?: string
  can_revert: boolean
}
