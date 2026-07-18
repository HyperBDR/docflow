import { request } from '../api'
import type { WorkspaceJobPage, WorkspaceJobStatus, WorkspaceOverview, WorkspaceQuota, WorkspaceQuotaHistory } from './types'

export const workspaceApi = {
  overview: () => request<WorkspaceOverview>('/api/workspace/overview'),
  quotas:()=>request<WorkspaceQuota>('/api/workspace/quotas'),
  quotaHistory:(days=30)=>request<WorkspaceQuotaHistory>(`/api/workspace/quotas/history?days=${days}`),
  jobs: (filters: { status?: WorkspaceJobStatus | ''; job_type?: 'ai' | 'export' | ''; page?: number; page_size?: number } = {}) => {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(filters)) if (value !== '' && value !== undefined) params.set(key, String(value))
    return request<WorkspaceJobPage>(`/api/workspace/jobs${params.size ? `?${params}` : ''}`)
  },
}
