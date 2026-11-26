/**
 * devFrameProbe (2026-11-13) — JS 线程卡顿取证探针。
 *
 * 背景:会话卡顿风暴期间用户看到「卡在屏幕上方的气泡」——toast 的 1.5s 自动
 * 隐藏是 JS 线程上的 setTimeout,线程被占满时定时器无法触发,气泡就冻住。
 * 本探针用 rAF 相邻回调的间隔近似 JS 线程占用:间隔 ≥ GAP_THRESHOLD_MS 记一条
 * `js-gap`,并带上「最近一次业务标记」(perfMark)做因果对照——卡顿发生前 App
 * 正在干什么(追平排水/快照加载/WS 重连/toast 弹出)。
 *
 * 仅 __DEV__ 生效;release 下所有入口都是 no-op,零开销零日志。
 * 用法:App 挂载时 startDevFrameProbe();业务路径 perfMark('catchup:600')。
 */

export const GAP_THRESHOLD_MS = 150;

let started = false;
let lastTickAt = 0;
let lastMark = 'app-start';
let lastMarkAt = 0;

/** 记录一个业务标记;下一个超阈 js-gap 会带上它(+距今毫秒)。 */
export function perfMark(label: string): void {
  if (!__DEV__) return;
  lastMark = label;
  lastMarkAt = Date.now();
}

const FIRST_TEXT_MAX_AGE_MS = 30_000;
const TIMING_ID = /^[a-zA-Z0-9_-]{1,160}$/;

type FirstTextFrame = {
  sessionId: string;
  messageId?: string;
  delta: string;
  channel?: unknown;
  runId?: unknown;
  eventSeq?: unknown;
  emittedAtMs?: unknown;
};

let firstTextReceipt: {
  sessionId: string;
  messageId: string;
  runId: string;
  eventSeq: number;
  receivedAt: number;
} | undefined;
let lastMeasuredRun: string | undefined;

/** Only the device's tagged first text frame is sampled. */
export function noteFirstAiTextReceipt(frame: FirstTextFrame, receivedAt = performance.now()): void {
  if (!__DEV__ || !frame.messageId || typeof frame.runId !== 'string' ||
      !TIMING_ID.test(frame.runId) || frame.runId === lastMeasuredRun ||
      frame.runId === firstTextReceipt?.runId || typeof frame.eventSeq !== 'number' ||
      !Number.isSafeInteger(frame.eventSeq) || frame.eventSeq <= 0 ||
      typeof frame.emittedAtMs !== 'number' || !Number.isSafeInteger(frame.emittedAtMs) ||
      frame.emittedAtMs <= 0 ||
      (frame.channel !== undefined && frame.channel !== 'assistant' && frame.channel !== 'stdout') ||
      !frame.delta.trim()) return;
  firstTextReceipt = {
    sessionId: frame.sessionId,
    messageId: frame.messageId,
    runId: frame.runId,
    eventSeq: frame.eventSeq,
    receivedAt,
  };
}

export function noteFirstAiTextCommit(
  sessionId: string,
  sourceMessageIds: readonly string[],
  committedAt = performance.now(),
): void {
  const sample = firstTextReceipt;
  if (!__DEV__ || !sample || sample.sessionId !== sessionId) return;
  const elapsed = committedAt - sample.receivedAt;
  if (elapsed < 0 || elapsed > FIRST_TEXT_MAX_AGE_MS) {
    firstTextReceipt = undefined;
    return;
  }
  if (!sourceMessageIds.includes(sample.messageId)) return;
  firstTextReceipt = undefined;
  lastMeasuredRun = sample.runId;
  // eslint-disable-next-line no-console
  console.log(
    `[PERF] ai-first-text run=${sample.runId} event_seq=${sample.eventSeq} receive_to_commit_ms=${Math.round(elapsed)}`,
  );
}

export function clearFirstAiTextReceipt(): void {
  firstTextReceipt = undefined;
}

export function __resetDevFrameProbeForTests(): void {
  started = false;
  lastTickAt = 0;
  lastMark = 'app-start';
  lastMarkAt = 0;
  clearFirstAiTextReceipt();
  lastMeasuredRun = undefined;
}

/**
 * 启动 rAF 巡检。重复调用安全(单例);release 下直接返回。
 * 每帧回调间隔 ≥ GAP_THRESHOLD_MS 即视为一次 JS 线程停顿并输出取证行:
 *   [PERF] js-gap=2400ms after=catchup:600 (130ms ago)
 */
export function startDevFrameProbe(): void {
  if (!__DEV__ || started) return;
  started = true;
  lastTickAt = Date.now();
  const tick = () => {
    const now = Date.now();
    const gap = now - lastTickAt;
    lastTickAt = now;
    if (gap >= GAP_THRESHOLD_MS) {
      const sinceMark = lastMarkAt ? `${Math.max(0, now - lastMarkAt)}ms ago` : '?';
      // eslint-disable-next-line no-console
      console.log(`[PERF] js-gap=${gap}ms after=${lastMark} (${sinceMark})`);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
