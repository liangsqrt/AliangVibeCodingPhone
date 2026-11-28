import type { AgentMessage } from '../data/platformModels';

/**
 * 取消息的会话级 seq。0 表示「不可排序」(旧 agent、本地新气泡、失败发送)。
 *
 * 与网页端 `chatMessageSeq` 同契约(DEBT-05):seq 由产生数据的那一端分配,
 * 是唯一可比的先后真值。数组序在「快照限幅截尾 + 本地草稿 + 详情分页」合并时
 * 会丢真实先后;timestamp 跨端写入会倒挂(网页端历史事故:云端 position 对实录
 * 47095 反序)。手机此前完全没有这层保护,同一份数据在两端可能呈现不同顺序。
 */
export function messageSeq(m: AgentMessage | undefined | null): number {
  const v = m && m.seq;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * 按 seq 升序,但**只重排带 seq 的元素,且只占用它们自己原来的下标位**。
 *
 * 刻意不是普通 comparator:对不可比的一对返回 0 会破坏比较器传递性
 * (a~b、a~c 但 b<c),JS 引擎对不一致比较器的行为是实现定义,可能把一个无 seq
 * 的本地气泡甩到别处。占位排序保证无 seq 的条目(本地草稿、失败发送、运行尾
 * 占位、旧 agent 的行)永远原地不动。
 *
 * 语义:新旧混合时旧记录序完全不变;全是新记录时得到真正的 seq 序;部分新旧
 * 混合时新记录在「新记录占据的那些位置」内互相排好。
 *
 * O(n log n),不改原数组;无可排序内容时原样返回入参(调用方常在无变化场景
 * 比对引用,避免无谓重渲染)。
 */
export function orderBySeqSlots<T>(list: readonly T[], seqOf: (item: T) => number): T[] {
  const slots: number[] = [];
  const sortable: T[] = [];
  for (let i = 0; i < list.length; i += 1) {
    if (seqOf(list[i]) > 0) {
      slots.push(i);
      sortable.push(list[i]);
    }
  }
  if (sortable.length < 2) return list as T[];
  const sorted = sortable
    .map((item, order) => ({ item, order, seq: seqOf(item) }))
    .sort((a, b) => a.seq - b.seq || a.order - b.order)
    .map(entry => entry.item);
  const out = list.slice();
  for (let k = 0; k < slots.length; k += 1) {
    out[slots[k]] = sorted[k];
  }
  return out;
}

/** 消息列表按会话级 seq 做占位排序。 */
export function orderMessagesBySeq<T extends AgentMessage>(messages: readonly T[]): T[] {
  return orderBySeqSlots(messages, messageSeq);
}
