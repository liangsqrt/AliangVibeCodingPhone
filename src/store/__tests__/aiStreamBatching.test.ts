import {
  cancelAiStreamBatch,
  markAiStreamRunFinished,
  markAiStreamRunStarted,
  pushAiStreamEvent,
  registerAiStreamApplier,
} from '../aiStreamBatching';

const delta = (sessionId: string, runId: string, text: string) => ({
  type: 'ai.delta' as const,
  sessionId,
  delta: text,
  currentStep: '',
  messageId: 'assistant-1',
  raw: { type: 'ai.delta', session_id: sessionId, run_id: runId },
});

describe('ai stream batching first-text priority', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    cancelAiStreamBatch();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('flushes the first text immediately and keeps later deltas batched', () => {
    const apply = jest.fn();
    registerAiStreamApplier(apply);
    markAiStreamRunStarted('s1', 'r1');

    pushAiStreamEvent(delta('s1', 'r1', 'first'));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenLastCalledWith([expect.objectContaining({ delta: 'first' })]);

    pushAiStreamEvent(delta('s1', 'r1', 'second'));
    expect(apply).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(100);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply.mock.calls[1][0]).toEqual([
      expect.objectContaining({ delta: 'second' }),
    ]);
  });

  it('gives the next run a fresh first-text fast path after terminal cleanup', () => {
    const apply = jest.fn();
    registerAiStreamApplier(apply);
    markAiStreamRunStarted('s1', 'r1');
    pushAiStreamEvent(delta('s1', 'r1', 'first'));
    markAiStreamRunFinished('s1');
    markAiStreamRunStarted('s1', 'r2');

    pushAiStreamEvent(delta('s1', 'r2', 'next'));
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it('does not prioritize stderr or blank deltas', () => {
    const apply = jest.fn();
    registerAiStreamApplier(apply);
    markAiStreamRunStarted('s1', 'r1');

    const stderr = { ...delta('s1', 'r1', 'stderr'), raw: { channel: 'stderr' } };
    pushAiStreamEvent(stderr);
    pushAiStreamEvent(delta('s1', 'r1', '  '));
    expect(apply).not.toHaveBeenCalled();
    jest.advanceTimersByTime(100);
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
