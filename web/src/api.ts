import i18n from './i18n'
import type { AdminOrganization, AdminOverview, AdminResource, AdminResourceDetail, AdminUser, AIJob, Analytics, AuditLog, Category, Demo, ExportJob, HotspotData, Invitation, Locale, Organization, OrganizationMember, OrganizationRole, PageResult, RecycleItem, Step, Tag, User, UserRole } from './types'

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export class ApiError extends Error {
  status: number
  code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${API_URL}${path}`, { ...options, headers, credentials: 'include' })
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }))
    const key = error.code ? `errors.codes.${error.code}` : ''
    const message = key && i18n.exists(key, { ns: 'common' }) ? i18n.t(key, { ns: 'common' }) : i18n.t('errors.requestFailed', { ns: 'common' })
    throw new ApiError(response.status, message, error.code)
  }
  if (response.status === 204) return undefined as T
  return response.json()
}

export const api = {
  me: () => request<User>('/api/auth/me'),
  auth: (mode: 'login' | 'register', email: string, password: string, uiLocale?: Locale) => request<User>(`/api/auth/${mode}`, { method: 'POST', body: JSON.stringify({ email, password, ...(mode === 'register' ? { ui_locale: uiLocale } : {}) }) }),
  updateLocale: (ui_locale: Locale) => request<User>('/api/auth/me', { method: 'PATCH', body: JSON.stringify({ ui_locale }) }),
  updateProfile: (values: { name?: string; ui_locale?: Locale }) => request<User>('/api/auth/me', { method: 'PATCH', body: JSON.stringify(values) }),
  changePassword: (currentPassword: string, newPassword: string) => request<void>('/api/auth/me/password', { method: 'POST', body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }) }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  adminOverview: () => request<AdminOverview>('/api/admin/overview'),
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
  adminResources: (filters: { query?: string; owner_id?: string; status?: '' | 'draft' | 'published'; content_locale?: '' | Locale; page?: number; page_size?: number } = {}) => {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(filters)) if (value !== '' && value !== undefined) params.set(key, String(value))
    const suffix = params.toString()
    return request<PageResult<AdminResource>>(`/api/admin/resources${suffix ? `?${suffix}` : ''}`)
  },
  adminResource: (id: string) => request<AdminResourceDetail>(`/api/admin/resources/${id}`),
  deleteAdminResource: (id: string) => request<void>(`/api/admin/resources/${id}`, { method: 'DELETE' }),
  organizations: () => request<Organization[]>('/api/organizations'),
  createOrganization: (name: string, ownerId?: string) => request<Organization>('/api/organizations', { method: 'POST', body: JSON.stringify({ name, owner_id: ownerId || null }) }),
  updateOrganization: (id: string, name: string) => request<Organization>(`/api/organizations/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  archiveOrganization: (id: string) => request<void>(`/api/organizations/${id}/archive`, { method: 'POST' }),
  switchOrganization: (id: string) => request<User>(`/api/organizations/${id}/switch`, { method: 'POST' }),
  organizationMembers: (id: string) => request<OrganizationMember[]>(`/api/organizations/${id}/members`),
  updateOrganizationMember: (organizationId: string, memberId: string, role: OrganizationRole) => request<OrganizationMember>(`/api/organizations/${organizationId}/members/${memberId}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  removeOrganizationMember: (organizationId: string, memberId: string) => request<void>(`/api/organizations/${organizationId}/members/${memberId}`, { method: 'DELETE' }),
  invitations: (id: string) => request<Invitation[]>(`/api/organizations/${id}/invitations`),
  createInvitation: (id: string, email: string, role: OrganizationRole) => request<Invitation>(`/api/organizations/${id}/invitations`, { method: 'POST', body: JSON.stringify({ email, role }) }),
  invitation: (token: string) => request<Invitation>(`/api/invitations/${token}`),
  acceptInvitation: (token: string) => request<User>(`/api/invitations/${token}/accept`, { method: 'POST' }),
  registerInvitation: (token: string, name: string, password: string, ui_locale: Locale) => request<User>(`/api/invitations/${token}/register`, { method: 'POST', body: JSON.stringify({ name, password, ui_locale }) }),
  adminOrganizations: () => request<AdminOrganization[]>('/api/admin/organizations'),
  auditLogs: (filters: { query?: string; action?: string; target_type?: string; organization_id?: string; page?: number; page_size?: number } = {}) => request<PageResult<AuditLog>>(`/api/admin/audit-logs?${new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]))).toString()}`),
  recycleBin: () => request<RecycleItem[]>('/api/admin/recycle-bin'),
  restoreRecycleItem: (item: RecycleItem) => request(item.item_type === 'user' ? `/api/admin/recycle-bin/users/${item.id}/restore` : item.item_type === 'team_space' ? `/api/admin/recycle-bin/team-spaces/${item.id}/restore` : `/api/admin/recycle-bin/resources/${item.id}/restore`, { method: 'POST' }),
  purgeResource: (id: string) => request<void>(`/api/admin/recycle-bin/resources/${id}`, { method: 'DELETE' }),
  purgeUser: (id: string) => request<void>(`/api/admin/recycle-bin/users/${id}`, { method: 'DELETE' }),
  purgeTeamSpace: (id: string) => request<void>(`/api/admin/recycle-bin/team-spaces/${id}`, { method: 'DELETE' }),
  demos: () => request<Demo[]>('/api/demos'),
  demo: (id: string) => request<Demo>(`/api/demos/${id}`),
  createDemo: (title: string, categoryId?: string, contentLocale?: Locale) => request<Demo>('/api/demos', { method: 'POST', body: JSON.stringify({ title, category_id: categoryId || null, content_locale: contentLocale || 'zh-CN' }) }),
  updateDemo: (id: string, values: Partial<Demo> & { tag_ids?: string[] }) => request<Demo>(`/api/demos/${id}`, { method: 'PATCH', body: JSON.stringify(values) }),
  deleteDemo: (id: string) => request<void>(`/api/demos/${id}`, { method: 'DELETE' }),
  duplicateDemo: (id: string) => request<Demo>(`/api/demos/${id}/duplicate`, { method: 'POST' }),
  mergeDemos: (demoIds: string[], title: string, categoryId?: string) => request<Demo>('/api/demos/merge', { method: 'POST', body: JSON.stringify({ demo_ids: demoIds, title, category_id: categoryId || null }) }),
  categories: () => request<Category[]>('/api/categories'),
  createCategory: (name: string, parentId?: string, color = '#635bff') => request<Category>('/api/categories', { method: 'POST', body: JSON.stringify({ name, parent_id: parentId || null, color }) }),
  updateCategory: (id: string, values: Partial<Category>) => request<Category>(`/api/categories/${id}`, { method: 'PATCH', body: JSON.stringify(values) }),
  deleteCategory: (id: string) => request<void>(`/api/categories/${id}`, { method: 'DELETE' }),
  tags: () => request<Tag[]>('/api/tags'),
  createTag: (name: string, color = '#635bff') => request<Tag>('/api/tags', { method: 'POST', body: JSON.stringify({ name, color }) }),
  updateTag: (id: string, values: Partial<Tag>) => request<Tag>(`/api/tags/${id}`, { method: 'PATCH', body: JSON.stringify(values) }),
  deleteTag: (id: string) => request<void>(`/api/tags/${id}`, { method: 'DELETE' }),
  analytics: (demoId: string, from?: string, to?: string, tagIds: string[] = []) => request<Analytics>(`/api/demos/${demoId}/analytics?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}), ...Object.fromEntries(tagIds.map((id, index) => [`tag${index}`, id])) }).toString().replace(/tag\d+=/g, 'tag=')}`),
  moderateComment: (demoId: string, commentId: string, status: 'published' | 'hidden') => request(`/api/demos/${demoId}/comments/${commentId}?status=${status}`, { method: 'PATCH' }),
  updateStep: (demoId: string, stepId: string, values: Partial<Step>) => request<Step>(`/api/demos/${demoId}/steps/${stepId}`, { method: 'PATCH', body: JSON.stringify(values) }),
  createHotspot: (demoId: string, stepId: string, values: Omit<HotspotData, 'id' | 'position'>) => request<HotspotData>(`/api/demos/${demoId}/steps/${stepId}/hotspots`, { method: 'POST', body: JSON.stringify(values) }),
  updateHotspot: (demoId: string, stepId: string, hotspotId: string, values: Partial<HotspotData>) => request<HotspotData>(`/api/demos/${demoId}/steps/${stepId}/hotspots/${hotspotId}`, { method: 'PATCH', body: JSON.stringify(values) }),
  deleteHotspot: (demoId: string, stepId: string, hotspotId: string) => request<void>(`/api/demos/${demoId}/steps/${stepId}/hotspots/${hotspotId}`, { method: 'DELETE' }),
  deleteStep: (demoId: string, stepId: string) => request<void>(`/api/demos/${demoId}/steps/${stepId}`, { method: 'DELETE' }),
  reorder: (demoId: string, stepIds: string[]) => request<Demo>(`/api/demos/${demoId}/steps/reorder`, { method: 'POST', body: JSON.stringify({ step_ids: stepIds }) }),
  publish: (id: string) => request<Demo>(`/api/demos/${id}/publish`, { method: 'POST' }),
  revoke: (id: string) => request<Demo>(`/api/demos/${id}/revoke`, { method: 'POST' }),
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
