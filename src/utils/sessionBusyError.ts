import { ApiTimeoutError, ApiResponseError } from '../api/client';

/**
 * 「会话忙」类错误的统一识别 + 友好文案入口（跨仓契约 C6：服务端 409
 * ai_session_busy 与 agent tui_busy 在发送/停止路径上的用户可见提示）。
 *
 * 两个来源：
 * - 服务端 claim 失败：HTTP 409，body `{error:'ai_session_busy'}`（服务端把 code
 *   直接当 error 文本下发，见 AliangPhoneServer server/src/index.ts 的 ApiError
 *   序列化），客户端 apiFetch 包成 ApiResponseError(code=message='ai_session_busy')。
 * - agent TUI 预检/外部中断（C3）：错误经 ai.error 事件通道上报（非 HTTP），
 *   message 为 agent 的英文原文，code 未必能带上，所以 code 之外还要按 message
 *   关键字兜底。
 *
 * 命中返回 busy 类型；null 表示不属于「会话忙」家族，调用方应回退到既有文案
 * （interruptFailedPrefix 横幅 / failed 气泡），行为保持不变。
 */
export type SessionBusyKind =
  | 'session_busy'
  | 'tui_busy'
  | 'session_not_running'
  | 'session_closed'
  | 'codex_thread_busy';

const SESSION_BUSY_CODE = 'ai_session_busy';
const TUI_BUSY_CODE = 'tui_busy';
/** 空闲会话插话被拒（服务端 steer 路由 409：session.status !== 'running'）。 */
const SESSION_NOT_RUNNING_CODE = 'ai_session_not_running';
/**
 * 用户主动关闭的会话发消息被拒（服务端 send/lifecycle 路由 409：
 * session_closed）。注意 imported（ai_import_ 前缀）与 server 侧放行的
 * local-/dashboard 会话不会得到这个码——发消息即静默 resume——所以命中它
 * 就意味着「会话真被关了」，必须给出可见反馈。
 */
const SESSION_CLOSED_CODE = 'session_closed';
/**
 * codex 线程单写者冲突（2026-11-25 P0：内核 agentAIErrorPayload 的
 * error_code 通道 + 特征文本 "codex thread busy: ..."；原始 codex 错误为
 * "thread-store conflict: ... already has an active writer"）。语义与
 * tui_busy 同族——原会话在别的客户端里开着——但文案指引不同（关闭原
 * 客户端后重试，或答「复制会话继续」的询问卡）。
 */
const CODEX_THREAD_BUSY_CODE = 'codex_thread_busy';

// message 关键字兜底（统一小写比较）：服务端把 code 当文本下发；agent 的英文
// 原文（"TUI session is running an active turn in its terminal; retry after it
// finishes"）；手机本地 store guard（"… is still running. Stop it before …"；
// 审批等待期硬拦 "Approval is pending. Resolve it before …"）。
const SESSION_BUSY_MESSAGE_HINTS = [SESSION_BUSY_CODE, 'still running', 'approval is pending'];
const TUI_BUSY_MESSAGE_HINTS = [
  TUI_BUSY_CODE,
  'running an active turn',
  'active turn in its terminal',
];
const CODEX_THREAD_BUSY_MESSAGE_HINTS = [
  CODEX_THREAD_BUSY_CODE,
  'codex thread busy',
  'already has an active writer',
  'thread-store conflict',
];

const errorParts = (error: unknown): { code?: string; message: string } => {
  const code =
    error instanceof ApiResponseError
      ? error.code
      : (error as { code?: string } | null)?.code;
  const message = error instanceof Error ? error.message : String(error ?? '');
  return { code, message };
};

const matchesAny = (haystack: string, hints: string[]) =>
  hints.some(hint => haystack.includes(hint));

export const classifySessionBusyError = (
  error: unknown,
): SessionBusyKind | null => {
  const { code, message } = errorParts(error);
  if (code === TUI_BUSY_CODE) return 'tui_busy';
  if (code === SESSION_BUSY_CODE) return 'session_busy';
  if (code === SESSION_NOT_RUNNING_CODE) return 'session_not_running';
  if (code === SESSION_CLOSED_CODE) return 'session_closed';
  if (code === CODEX_THREAD_BUSY_CODE) return 'codex_thread_busy';
  const haystack = message.toLowerCase();
  // not_running 必须先于 busy 关键字兜底（两者 message 形态相近）。
  if (matchesAny(haystack, [SESSION_NOT_RUNNING_CODE])) {
    return 'session_not_running';
  }
  if (matchesAny(haystack, [SESSION_CLOSED_CODE])) return 'session_closed';
  // codex 线程锁先于 tui_busy：内核特征文本含 "thread busy"，语义更具体。
  if (matchesAny(haystack, CODEX_THREAD_BUSY_MESSAGE_HINTS)) return 'codex_thread_busy';
  if (matchesAny(haystack, TUI_BUSY_MESSAGE_HINTS)) return 'tui_busy';
  if (matchesAny(haystack, SESSION_BUSY_MESSAGE_HINTS)) return 'session_busy';
  return null;
};

/**
 * 忙类错误 → 本地化友好文案（i18n key 在 vibecoding:session.error.*）。
 * 非忙类错误返回 null，交给调用方的通用错误展示。
 */
export const sessionBusyErrorText = (
  error: unknown,
  t: (key: string) => string,
): string | null => {
  const kind = classifySessionBusyError(error);
  if (kind === 'tui_busy') return t('session.error.sessionBusyTui');
  if (kind === 'codex_thread_busy') return t('session.error.sessionBusyCodexThread');
  if (kind === 'session_busy') return t('session.error.sessionBusy');
  if (kind === 'session_not_running') {
    return t('session.error.steerNotRunning');
  }
  if (kind === 'session_closed') return t('session.error.sessionClosed');
  return null;
};

/**
 * 通用发送失败文案(draft 首条链路专用,2026-11-18 vm459 事故)。
 *
 * 草稿首条消息没有 failed 气泡载体:服务端 4xx、120s 超时、网络失败此前
 * 全部落 console.warn,用户看到的是「发送不出去且无任何提示」。这里把
 * 已知错误码翻译成友好文案,未知错误带 code/原文兜底——至少「发生了什么」
 * 用户可见。忙类错误不走这里(调用方先用 sessionBusyErrorText 分类)。
 */
const SEND_FAILURE_CODE_KEYS: Readonly<Record<string, string>> = {
  device_offline: 'session.error.sendDeviceOffline',
  ai_control_disabled: 'session.error.sendAiControlDisabled',
  device_not_found: 'session.error.sendTargetNotFound',
  project_not_found: 'session.error.sendTargetNotFound',
  // 会话被用户主动关闭：sendTargetNotFound（设备/项目不存在）文不对题，
  // 走专用「会话已关闭」文案（2026-11-22 agentcore 发送静默失败 RCA）。
  session_closed: 'session.error.sessionClosed',
  validation_error: 'session.error.sendRejected',
  unsupported_ai_provider: 'session.error.sendRejected',
  idempotency_key_reused: 'session.error.sendRejected',
};

export const sendFailureText = (
  error: unknown,
  t: (key: string, params?: Record<string, unknown>) => string,
): string => {
  if (error instanceof ApiTimeoutError) {
    return t('session.error.sendTimeout', {
      seconds: Math.max(1, Math.round(error.timeoutMs / 1000)),
    });
  }
  if (error instanceof ApiResponseError) {
    if (error.status === 401) return t('session.error.sendUnauthorized');
    if (error.status === 403) {
      // ai_control_disabled 走 403,但语义不是登录过期,必须先于登录过期判定。
      if (error.code === 'ai_control_disabled') {
        return t('session.error.sendAiControlDisabled');
      }
      return t('session.error.sendUnauthorized');
    }
    const mapped = error.code ? SEND_FAILURE_CODE_KEYS[error.code] : undefined;
    if (mapped) return t(mapped);
    return t('session.error.sendFailed', { detail: error.code || error.message });
  }
  if (error instanceof Error && /network|fetch/i.test(error.message ?? '')) {
    return t('session.error.sendNetwork');
  }
  return t('session.error.sendFailed', { detail: String(error ?? 'unknown') });
};
