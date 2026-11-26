/**
 * SubagentDrawer 按需拉取契约测试。
 *
 * 2026-11-26 回归钉:拉取 effect 的依赖收敛到 event 的关键字段
 * (sessionId/taskId/phase)而非 event 引用——两个调用方都以内联对象字面量
 * 传 event,live 会话期间父层以 ≤5Hz 重渲染,若依赖引用则每次渲染取消重发,
 * 开抽屉即变成 ~5 次/秒的请求风暴 + spinner 永久闪烁。本测试用「换对象不换
 * 字段不重拉」钉住该修复;同时钉住换 taskId / phase 变化要重拉。
 *
 * BackgroundTasksPanel.test.tsx 同款手法:reanimated/safe-area 已全局 mock,
 * i18n 锁 zh。
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { fetchStructuredEventDetail } from '../../../api/sessions';
import { SubagentDrawer } from '../SubagentDrawer';
import type { StructuredActivityEvent } from '../../../data/platformModels';

jest.mock('../../../api/sessions', () => ({
  fetchStructuredEventDetail: jest.fn(),
}));

const fetchMock = fetchStructuredEventDetail as jest.MockedFunction<
  typeof fetchStructuredEventDetail
>;

type SubagentEvent = Extract<
  StructuredActivityEvent,
  { kind: 'subagent' }
> & { sessionId: string };

function makeEvent(overrides: Partial<SubagentEvent> = {}): SubagentEvent {
  return {
    kind: 'subagent',
    eventId: 'sub:task-1',
    serverEventId: 'se-1',
    messageId: 'msg-1',
    itemId: 'task-1',
    taskId: 'task-1',
    sessionId: 'sess-1',
    phase: 'progress',
    description: '调研任务',
    ...overrides,
  } as SubagentEvent;
}

async function flush() {
  await act(async () => {});
}

describe('SubagentDrawer 详情按需拉取', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ text: '结果全文', truncated: false, tools: [] });
  });

  it('父层以新对象引用反复重渲染(同 taskId/phase)→ 只拉一次', async () => {
    let root!: TestRenderer.ReactTestRenderer;
    act(() => {
      root = TestRenderer.create(
        <SubagentDrawer open event={makeEvent()} onClose={() => {}} />,
      );
    });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toEqual(['sess-1', 'synth:task-1']);

    // 模拟 live 会话父层 ≤5Hz 重渲染:每次都是全新对象、字段相同。
    for (let i = 0; i < 4; i++) {
      act(() => {
        root.update(<SubagentDrawer open event={makeEvent()} onClose={() => {}} />);
      });
    }
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('换 taskId → 重拉新任务的 synth 详情', async () => {
    let root!: TestRenderer.ReactTestRenderer;
    act(() => {
      root = TestRenderer.create(
        <SubagentDrawer open event={makeEvent()} onClose={() => {}} />,
      );
    });
    await flush();
    act(() => {
      root.update(
        <SubagentDrawer
          open
          event={makeEvent({ taskId: 'task-2', eventId: 'sub:task-2', itemId: 'task-2' })}
          onClose={() => {}}
        />,
      );
    });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]).toEqual(['sess-1', 'synth:task-2']);
  });

  it('phase 变化(running→终态)→ 重拉,抽屉里能看到最终结果', async () => {
    let root!: TestRenderer.ReactTestRenderer;
    act(() => {
      root = TestRenderer.create(
        <SubagentDrawer open event={makeEvent({ phase: 'progress' })} onClose={() => {}} />,
      );
    });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    act(() => {
      root.update(
        <SubagentDrawer open event={makeEvent({ phase: 'completed', durationMs: 30_000 })} onClose={() => {}} />,
      );
    });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('关闭态(open=false)不拉取', async () => {
    act(() => {
      TestRenderer.create(
        <SubagentDrawer open={false} event={null} onClose={() => {}} />,
      );
    });
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('拉取失败 → 显示不可用文案而非空白', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network'));
    let root!: TestRenderer.ReactTestRenderer;
    act(() => {
      root = TestRenderer.create(
        <SubagentDrawer open event={makeEvent()} onClose={() => {}} />,
      );
    });
    await flush();
    const texts: string[] = [];
    root.root.findAllByType('Text' as never).forEach(node => {
      const { children } = node.props as { children?: unknown };
      if (typeof children === 'string') texts.push(children);
    });
    expect(texts.join('\n')).toContain('详情拉取失败');
  });
});
