/**
 * useSessionRouteIdentity 单测——「路由身份 ↔ 屏内状态」同步契约。
 *
 * 事故锚（2026-11-21 长按 new 串会话）：native-stack navigate 命中栈内
 * 老实例、只合并 params 不重挂载，而屏内 useState(route.params.sessionId)
 * 只在挂载取值 → 界面停在老会话（看到老历史）、发消息路由进老会话。
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { useSessionRouteIdentity } from '../src/screens/vibecoding/useSessionRouteIdentity';

let latest: ReturnType<typeof useSessionRouteIdentity>;

const Probe: React.FC<{ sessionId: string | undefined }> = ({ sessionId }) => {
  latest = useSessionRouteIdentity(sessionId);
  return null;
};

describe('useSessionRouteIdentity', () => {
  it('初始值来自 route.params.sessionId', () => {
    let root!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(<Probe sessionId="ai_old" />);
    });
    expect(latest.sessionId).toBe('ai_old');
    ReactTestRenderer.act(() => {
      root.unmount();
    });
  });

  it('route params 变化时跟随到新会话（navigate 合并 params 不重挂载的场景）', () => {
    let root!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(<Probe sessionId="ai_old" />);
    });
    ReactTestRenderer.act(() => {
      root.update(<Probe sessionId="ai_new" />);
    });
    expect(latest.sessionId).toBe('ai_new');
    ReactTestRenderer.act(() => {
      root.unmount();
    });
  });

  it('route 未带 sessionId（undefined）不触发跟随，保留挂载时的值', () => {
    let root!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(<Probe sessionId="ai_old" />);
    });
    ReactTestRenderer.act(() => {
      root.update(<Probe sessionId={undefined} />);
    });
    expect(latest.sessionId).toBe('ai_old');
    ReactTestRenderer.act(() => {
      root.unmount();
    });
  });

  it('draft 首发翻面（本地 setter）后，route 合并进同一个新 id 不回跳/不冲突', () => {
    // draft 模式 route.params.sessionId 恒 undefined；首发后 setSessionId。
    let root!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(<Probe sessionId={undefined} />);
    });
    act(() => {
      latest.setSessionId('ai_created');
    });
    expect(latest.sessionId).toBe('ai_created');
    // 同会话再次 navigate（route 侧此刻带上这个 id）：幂等无害。
    ReactTestRenderer.act(() => {
      root.update(<Probe sessionId="ai_created" />);
    });
    expect(latest.sessionId).toBe('ai_created');
    // route 侧之后又换会话（如通知中心 navigate 到别的会话）：跟随。
    ReactTestRenderer.act(() => {
      root.update(<Probe sessionId="ai_other" />);
    });
    expect(latest.sessionId).toBe('ai_other');
    ReactTestRenderer.act(() => {
      root.unmount();
    });
  });

  it('setSessionId 与 route 跟随双向共存：先跟随再翻面，以最后一次为准', () => {
    let root!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(<Probe sessionId="ai_a" />);
    });
    ReactTestRenderer.act(() => {
      root.update(<Probe sessionId="ai_b" />);
    });
    expect(latest.sessionId).toBe('ai_b');
    act(() => {
      latest.setSessionId('ai_c');
    });
    expect(latest.sessionId).toBe('ai_c');
    ReactTestRenderer.act(() => {
      root.unmount();
    });
  });
});
