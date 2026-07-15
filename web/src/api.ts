import type { AIJob, Demo, ExportJob, HotspotData, Step } from './types'

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${API_URL}${path}`, { ...options, headers, credentials: 'include' })
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }))
    throw new ApiError(response.status, error.detail || '请求失败')
  }
  if (response.status === 204) return undefined as T
  return response.json()
}

export const api = {
  me: () => request<{ id: string; email: string }>('/api/auth/me'),
  auth: (mode: 'login' | 'register', email: string, password: string) => request(`/api/auth/${mode}`, { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  demos: () => request<Demo[]>('/api/demos'),
  demo: (id: string) => request<Demo>(`/api/demos/${id}`),
  createDemo: (title: string) => request<Demo>('/api/demos', { method: 'POST', body: JSON.stringify({ title }) }),
  updateDemo: (id: string, values: Partial<Demo>) => request<Demo>(`/api/demos/${id}`, { method: 'PATCH', body: JSON.stringify(values) }),
  deleteDemo: (id: string) => request<void>(`/api/demos/${id}`, { method: 'DELETE' }),
  duplicateDemo: (id: string) => request<Demo>(`/api/demos/${id}/duplicate`, { method: 'POST' }),
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
