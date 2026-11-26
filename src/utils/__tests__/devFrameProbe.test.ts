// devFrameProbe 单测:超阈间隔取证行 + 标记因果对照 + 单例与 release no-op 纪律。
import {
  GAP_THRESHOLD_MS,
  __resetDevFrameProbeForTests,
  perfMark,
  noteFirstAiTextReceipt,
  noteFirstAiTextCommit,
  clearFirstAiTextReceipt,
  startDevFrameProbe,
} from '../devFrameProbe';

let rafCallbacks: Array<() => void> = [];

beforeEach(() => {
  __resetDevFrameProbeForTests();
  rafCallbacks = [];
  (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (
    cb: () => void,
  ) => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
  };
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('devFrameProbe', () => {
  it('超阈间隔输出取证行,带最近标记与距今毫秒', () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(10_000);
    startDevFrameProbe();
    perfMark('snapshot:321ms');

    now.mockReturnValue(10_000 + GAP_THRESHOLD_MS + 100); // 第一帧:gap 250ms
    expect(rafCallbacks.length).toBe(1);
    rafCallbacks[0]();

    expect(console.log).toHaveBeenCalledTimes(1);
    const line = (console.log as jest.Mock).mock.calls[0][0] as string;
    expect(line).toContain(`js-gap=${GAP_THRESHOLD_MS + 100}ms`);
    expect(line).toContain('after=snapshot:321ms');
    expect(line).toContain(`${GAP_THRESHOLD_MS + 100}ms ago`);

    // 亚阈帧不产生日志,且巡检继续排程
    (console.log as jest.Mock).mockClear();
    now.mockReturnValue(10_000 + GAP_THRESHOLD_MS + 100 + 40);
    rafCallbacks[1]();
    expect(console.log).not.toHaveBeenCalled();
    // 每次巡检帧都重排程:首帧 + 亚阈帧 → 已注册 2 个执行回调,第 3 个在排程。
    expect(rafCallbacks.length).toBe(3);
  });

  it('logs the local delay once for the matching assistant bubble', () => {
    const first = {
      sessionId: 's1', messageId: 'm1', channel: 'assistant', delta: 'test text',
      runId: 'r1', eventSeq: 7, emittedAtMs: 1_000,
    };
    noteFirstAiTextReceipt({ ...first, channel: 'stderr' }, 100);
    noteFirstAiTextReceipt({ ...first, delta: ' ' }, 110);
    noteFirstAiTextReceipt(first, 120);
    noteFirstAiTextReceipt(first, 130);
    noteFirstAiTextCommit('s2', ['m1'], 200);
    noteFirstAiTextCommit('s1', ['placeholder'], 210);
    expect(console.log).not.toHaveBeenCalled();

    noteFirstAiTextCommit('s1', ['coalesced', 'm1'], 240);
    noteFirstAiTextReceipt(first, 250);
    noteFirstAiTextCommit('s1', ['m1'], 260);
    expect(console.log).toHaveBeenCalledTimes(1);
    expect(console.log).toHaveBeenCalledWith(
      '[PERF] ai-first-text run=r1 event_seq=7 receive_to_commit_ms=120',
    );
  });

  it('drops a pending sample when the view closes or the sample expires', () => {
    const first = {
      sessionId: 's1', messageId: 'm1', channel: 'assistant', delta: 'hello',
      runId: 'r1', eventSeq: 7, emittedAtMs: 1_000,
    };
    noteFirstAiTextReceipt(first, 120);
    clearFirstAiTextReceipt();
    noteFirstAiTextCommit('s1', ['m1'], 150);
    noteFirstAiTextReceipt({ ...first, runId: 'r2' }, 200);
    noteFirstAiTextCommit('s1', ['m1'], 40_000);
    expect(console.log).not.toHaveBeenCalled();
  });

  it('重复 start 是单例,不叠加巡检回调', () => {
    startDevFrameProbe();
    startDevFrameProbe();
    startDevFrameProbe();
    expect(rafCallbacks.length).toBe(1);
  });

  it('标记刷新后,下一个超阈 gap 归零距标时间', () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(20_000);
    startDevFrameProbe();
    perfMark('toast:error:x');
    now.mockReturnValue(20_000 + 5_000);
    perfMark('catchup-commit:+60');
    now.mockReturnValue(20_000 + 5_000 + GAP_THRESHOLD_MS);
    rafCallbacks[0]();
    const line = (console.log as jest.Mock).mock.calls[0][0] as string;
    expect(line).toContain('after=catchup-commit:+60');
    expect(line).toContain(`${GAP_THRESHOLD_MS}ms ago`);
  });
});
