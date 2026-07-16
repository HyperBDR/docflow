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
export type AuditLog = { id: string; actor_id?: string; actor_name: string; actor_email: string; organization_id?: string; organization_name: string; action: string; target_type: string; target_id: string; target_label: string; before: Record<string, unknown>; after: Record<string, unknown>; ip_address: string; created_at: string }
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
export type AdminOverview = {
  users: number
  active_users: number
  admins: number
  demos: number
  views: number
  storage_bytes: number
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
