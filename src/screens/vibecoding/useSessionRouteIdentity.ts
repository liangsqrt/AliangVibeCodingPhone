/**
 * useSessionRouteIdentity — 会话屏「路由身份 ↔ 屏内状态」同步。
 *
 * 为什么需要：本屏以 `useState(route.params.sessionId)` 固化会话身份
 * （draft 首发后还会 setCreatedSessionId 翻面），而 React Navigation 的
 * `navigate` 在 native-stack 上是「栈内已存在同名路由 → pop 回去并合并
 * params，不重新挂载」（根 stack 只注册一个 VibeCodingSession，且
 * freezeOnBlur 让被盖住的老实例保活）。params 换了、state 不换的后果：
 * 界面/订阅/发消息/focus 对账全部钉在老会话上——用户在 A 的界面上以为
 * 开的是 B：看到 A 的历史、提问发进 A（2026-11-21 长按 new 串会话事故）。
 *
 * 这里补上缺失的半边：route.params.sessionId 变化（≠ 上次见过的值）时
 * 跟随到新 id。选择「跟随」而不是「仅初始化」：
 * - 通知中心/审批中心/长按 new 等 navigate 入口全部受益（治本）；
 * - draft 流不受影响：draft 模式 route.params.sessionId 恒 undefined，
 *   effect 不触发；首发后 setSessionId(newId) 也不与 route 冲突——
 *   lastRouteRef 只记 route 侧见过的值，route 侧此后若合并进同一个
 *   newId（同会话再次 navigate），set 同值幂等无害。
 */
import { useEffect, useRef, useState } from 'react';

export function useSessionRouteIdentity(
  routeSessionId: string | undefined,
): {
  /** 当前生效的会话身份（route 跟随 + draft 首发翻面的合并结果）。 */
  sessionId: string | undefined;
  /** draft 首发后翻面用；普通挂载入口不需要。 */
  setSessionId: (id: string) => void;
} {
  const [sessionId, setSessionIdState] = useState(routeSessionId);
  // route 侧「上次见过的 sessionId」。不直接比较 state：draft 首发后
  // state 会被本地 setter 改掉，而 route 侧没动——那不是 route 变化，
  // 不能触发跟随。
  const lastRouteSessionIdRef = useRef(routeSessionId);

  useEffect(() => {
    if (!routeSessionId) return;
    if (routeSessionId === lastRouteSessionIdRef.current) return;
    lastRouteSessionIdRef.current = routeSessionId;
    setSessionIdState(prev => (prev === routeSessionId ? prev : routeSessionId));
  }, [routeSessionId]);

  const setSessionId = (id: string) => {
    setSessionIdState(id);
  };

  return { sessionId, setSessionId };
}
