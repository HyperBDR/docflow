import i18n from './i18n'
import type { AdminDownload, AdminJobDetail, AdminJobPage, AdminOrganization, AdminOverview, AdminResource, AdminResourceDetail, AdminShare, AdminUser, AIJob, AIModelConfig, AIModelInput, AIPlatformSettings, AIUsageRecord, AIUsageSummary, Analytics, AuditLog, Category, Demo, ExportJob, GoogleAuthPublicConfig, GoogleIdentity, HotspotData, Invitation, Locale, Organization, OrganizationMember, OrganizationRole, PageResult, PublicPlatformConfig, QuotaPlan, QuotaSummary, RecycleItem, ResourceGovernance, ShareLink, Step, StorageConfig, StorageConfigInput, StorageObject, Tag, User, UserRole } from './types'
import type { PlatformQuotaLimits, PlatformQuotaPreview, QuotaMetricKey, QuotaOverview, QuotaPlanStatistics, QuotaSpaceHistory } from './quota/types'
import type { WorkspaceCapabilities } from './workspace/types'
import { cachedCapabilities, invalidateCapabilities } from './workspace/capabilitiesClient'

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export type ApiErrorPayload = {
  detail?: string
  code?: string
  quota?: { metrics?: string[] }
  errors?: unknown[]
  [key: string]: unknown
}

export class ApiError extends Error {
  status: number
  code?: string
  payload?: ApiErrorPayload
  constructor(status: number, message: string, code?: string, payload?: ApiErrorPayload) {
    super(message)
    this.status = status
    this.code = code
    this.payload = payload
  }
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  let response: Response
  try {
    response = await fetch(`${API_URL}${path}`, { ...options, headers, credentials: 'include' })
  } catch {
    throw new ApiError(0, i18n.t('errors.codes.network.unavailable', { ns: 'common' }), 'network.unavailable')
  }
  if (!response.ok) {
    const error: ApiErrorPayload = await response.json().catch(() => ({ detail: response.statusText }))
    const key = error.code ? `errors.codes.${error.code}` : ''
    const message = key && i18n.exists(key, { ns: 'common' }) ? i18n.t(key, { ns: 'common' }) : i18n.t('errors.requestFailed', { ns: 'common' })
    throw new ApiError(response.status, message, error.code, error)
  }
  if (response.status === 204) return undefined as T
  try {
    return await response.json()
  } catch {
    throw new ApiError(response.status, i18n.t('errors.codes.response.invalid', { ns: 'common' }), 'response.invalid')
  }
}

export const api = {
  me: () => request<User>('/api/auth/me'),
  auth: (mode: 'login' | 'register', email: string, password: string, uiLocale?: Locale) => request<User>(`/api/auth/${mode}`, { method: 'POST', body: JSON.stringify({ email, password, ...(mode === 'register' ? { ui_locale: uiLocale } : {}) }) }),
  updateLocale: (ui_locale: Locale) => request<User>('/api/auth/me', { method: 'PATCH', body: JSON.stringify({ ui_locale }) }),
  updateProfile: (values: { name?: string; ui_locale?: Locale }) => request<User>('/api/auth/me', { method: 'PATCH', body: JSON.stringify(values) }),
  changePassword: (currentPassword: string, newPassword: string) => request<void>('/api/auth/me/password', { method: 'POST', body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }) }),
  googleAuthConfig: () => request<GoogleAuthPublicConfig>('/api/auth/google/config'),
  platformConfig: () => request<PublicPlatformConfig>('/api/platform/config'),
  googleIdentity: () => request<GoogleIdentity | null>('/api/auth/google/identity'),
  unlinkGoogle: () => request<void>('/api/auth/google/identity', { method: 'DELETE' }),
  logout: () => request('/api/auth/logout', { method: 'POST' }).finally(invalidateCapabilities),
  adminOverview: () => request<AdminOverview>('/api/admin/overview'),
  adminJobs: (filters: { query?: string; job_type?: string; status?: string; user_id?: string; organization_id?: string; from_at?: string; to_at?: string; page?: number; page_size?: number } = {}) => request<AdminJobPage>(`/api/admin/jobs?${new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== '' && value !== undefined).map(([key, value]) => [key, String(value)])).toString()}`),
  adminJob: (type: 'ai' | 'export', id: string) => request<AdminJobDetail>(`/api/admin/jobs/${type}/${id}`),
  retryAdminJob: (type: 'ai' | 'export', id: string) => request<AdminJobDetail>(`/api/admin/jobs/${type}/${id}/retry`, { method: 'POST' }),
  cancelAdminJob: (type: 'ai' | 'export', id: string) => request<AdminJobDetail>(`/api/admin/jobs/${type}/${id}/cancel`, { method: 'POST' }),
  aiSettings: () => request<AIPlatformSettings>('/api/admin/ai/settings'),
  updateAISettings: (values: Pick<AIPlatformSettings, 'enabled' | 'chunk_size'>) => request<AIPlatformSettings>('/api/admin/ai/settings', { method: 'PATCH', body: JSON.stringify(values) }),
  aiModels: () => request<AIModelConfig[]>('/api/admin/ai/models'),
  createAIModel: (values: AIModelInput) => request<AIModelConfig>('/api/admin/ai/models', { method: 'POST', body: JSON.stringify({ ...values, provider: 'openai_compatible' }) }),
  updateAIModel: (id: string, values: Partial<AIModelInput>) => request<AIModelConfig>(`/api/admin/ai/models/${id}`, { method: 'PATCH', body: JSON.stringify(values) }),
  deleteAIModel: (id: string) => request<void>(`/api/admin/ai/models/${id}`, { method: 'DELETE' }),
  testAIModel: (id: string) => request<{ ok: boolean; latency_ms: number; models_latency_ms: number; completion_latency_ms: number; model_available: boolean; json_supported: boolean }>(`/api/admin/ai/models/${id}/test`, { method: 'POST' }),
  aiUsageSummary: (filters: { days?: number; model_id?: string; user_id?: string; organization_id?: string } = {}) => request<AIUsageSummary>(`/api/admin/ai/usage/summary?${new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== '' && value !== undefined).map(([key, value]) => [key, String(value)])).toString()}`),
  aiUsageRequests: (filters: { query?: string; model_id?: string; user_id?: string; organization_id?: string; status?: string; page?: number; page_size?: number } = {}) => request<PageResult<AIUsageRecord>>(`/api/admin/ai/usage/requests?${new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== '' && value !== undefined).map(([key, value]) => [key, String(value)])).toString()}`),
  storageConfigs: () => request<StorageConfig[]>('/api/admin/storage/configs'),
  createStorageConfig: (values: StorageConfigInput) => request<StorageConfig>('/api/admin/storage/configs', { method: 'POST', body: JSON.stringify(values) }),
  updateStorageConfig: (id: string, values: Partial<StorageConfigInput>) => request<StorageConfig>(`/api/admin/storage/configs/${id}`, { method: 'PATCH', body: JSON.stringify(values) }),
  deleteStorageConfig: (id: string) => request<void>(`/api/admin/storage/configs/${id}`, { method: 'DELETE' }),
  testStorageConfig: (id: string) => request<{ ok: boolean; latency_ms: number }>(`/api/admin/storage/configs/${id}/test`, { method: 'POST' }),
  storageStats: (id: string) => request<{ object_count: number; total_bytes: number }>(`/api/admin/storage/configs/${id}/stats`),
  storageObjects: (id: string, prefix = '') => request<StorageObject[]>(`/api/admin/storage/configs/${id}/objects?${new URLSearchParams({ prefix }).toString()}`),
  deleteStorageObject: (id: string, key: string) => request<void>(`/api/admin/storage/configs/${id}/objects?${new URLSearchParams({ key }).toString()}`, { method: 'DELETE' }),
  adminUsers: (filters: { query?: string; role?: UserRole | ''; active?: '' | 'true' | 'false'; page?: number; page_size?: number } = {}) => {
    const params = new URLSearchParams()
    if (filters.query) params.set('query', filters.query)
    if (filters.role) params.set('role', filters.role)
    if (filters.active) params.set('active', filters.active)
    if (filters.page) params.set('page', String(filters.page))
    if (filters.page_size) params.set('page_size', String(filters.page_size))
    const suffix = params.toString()
    return request<PageResult<AdminUser>>(`/api/admin/users${suffix ? `?${suffix}` : ''}`)
  },
  adminUser: (id: string) => request<AdminUser>(`/api/admin/users/${id}`),
  updateAdminUser: (id: string, values: { name?: string; email?: string; role?: UserRole; is_active?: boolean; ui_locale?: Locale }) => request<AdminUser>(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(values) }),
  resetAdminPassword: (id: string, newPassword: string) => request<void>(`/api/admin/users/${id}/password`, { method: 'POST', body: JSON.stringify({ new_password: newPassword }) }),
  deleteAdminUser: (id: string) => request<void>(`/api/admin/users/${id}`, { method: 'DELETE' }),
  addAdminUserMembership: (userId: string, organizationId: string, role: OrganizationRole) => request<AdminUser>(`/api/admin/users/${userId}/memberships`, { method: 'POST', body: JSON.stringify({ organization_id: organizationId, role }) }),
  updateAdminUserMembership: (userId: string, membershipId: string, role: OrganizationRole) => request<AdminUser>(`/api/admin/users/${userId}/memberships/${membershipId}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  deleteAdminUserMembership: (userId: string, membershipId: string) => request<AdminUser>(`/api/admin/users/${userId}/memberships/${membershipId}`, { method: 'DELETE' }),
  adminResources: (filters: { query?: string; owner_id?: string; organization_id?: string; status?: '' | 'draft' | 'published'; content_locale?: '' | Locale; page?: number; page_size?: number } = {}) => {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(filters)) if (value !== '' && value !== undefined) params.set(key, String(value))
    const suffix = params.toString()
    return request<PageResult<AdminResource>>(`/api/admin/resources${suffix ? `?${suffix}` : ''}`)
  },
  adminResource: (id: string) => request<AdminResourceDetail>(`/api/admin/resources/${id}`),
  adminShares: (filters: Record<string, string | number> = {}) => request<PageResult<AdminShare>>(`/api/admin/resource-governance/shares?${new URLSearchParams(Object.entries(filters).filter(([,value]) => value !== '').map(([key,value]) => [key, String(value)])).toString()}`),
  governAdminShare: (id: string, revoked: boolean) => request<{ id: string; status: string }>(`/api/admin/resource-governance/shares/${id}`, { method: 'PATCH', body: JSON.stringify({ revoked }) }),
  adminDownloads: (filters: Record<string, string | number> = {}) => request<PageResult<AdminDownload>>(`/api/admin/resource-governance/downloads?${new URLSearchParams(Object.entries(filters).filter(([,value]) => value !== '').map(([key,value]) => [key, String(value)])).toString()}`),
  resourceGovernance: (id: string, days = 30) => request<ResourceGovernance>(`/api/admin/resource-governance/resources/${id}?days=${days}`),
  deleteAdminResource: (id: string) => request<void>(`/api/admin/resources/${id}`, { method: 'DELETE' }),
  organizations: () => request<Organization[]>('/api/organizations'),
  createOrganization: (name: string, ownerId?: string) => request<Organization>('/api/organizations', { method: 'POST', body: JSON.stringify({ name, owner_id: ownerId || null }) }),
  updateOrganization: (id: string, name: string) => request<Organization>(`/api/organizations/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  archiveOrganization: (id: string) => request<void>(`/api/organizations/${id}/archive`, { method: 'POST' }),
  switchOrganization: (id: string) => request<User>(`/api/organizations/${id}/switch`, { method: 'POST' }).then(value => { invalidateCapabilities(); return value }),
  organizationMembers: (id: string) => request<OrganizationMember[]>(`/api/organizations/${id}/members`),
  updateOrganizationMember: (organizationId: string, memberId: string, role: OrganizationRole) => request<OrganizationMember>(`/api/organizations/${organizationId}/members/${memberId}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  removeOrganizationMember: (organizationId: string, memberId: string) => request<void>(`/api/organizations/${organizationId}/members/${memberId}`, { method: 'DELETE' }),
  invitations: (id: string) => request<Invitation[]>(`/api/organizations/${id}/invitations`),
  createInvitation: (id: string, email: string, role: OrganizationRole) => request<Invitation>(`/api/organizations/${id}/invitations`, { method: 'POST', body: JSON.stringify({ email, role }) }),
  invitation: (token: string) => request<Invitation>(`/api/invitations/${token}`),
  acceptInvitation: (token: string) => request<User>(`/api/invitations/${token}/accept`, { method: 'POST' }),
  registerInvitation: (token: string, name: string, password: string, ui_locale: Locale) => request<User>(`/api/invitations/${token}/register`, { method: 'POST', body: JSON.stringify({ name, password, ui_locale }) }),
  adminOrganizations: (includePersonal = false) => request<AdminOrganization[]>(`/api/admin/organizations${includePersonal ? '?include_personal=true' : ''}`),
  quotaPlans:()=>request<QuotaPlan[]>('/api/admin/quota-plans'),
  createQuotaPlan:(values:Partial<QuotaPlan>)=>request<QuotaPlan>('/api/admin/quota-plans',{method:'POST',body:JSON.stringify(values)}),
  updateQuotaPlan:(id:string,values:Partial<QuotaPlan>)=>request<QuotaPlan>(`/api/admin/quota-plans/${id}`,{method:'PATCH',body:JSON.stringify(values)}),
  deleteQuotaPlan:(id:string)=>request<void>(`/api/admin/quota-plans/${id}`,{method:'DELETE'}),
  organizationQuota:(id:string)=>request<QuotaSummary>(`/api/admin/organizations/${id}/quota`),
  updateOrganizationQuota:(id:string,plan_id:string,overrides:Record<string,number|null>)=>request<QuotaSummary>(`/api/admin/organizations/${id}/quota`,{method:'PUT',body:JSON.stringify({plan_id,overrides})}),
  quotaOperations:(filters:{days?:number;metric?:QuotaMetricKey;kind?:string;plan_id?:string;health?:string}={})=>request<QuotaOverview>(`/api/admin/quotas/overview?${new URLSearchParams(Object.entries(filters).filter(([,value])=>value!==''&&value!==undefined).map(([key,value])=>[key,String(value)])).toString()}`),
  quotaPlanStatistics:()=>request<QuotaPlanStatistics[]>('/api/admin/quotas/plans'),
  collectQuotaUsage:()=>request<{spaces:number;snapshots:number;collected_at:string}>('/api/admin/quotas/collect',{method:'POST'}),
  platformQuotaLimits:()=>request<PlatformQuotaLimits>('/api/admin/quotas/platform-limits'),
  previewPlatformQuotaLimits:(maximums:Record<string,number>,allow_unlimited:Record<string,boolean>)=>request<PlatformQuotaPreview>('/api/admin/quotas/platform-limits/preview',{method:'POST',body:JSON.stringify({maximums,allow_unlimited})}),
  updatePlatformQuotaLimits:(maximums:Record<string,number>,allow_unlimited:Record<string,boolean>,confirm_impact=false)=>request<PlatformQuotaLimits>('/api/admin/quotas/platform-limits',{method:'PUT',body:JSON.stringify({maximums,allow_unlimited,confirm_impact})}),
  quotaSpaceHistory:(id:string,days=90)=>request<QuotaSpaceHistory>(`/api/admin/quotas/spaces/${id}/history?days=${days}`),
  auditLogs: (filters: { query?: string; action?: string; target_type?: string; organization_id?: string; source?: string; outcome?: string; page?: number; page_size?: number } = {}) => request<PageResult<AuditLog>>(`/api/admin/audit-logs?${new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]))).toString()}`),
  recycleBin: () => request<RecycleItem[]>('/api/admin/recycle-bin'),
  restoreRecycleItem: (item: RecycleItem) => request(item.item_type === 'user' ? `/api/admin/recycle-bin/users/${item.id}/restore` : item.item_type === 'team_space' ? `/api/admin/recycle-bin/team-spaces/${item.id}/restore` : `/api/admin/recycle-bin/resources/${item.id}/restore`, { method: 'POST' }),
  purgeResource: (id: string) => request<void>(`/api/admin/recycle-bin/resources/${id}`, { method: 'DELETE' }),
  purgeUser: (id: string) => request<void>(`/api/admin/recycle-bin/users/${id}`, { method: 'DELETE' }),
  purgeTeamSpace: (id: string) => request<void>(`/api/admin/recycle-bin/team-spaces/${id}`, { method: 'DELETE' }),
  demos: () => request<Demo[]>('/api/demos'),
  demo: (id: string) => request<Demo>(`/api/demos/${id}`),
  quotaCapabilities: (demoId?: string, organizationId?: string, options: { force?: boolean } = {}) => {
    const params = new URLSearchParams({ ...(demoId ? { demo_id: demoId } : {}), ...(organizationId ? { organization_id: organizationId } : {}) })
    const key = `${organizationId || 'current'}:${demoId || 'workspace'}`
    return cachedCapabilities(key, () => request<WorkspaceCapabilities>(`/api/workspace/capabilities?${params}`), options)
  },
  createDemo: (title: string, categoryId?: string, contentLocale?: Locale) => request<Demo>('/api/demos', { method: 'POST', body: JSON.stringify({ title, category_id: categoryId || null, content_locale: contentLocale || 'zh-CN' }) }),
  updateDemo: (id: string, values: Partial<Demo> & { tag_ids?: string[] }) => request<Demo>(`/api/demos/${id}`, { method: 'PATCH', body: JSON.stringify(values) }),
  deleteDemo: (id: string) => request<void>(`/api/demos/${id}`, { method: 'DELETE' }),
  duplicateDemo: (id: string) => request<Demo>(`/api/demos/${id}/duplicate`, { method: 'POST' }),
  transferDemo: (id: string, action: 'copy' | 'move', targetOrganizationId: string) => request<Demo>(`/api/demos/${id}/transfer`, { method: 'POST', body: JSON.stringify({ action, target_organization_id: targetOrganizationId }) }),
  mergeDemos: (demoIds: string[], title: string, categoryId?: string) => request<Demo>('/api/demos/merge', { method: 'POST', body: JSON.stringify({ demo_ids: demoIds, title, category_id: categoryId || null }) }),
  categories: () => request<Category[]>('/api/categories'),
  createCategory: (name: string, parentId?: string, color = '#635bff') => request<Category>('/api/categories', { method: 'POST', body: JSON.stringify({ name, parent_id: parentId || null, color }) }),
  updateCategory: (id: string, values: Partial<Category>) => request<Category>(`/api/categories/${id}`, { method: 'PATCH', body: JSON.stringify(values) }),
  deleteCategory: (id: string) => request<void>(`/api/categories/${id}`, { method: 'DELETE' }),
  tags: () => request<Tag[]>('/api/tags'),
  createTag: (name: string, color = '#635bff') => request<Tag>('/api/tags', { method: 'POST', body: JSON.stringify({ name, color }) }),
  updateTag: (id: string, values: Partial<Tag>) => request<Tag>(`/api/tags/${id}`, { method: 'PATCH', body: JSON.stringify(values) }),
  deleteTag: (id: string) => request<void>(`/api/tags/${id}`, { method: 'DELETE' }),
  analytics: (demoId: string, from?: string, to?: string, tagIds: string[] = [], shareId = '') => request<Analytics>(`/api/demos/${demoId}/analytics?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}), ...(shareId ? { share_id: shareId } : {}), ...Object.fromEntries(tagIds.map((id, index) => [`tag${index}`, id])) }).toString().replace(/tag\d+=/g, 'tag=')}`),
  moderateComment: (demoId: string, commentId: string, status: 'published' | 'hidden') => request(`/api/demos/${demoId}/comments/${commentId}?status=${status}`, { method: 'PATCH' }),
  updateStep: (demoId: string, stepId: string, values: Partial<Step>) => request<Step>(`/api/demos/${demoId}/steps/${stepId}`, { method: 'PATCH', body: JSON.stringify(values) }),
  createHotspot: (demoId: string, stepId: string, values: Omit<HotspotData, 'id' | 'position'>) => request<HotspotData>(`/api/demos/${demoId}/steps/${stepId}/hotspots`, { method: 'POST', body: JSON.stringify(values) }),
  updateHotspot: (demoId: string, stepId: string, hotspotId: string, values: Partial<HotspotData>) => request<HotspotData>(`/api/demos/${demoId}/steps/${stepId}/hotspots/${hotspotId}`, { method: 'PATCH', body: JSON.stringify(values) }),
  deleteHotspot: (demoId: string, stepId: string, hotspotId: string) => request<void>(`/api/demos/${demoId}/steps/${stepId}/hotspots/${hotspotId}`, { method: 'DELETE' }),
  deleteStep: (demoId: string, stepId: string) => request<void>(`/api/demos/${demoId}/steps/${stepId}`, { method: 'DELETE' }),
  reorder: (demoId: string, stepIds: string[]) => request<Demo>(`/api/demos/${demoId}/steps/reorder`, { method: 'POST', body: JSON.stringify({ step_ids: stepIds }) }),
  publish: (id: string) => request<Demo>(`/api/demos/${id}/publish`, { method: 'POST' }),
  revoke: (id: string) => request<Demo>(`/api/demos/${id}/revoke`, { method: 'POST' }),
  shareLinks: (id: string) => request<ShareLink[]>(`/api/demos/${id}/shares`),
  createShareLink: (id: string, values: { name: string; expires_at?: string | null; password?: string }) => request<ShareLink>(`/api/demos/${id}/shares`, { method: 'POST', body: JSON.stringify(values) }),
  updateShareLink: (demoId: string, shareId: string, values: { name?: string; expires_at?: string | null; password?: string; revoked?: boolean }) => request<ShareLink>(`/api/demos/${demoId}/shares/${shareId}`, { method: 'PATCH', body: JSON.stringify(values) }),
  pair: () => request<{ code: string; expires_in: number }>('/api/extension/pair', { method: 'POST' }),
  uploadStep: (demoId: string, form: FormData) => request<Step>(`/api/recordings/${demoId}/steps`, { method: 'POST', body: form }),
  createExport: (demoId: string, kind: ExportJob['kind']) => request<ExportJob>(`/api/exports/${demoId}`, { method: 'POST', body: JSON.stringify({ kind }) }),
  exports: (demoId: string) => request<ExportJob[]>(`/api/exports?demo_id=${encodeURIComponent(demoId)}`),
  export: (id: string) => request<ExportJob>(`/api/exports/${id}`),
  generateAI: (demoId: string, stepId?: string) => request<AIJob>(stepId ? `/api/demos/${demoId}/steps/${stepId}/ai/generate` : `/api/demos/${demoId}/ai/generate`, { method: 'POST' }),
  aiJob: (id: string) => request<AIJob>(`/api/ai/jobs/${id}`),
  latestAI: (demoId: string) => request<AIJob | null>(`/api/demos/${demoId}/ai/latest`),
  revertAI: (id: string) => request<AIJob>(`/api/ai/jobs/${id}/revert`, { method: 'POST' }),
}
