export type EmailPlatformSettings = {
  enabled: boolean; host: string; port: number; username: string; password_configured: boolean
  from_email: string; from_name: string; security: 'starttls' | 'ssl' | 'none'; timeout_seconds: number
  configured: boolean; source: 'database' | 'environment' | 'none'; updated_at?: string | null
}
export type EmailPlatformSettingsInput = Omit<EmailPlatformSettings, 'password_configured' | 'configured' | 'source' | 'updated_at'> & { password: string }
export type MonitoringPlatformSettings = { automatic_collection: boolean; interval_seconds: number; retention_days: number; raw_ranges: string[] }
