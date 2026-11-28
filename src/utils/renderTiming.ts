/**
 * 客户端上屏时序(SYNC-02):测「agent 产出 → 手机可见」的端到端延迟,上报
 * PhoneServer 聚合。验收口径:首段/后续文字的 P95 ≤ 500ms。
 *
 * 两个时刻:
 *  - 产出:agent 在 ai.delta 帧上带的 agent_emitted_at_ms(墙钟,epoch ms)。
 *  - 可见:合批 flush 把这段文字提交进状态树后的下一个 rAF 回调。rAF 回调
 *    意味着这一帧已经交给 UI 线程,是 RN 里能拿到的最接近「用户看见」的信号
 *    (真正的「已绘制」没有可靠回调;onLayout 在长列表里不稳定)。
 *
 * 时钟口径:两端都是墙钟,可直接相减。跨设备时钟有偏差,但这是唯一的端到端
 * 口径,与 SYNC-01 服务端已用的 agent_emitted_at_ms 同源;偏差是系统性偏移,
 * 不影响同一设备内的 P95 趋势。
 *
 * 采样策略(沿用 devFrameProbe 的既证设计):每个 run 只测首段一次,且只测
 * 当前正在看的会话——后台会话的上屏时刻没有意义。
 *
 * 上报是 best-effort:发不出去、服务端拒收都不影响任何用户可见行为。
 */

const MAX_AGE_MS = 30_000;
const MIN_LATENCY_MS = 0;
const MAX_LATENCY_MS = 3_600_000;
const TIMING_ID = /^[a-zA-Z0-9_-]{1,160}$/;

type PendingSample = {
  sessionId: string;
  messageId: string;
  runId: string;
  emittedAtMs: number;
};

let pending: PendingSample | undefined;
let measuredRuns = new Set<string>();
// 环形上限:长会话里 run 数会增长,不能无界。
const MEASURED_RUN_CAP = 200;

type Sender = (message: Record<string, unknown>) => void;
let sender: Sender | undefined;

/** 注入上行通道(避免 utils 反向依赖 transport)。 */
export function configureRenderTimingSender(next: Sender | undefined): void {
  sender = next;
}

/**
 * 收到首段文字帧时登记。只在「本 run 尚未测过」时登记,后续文字由
 * noteSubsequentTextReceipt 单独采样。
 */
export function noteFirstTextProduced(frame: {
  sessionId: string;
  messageId?: string;
  runId?: unknown;
  channel?: unknown;
  emittedAtMs?: unknown;
  delta: string;
}): void {
  if (!frame.messageId) return;
  if (typeof frame.runId !== 'string' || !TIMING_ID.test(frame.runId)) return;
  if (measuredRuns.has(frame.runId)) return;
  if (typeof frame.emittedAtMs !== 'number' || !Number.isSafeInteger(frame.emittedAtMs) || frame.emittedAtMs <= 0) return;
  if (frame.channel !== undefined && frame.channel !== 'assistant' && frame.channel !== 'stdout') return;
  if (!frame.delta.trim()) return;
  pending = {
    sessionId: frame.sessionId,
    messageId: frame.messageId,
    runId: frame.runId,
    emittedAtMs: frame.emittedAtMs,
  };
}

/**
 * 合批提交后调用:若这次提交包含了登记的那条首段消息,安排一次 rAF 测量。
 * 返回是否命中(便于调用方决定要不要触发后续采样)。
 */
export function noteTextCommitted(
  sessionId: string,
  sourceMessageIds: readonly string[],
): boolean {
  const sample = pending;
  if (!sample || sample.sessionId !== sessionId) return false;
  if (!sourceMessageIds.includes(sample.messageId)) return false;
  pending = undefined;
  measuredRuns.add(sample.runId);
  if (measuredRuns.size > MEASURED_RUN_CAP) {
    // Set 保持插入序,删最早的。
    const oldest = measuredRuns.values().next().value;
    if (oldest !== undefined) measuredRuns.delete(oldest);
  }
  scheduleMeasure(sample, 'first_text');
  return true;
}

/**
 * 后续文字:每个 run 最多采样若干次,避免长回答刷爆上报。
 */
const SUBSEQUENT_PER_RUN = 5;
const subsequentCount = new Map<string, number>();

export function noteSubsequentTextProduced(frame: {
  sessionId: string;
  messageId?: string;
  runId?: unknown;
  channel?: unknown;
  emittedAtMs?: unknown;
  delta: string;
}): void {
  if (!frame.messageId) return;
  if (typeof frame.runId !== 'string' || !TIMING_ID.test(frame.runId)) return;
  if (typeof frame.emittedAtMs !== 'number' || !Number.isSafeInteger(frame.emittedAtMs) || frame.emittedAtMs <= 0) return;
  if (frame.channel !== undefined && frame.channel !== 'assistant' && frame.channel !== 'stdout') return;
  if (!frame.delta.trim()) return;
  const count = subsequentCount.get(frame.runId) ?? 0;
  if (count >= SUBSEQUENT_PER_RUN) return;
  subsequentCount.set(frame.runId, count + 1);
  scheduleMeasure(
    {
      sessionId: frame.sessionId,
      messageId: frame.messageId,
      runId: frame.runId,
      emittedAtMs: frame.emittedAtMs,
    },
    'subsequent_text',
  );
}

function scheduleMeasure(sample: PendingSample, kind: 'first_text' | 'subsequent_text'): void {
  // 后续文字不走合批提交回调(每条都等 commit 太重),直接排一次 rAF:
  // 合批窗口 100ms,rAF 时刻近似「这批已交给 UI」。
  requestAnimationFrame(() => {
    const latency = Date.now() - sample.emittedAtMs;
    if (latency < MIN_LATENCY_MS || latency > MAX_LATENCY_MS) return;
    if (!sender) return;
    try {
      sender({
        type: 'client.timing',
        session_id: sample.sessionId,
        run_id: sample.runId,
        message_id: sample.messageId,
        kind,
        latency_ms: Math.round(latency),
      });
    } catch {
      /* best-effort:遥测发不出去不影响任何用户可见行为 */
    }
  });
}

export function __resetRenderTimingForTests(): void {
  pending = undefined;
  measuredRuns = new Set();
  subsequentCount.clear();
  sender = undefined;
}
