export type NotificationScope = 'user' | 'admin'
export type NotificationSeverity = 'info' | 'success' | 'warning' | 'critical'
export type InAppNotification = {
  id: string
  scope: NotificationScope
  organization_id?: string | null
  category: 'task' | 'quota' | 'alert' | 'security' | 'team' | 'system' | string
  severity: NotificationSeverity
  event_type: string
  title: string
  message: string
  action_url: string
  data: Record<string, unknown>
  read_at?: string | null
  created_at: string
  expires_at?: string | null
}
export type NotificationPage = { items: InAppNotification[]; total: number; unread: number; page: number; page_size: number }
