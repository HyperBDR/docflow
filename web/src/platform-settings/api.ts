import { request } from '../api'
import type { EmailPlatformSettings, EmailPlatformSettingsInput, ExtensionCapturePlatformSettings, ExtensionCapturePlatformSettingsInput, GeneralPlatformSettings, GeneralPlatformSettingsInput, GoogleAuthSettings, GoogleAuthSettingsInput, MonitoringPlatformSettings, MonitoringPlatformSettingsInput } from './types'

export const platformSettingsApi = {
  general: () => request<GeneralPlatformSettings>('/api/admin/settings/general'),
  updateGeneral: (value: GeneralPlatformSettingsInput) => request<GeneralPlatformSettings>('/api/admin/settings/general', { method: 'PATCH', body: JSON.stringify(value) }),
  extensionCapture: () => request<ExtensionCapturePlatformSettings>('/api/admin/settings/extension-capture'),
  updateExtensionCapture: (value: ExtensionCapturePlatformSettingsInput) => request<ExtensionCapturePlatformSettings>('/api/admin/settings/extension-capture', { method: 'PATCH', body: JSON.stringify(value) }),
  email: () => request<EmailPlatformSettings>('/api/admin/settings/email'),
  updateEmail: (value: EmailPlatformSettingsInput) => request<EmailPlatformSettings>('/api/admin/settings/email', { method: 'PATCH', body: JSON.stringify(value) }),
  testEmail: (recipient: string) => request<{ status: string }>('/api/admin/settings/email/test', { method: 'POST', body: JSON.stringify({ recipient }) }),
  monitoring: () => request<MonitoringPlatformSettings>('/api/admin/settings/monitoring'),
  updateMonitoring: (value: MonitoringPlatformSettingsInput) => request<MonitoringPlatformSettings>('/api/admin/settings/monitoring', { method: 'PATCH', body: JSON.stringify(value) }),
  google: () => request<GoogleAuthSettings>('/api/admin/settings/google'),
  updateGoogle: (value: GoogleAuthSettingsInput) => request<GoogleAuthSettings>('/api/admin/settings/google', { method: 'PATCH', body: JSON.stringify(value) }),
  testGoogle: () => request<{ status: string }>('/api/admin/settings/google/test', { method: 'POST' }),
}
