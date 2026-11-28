import {
  __resetRenderTimingForTests,
  configureRenderTimingSender,
  noteFirstTextProduced,
  noteSubsequentTextProduced,
  noteTextCommitted,
} from '../renderTiming';

// SYNC-02 客户端上屏时序:测「agent 产出 → 手机可见」,上报 PhoneServer 聚合。

const sent: Array<Record<string, unknown>> = [];
let rafCallbacks: Array<() => void> = [];

beforeEach(() => {
  __resetRenderTimingForTests();
  sent.length = 0;
  rafCallbacks = [];
  configureRenderTimingSender(message => {
    sent.push(message);
  });
  jest.spyOn(global, 'requestAnimationFrame').mockImplementation((cb: (time: number) => void) => {
    rafCallbacks.push(() => cb(0));
    return rafCallbacks.length;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

const flushFrames = () => {
  const pending = rafCallbacks;
  rafCallbacks = [];
  pending.forEach(cb => cb());
};

const PRODUCED_AT = Date.now() - 120;
const frame = (over: Record<string, unknown> = {}) => ({
  sessionId: 's1',
  messageId: 'm1',
  runId: 'run-1',
  channel: 'assistant',
  emittedAtMs: PRODUCED_AT,
  delta: 'hello',
  ...over,
});

describe('首段文字', () => {
  it('收到帧 + 提交后,在下一帧上报 first_text 且延迟为正', () => {
    noteFirstTextProduced(frame());
    expect(noteTextCommitted('s1', ['m1'])).toBe(true);
    flushFrames();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: 'client.timing',
      session_id: 's1',
      run_id: 'run-1',
      message_id: 'm1',
      kind: 'first_text',
    });
    expect(sent[0].latency_ms as number).toBeGreaterThanOrEqual(100);
  });

  it('提交不含登记的那条消息:不上报,登记保留', () => {
    noteFirstTextProduced(frame());
    expect(noteTextCommitted('s1', ['other'])).toBe(false);
    flushFrames();
    expect(sent).toHaveLength(0);
    // 后续真正提交到时仍能命中。
    expect(noteTextCommitted('s1', ['m1'])).toBe(true);
  });

  it('不同会话的提交不命中', () => {
    noteFirstTextProduced(frame());
    expect(noteTextCommitted('s2', ['m1'])).toBe(false);
  });

  it('同一 run 只测一次', () => {
    noteFirstTextProduced(frame());
    noteTextCommitted('s1', ['m1']);
    flushFrames();
    noteFirstTextProduced(frame({ messageId: 'm2' }));
    expect(noteTextCommitted('s1', ['m2'])).toBe(false);
    flushFrames();
    expect(sent).toHaveLength(1);
  });

  it.each([
    ['缺 messageId', { messageId: undefined }],
    ['runId 非法字符', { runId: 'bad id!' }],
    ['缺 emittedAtMs', { emittedAtMs: undefined }],
    ['emittedAtMs 非整数', { emittedAtMs: 1.5 }],
    ['channel 是 user', { channel: 'user' }],
    ['delta 为空', { delta: '   ' }],
  ])('不登记: %s', (_label, over) => {
    const patch = over as Record<string, unknown>;
    noteFirstTextProduced(frame(patch));
    expect(noteTextCommitted('s1', [String(patch.messageId ?? 'm1')])).toBe(false);
  });
});

describe('后续文字', () => {
  it('每个 run 最多采样 5 次', () => {
    for (let i = 0; i < 8; i += 1) {
      noteSubsequentTextProduced(frame({ messageId: `m${i}` }));
    }
    flushFrames();
    expect(sent).toHaveLength(5);
    expect(sent.every(m => m.kind === 'subsequent_text')).toBe(true);
  });

  it('不同 run 各自计数', () => {
    noteSubsequentTextProduced(frame({ runId: 'a' }));
    noteSubsequentTextProduced(frame({ runId: 'b' }));
    flushFrames();
    expect(sent).toHaveLength(2);
    expect(sent.map(m => m.run_id)).toEqual(['a', 'b']);
  });
});

describe('边界', () => {
  it('未注入 sender 时不抛错', () => {
    configureRenderTimingSender(undefined);
    noteFirstTextProduced(frame());
    noteTextCommitted('s1', ['m1']);
    expect(() => flushFrames()).not.toThrow();
  });

  it('sender 抛错被吞掉(遥测不影响用户可见行为)', () => {
    configureRenderTimingSender(() => {
      throw new Error('socket closed');
    });
    noteFirstTextProduced(frame());
    noteTextCommitted('s1', ['m1']);
    expect(() => flushFrames()).not.toThrow();
  });

  it('延迟为负或超过 1 小时:丢弃(时钟错乱的保护)', () => {
    noteFirstTextProduced(frame({ emittedAtMs: Date.now() + 60_000, runId: 'future' }));
    noteTextCommitted('s1', ['m1']);
    noteFirstTextProduced(frame({ emittedAtMs: Date.now() - 3_600_001, runId: 'old' }));
    noteTextCommitted('s1', ['m1']);
    flushFrames();
    expect(sent).toHaveLength(0);
  });
});
