import { request } from '../api'
import type { WorkspaceJobPage, WorkspaceJobStatus, WorkspaceOverview } from './types'

export const workspaceApi = {
  overview: () => request<WorkspaceOverview>('/api/workspace/overview'),
  jobs: (filters: { status?: WorkspaceJobStatus | ''; job_type?: 'ai' | 'export' | ''; page?: number; page_size?: number } = {}) => {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(filters)) if (value !== '' && value !== undefined) params.set(key, String(value))
    return request<WorkspaceJobPage>(`/api/workspace/jobs${params.size ? `?${params}` : ''}`)
  },
}
