export interface NotificationTapData {
  type?: string;
  notificationId?: string;
  nativeId?: string;
  sessionId?: string;
  approvalId?: string;
  deviceId?: string;
  userId?: string;
}

export type NotificationTapTarget =
  | {
      route: 'VibeCodingSession';
      params: { sessionId: string; approvalId?: string };
    }
  | { route: 'DeviceDetail'; params: { deviceId: string } }
  | { route: 'NotificationCenter'; params: undefined }
  // 监听器通知(listener.triggered/overflow/expired):落到监听器面板。
  | { route: 'ListenerPanel'; params: undefined };

const stringValue = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;

export function resolveNotificationTapTarget(
  data: NotificationTapData | null | undefined,
): NotificationTapTarget | null {
  if (!data) return null;
  if (data.type === 'summary') {
    return { route: 'NotificationCenter', params: undefined };
  }
  // 后台系统通知的 data.type 已被 backgroundNotifications 归并为 'listener',
  // 前台直判定用原始三态——两条形态都要命中,否则后台通知点击永远落空。
  if (
    data.type === 'listener' ||
    data.type === 'listener.triggered' ||
    data.type === 'listener.overflow' ||
    data.type === 'listener.expired'
  ) {
    return { route: 'ListenerPanel', params: undefined };
  }
  const deviceId = stringValue(data.deviceId);
  if ((data.type === 'device_offline' || data.type === 'device_online') && deviceId) {
    return { route: 'DeviceDetail', params: { deviceId } };
  }
  const sessionId = stringValue(data.sessionId);
  if (!sessionId) return null;
  const approvalId =
    data.type === 'approval' ? stringValue(data.approvalId) : undefined;
  return {
    route: 'VibeCodingSession',
    params: { sessionId, approvalId },
  };
}

/**
 * The on-notification approval action a user pressed (the 「批准」/「拒绝」 buttons
 * added to approval notifications), or null when the press is not an approval
 * action (body tap, non-approval type, unknown action id, missing id).
 *
 * Pure routing only — the caller performs the actual `respondApproval` call.
 */
export type ApprovalActionDecision =
  | { kind: 'approve'; approvalId: string }
  | { kind: 'deny'; approvalId: string }
  | null;

export function resolveApprovalAction(
  data: NotificationTapData | null | undefined,
  actionId: string | undefined,
): ApprovalActionDecision {
  if (!data || !actionId) return null;
  if (data.type !== 'approval') return null;
  const approvalId = stringValue(data.approvalId);
  if (!approvalId) return null;
  if (actionId === 'approve') return { kind: 'approve', approvalId };
  if (actionId === 'deny') return { kind: 'deny', approvalId };
  return null;
}
