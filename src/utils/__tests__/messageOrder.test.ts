import casesJson from '../__fixtures__/message-order-cases.json';
import { messageSeq, orderBySeqSlots, orderMessagesBySeq } from '../messageOrder';
import type { AgentMessage } from '../../data/platformModels';

// DEBT-05 共享回归夹具:同一批乱序/重复/旧快照样例,手机与网页必须收敛到
// 相同顺序。权威源在 alianggate
// docs/superpowers/fixtures/message-order-cases.json;本仓 __fixtures__ 下是
// 逐字节副本(sha256 对拍),改一处要同步另一处。
const cases = casesJson.cases as Array<{
  name: string;
  input: Array<{ id: string; seq?: number }>;
  expected: string[];
}>;

const toMessage = (row: { id: string; seq?: number }): AgentMessage => ({
  id: row.id,
  role: 'user',
  content: row.id,
  timestamp: '2026-11-28T00:00:00.000Z',
  ...(row.seq !== undefined ? { seq: row.seq } : {}),
});

describe('message order contract (shared with web)', () => {
  for (const tc of cases) {
    it(tc.name, () => {
      const input = tc.input.map(toMessage);
      const before = input.map(m => m.id);
      const out = orderMessagesBySeq(input);
      expect(out.map(m => m.id)).toEqual(tc.expected);
      // 不改原数组:排序不得产生副作用。
      expect(input.map(m => m.id)).toEqual(before);
    });
  }

  it('messageSeq: 0/负数/缺字段/非数字一律视为不可排序', () => {
    expect(messageSeq({ seq: 5 } as AgentMessage)).toBe(5);
    expect(messageSeq({ seq: 0 } as AgentMessage)).toBe(0);
    expect(messageSeq({ seq: -1 } as AgentMessage)).toBe(0);
    expect(messageSeq({} as AgentMessage)).toBe(0);
    expect(messageSeq({ seq: '7' } as unknown as AgentMessage)).toBe(0);
    expect(messageSeq(undefined)).toBe(0);
    expect(messageSeq(null)).toBe(0);
  });

  it('无可排序内容时原样返回入参(引用相等),避免无谓重渲染', () => {
    const allPlain = [toMessage({ id: 'a' }), toMessage({ id: 'b' })];
    expect(orderMessagesBySeq(allPlain)).toBe(allPlain);
    const single = [toMessage({ id: 'solo', seq: 1 }), toMessage({ id: 'plain' })];
    expect(orderMessagesBySeq(single)).toBe(single);
  });

  it('orderBySeqSlots 对任意 T 工作,不依赖消息形态', () => {
    const rows = [{ k: 'c', n: 3 }, { k: 'a', n: 1 }, { k: 'b', n: 2 }];
    expect(orderBySeqSlots(rows, r => r.n).map(r => r.k)).toEqual(['a', 'b', 'c']);
  });
});
