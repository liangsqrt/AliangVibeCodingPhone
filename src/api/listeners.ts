import { apiDelete, apiGet, apiPatch } from './client';

/**
 * 监听器(listeners)REST 面。用户经 AI 工具/网页面板创建
 * file_tail/process_exit/http_poll/webhook 监听,事件触发时服务端注入
 * prompt 进会话并发通知;手机端面板只读+复活+删除。
 *
 * 信封契约(2026-11-22 P0 修正):直连云端路径返回裸 JSON,无 {code,data}
 * 信封——网页面板看到的信封是 agent 代理注入的,手机直连链路上不存在。
 * 故这里直接读 payload 字段;非 2xx 由 client.ts 抛 ApiResponseError。
 */

export type ListenerStatus =
  | 'active'
  | 'paused'
  | 'fired'
  | 'expired'
  | 'error';

export type ListenerSourceType =
  | 'file_tail'
  | 'process_exit'
  | 'http_poll'
  | 'webhook';

export type ListenerMode = 'once' | 'recurring';

export interface ListenerItem {
  id: string;
  title: string;
  status: ListenerStatus;
  source_type: ListenerSourceType;
  last_fired_at?: string | null;
  fired_count: number;
  cooldown_ms: number;
  error_note?: string | null;
  mode: ListenerMode;
  target_session_id?: string | null;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface ListenerPatchBody {
  status?: ListenerStatus;
  title?: string;
  prompt_template?: string;
  cooldown_ms?: number;
  mode?: ListenerMode;
  /** 复活 error→active 必须回传行的 updated_at(乐观锁语义)。 */
  updated_at?: string;
}

export interface ListenerEvent {
  listener_id: string;
  fired_at: string;
  summary: string;
  detail?: string;
}

export async function fetchListeners(): Promise<ListenerItem[]> {
  const payload = await apiGet<{ listeners?: ListenerItem[] }>('/api/listeners');
  return payload?.listeners ?? [];
}

export async function patchListener(
  listenerId: string,
  body: ListenerPatchBody,
): Promise<ListenerItem | null> {
  const payload = await apiPatch<{ listener?: ListenerItem }>(
    `/api/listeners/${listenerId}`,
    body,
  );
  return payload?.listener ?? null;
}

export async function deleteListener(listenerId: string): Promise<void> {
  await apiDelete<unknown>(`/api/listeners/${listenerId}`);
}

export async function fetchListenerEvents(listenerId: string): Promise<ListenerEvent[]> {
  const payload = await apiGet<{ events?: ListenerEvent[] }>(
    `/api/listeners/${listenerId}/events`,
  );
  return payload?.events ?? [];
}
