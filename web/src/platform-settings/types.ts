export type EmailPlatformSettings = {
  enabled: boolean; host: string; port: number; username: string; password_configured: boolean
  from_email: string; from_name: string; security: 'starttls' | 'ssl' | 'none'; timeout_seconds: number
  configured: boolean; source: 'database' | 'environment' | 'none'; updated_at?: string | null
}
export type EmailPlatformSettingsInput = Omit<EmailPlatformSettings, 'password_configured' | 'configured' | 'source' | 'updated_at'> & { password: string }
export type MonitoringPlatformSettings = { automatic_collection: boolean; interval_seconds: number; retention_days: number; raw_ranges: string[] }
export type GeneralPlatformSettings = { help_url: string; upgrade_url: string; updated_at?: string | null }
export type GeneralPlatformSettingsInput = Pick<GeneralPlatformSettings, 'help_url' | 'upgrade_url'>
export type GoogleAuthSettings = {
  enabled: boolean; client_id: string; client_secret_configured: boolean; allow_registration: boolean
  allowed_domains: string[]; configured: boolean; redirect_uri: string; updated_at?: string | null
}
export type GoogleAuthSettingsInput = Pick<GoogleAuthSettings, 'enabled' | 'client_id' | 'allow_registration' | 'allowed_domains'> & { client_secret: string }
