import { apiGet, apiPost } from './client';
import { cursorPageQuery, type ServerCursorPageResponse } from './pagination';

export interface ServerNotification {
  id: string;
  notification_id: string;
  user_id: string;
  // listener.*:监听器事件通知(面板 toast/角标 + 通知中心行)。三项共用
  // 「监听器」标签与 ListenerPanel 落点;见 utils/notificationDeliveryPolicy。
  type:
    | 'approval'
    | 'completed'
    | 'error'
    | 'device_offline'
    | 'device_online'
    | 'listener.triggered'
    | 'listener.overflow'
    | 'listener.expired';
  title: string;
  body: string;
  device_id?: string;
  session_id?: string;
  approval_id?: string;
  read: boolean;
  created_at: string;
  read_at?: string;
}

export const fetchNotifications = (): Promise<ServerNotification[]> =>
  apiGet<ServerNotification[]>('/api/notifications');

export const fetchNotificationsPage = (options?: {
  limit?: number;
  before?: string;
}): Promise<ServerCursorPageResponse<ServerNotification>> =>
  apiGet<ServerCursorPageResponse<ServerNotification>>(
    `/api/notifications?${cursorPageQuery(options)}`,
  );

export const markNotificationRead = (notificationId: string): Promise<ServerNotification> =>
  apiPost<ServerNotification>(`/api/notifications/${notificationId}/read`);

export const markAllNotificationsRead = (): Promise<{ status: string; count: number }> =>
  apiPost<{ status: string; count: number }>('/api/notifications/read-all');
