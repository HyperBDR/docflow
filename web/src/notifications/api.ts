import { request } from '../api'
import type { InAppNotification, NotificationPage, NotificationScope } from './types'

export const notificationsApi = {
  list: (scope: NotificationScope, filters: { category?: string; unread_only?: boolean; page?: number; page_size?: number } = {}) => {
    const params = new URLSearchParams({ scope })
    for (const [key, value] of Object.entries(filters)) if (value !== '' && value !== undefined) params.set(key, String(value))
    return request<NotificationPage>(`/api/notifications?${params}`)
  },
  read: (id: string) => request<InAppNotification>(`/api/notifications/${id}/read`, { method: 'PATCH' }),
  readAll: (scope: NotificationScope) => request<{ updated: number }>(`/api/notifications/read-all?scope=${scope}`, { method: 'POST' }),
}
