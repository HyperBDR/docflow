import { request } from '../api'
import type { EmailPlatformSettings, EmailPlatformSettingsInput, GoogleAuthSettings, GoogleAuthSettingsInput, MonitoringPlatformSettings } from './types'

export const platformSettingsApi = {
  email: () => request<EmailPlatformSettings>('/api/admin/settings/email'),
  updateEmail: (value: EmailPlatformSettingsInput) => request<EmailPlatformSettings>('/api/admin/settings/email', { method: 'PATCH', body: JSON.stringify(value) }),
  testEmail: (recipient: string) => request<{ status: string }>('/api/admin/settings/email/test', { method: 'POST', body: JSON.stringify({ recipient }) }),
  monitoring: () => request<MonitoringPlatformSettings>('/api/admin/settings/monitoring'),
  google: () => request<GoogleAuthSettings>('/api/admin/settings/google'),
  updateGoogle: (value: GoogleAuthSettingsInput) => request<GoogleAuthSettings>('/api/admin/settings/google', { method: 'PATCH', body: JSON.stringify(value) }),
  testGoogle: () => request<{ status: string }>('/api/admin/settings/google/test', { method: 'POST' }),
}
