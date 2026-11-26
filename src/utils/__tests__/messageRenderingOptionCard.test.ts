import {
  derivedApprovalPlanKey,
  parseMessageContentSegments,
  sessionApprovalSuppressPlanKeys,
  type TranscriptCalloutSegment,
} from '../messageRendering';

/**
 * v2 结构化选项卡(optionCard 机读旁路)专项:
 *  - <card-json> 子标签 → segment.optionCard,正文不再含 JSON;
 *  - 颜文字/emoji label 逐字符保真(不过 inline markdown 管线);
 *  - previews 钳制 8×200;options 截 8;
 *  - 坏 JSON/半截流式 → optionCard 缺省走 v1 markdown 降级,JSON 不外晒。
 */

const approvalSegment = (content: string): TranscriptCalloutSegment => {
  const segments = parseMessageContentSegments('m1', content);
  const segment = segments.find(
    (segment): segment is TranscriptCalloutSegment =>
      segment.kind === 'callout' && segment.variant === 'approval',
  );
  if (!segment) throw new Error('expected approval callout segment');
  return segment;
};

const fence = (json: Record<string, unknown>) =>
  '```aliang-options\n' + JSON.stringify(json) + '\n```';

describe('messageRendering — aliang-options v2 optionCard 直通', () => {
  it('v2 围栏:optionCard 结构化拆出,颜文字 label 逐字符保真,<card-json> 不进正文', () => {
    const label = '蓝绿部署 (｡•̀ᴗ-)✧';
    const segment = approvalSegment(
      fence({
        v: 2,
        title: '选择发布策略',
        header: '部署',
        summary: '两种路径',
        multi: false,
        allow_custom: true,
        options: [
          {
            id: 'blue-green',
            label,
            description: '回滚最快',
            previews: ['kubectl apply -f a.yaml', 'kubectl rollout status'],
          },
          { id: 'in-place', label: '原地滚动升级 😊' },
        ],
      }),
    );
    expect(segment.optionCard).toBeDefined();
    const card = segment.optionCard!;
    expect(card.version).toBe(2);
    expect(card.header).toBe('部署');
    expect(card.title).toBe('选择发布策略');
    expect(card.summary).toBe('两种路径');
    expect(card.allowCustom).toBe(true);
    expect(card.multi).toBe(false);
    expect(card.options[0]?.label).toBe(label); // 颜文字逐字符
    expect(card.options[0]?.previews).toEqual([
      'kubectl apply -f a.yaml',
      'kubectl rollout status',
    ]);
    expect(card.options[1]?.label).toBe('原地滚动升级 😊');
    // 结构化字段不进人读正文;markdown 圆点降级仍在(blocks 供 v1/复制)
    expect(segment.content).not.toContain('card-json');
    expect(segment.content).not.toContain('"blue-green"');
    expect(segment.content).toContain(label);
  });

  it('multi 标志经 attr 与 card 双通道一致', () => {
    const segment = approvalSegment(
      fence({ title: '勾模块', multi: true, options: [{ id: 'a', label: 'A' }] }),
    );
    expect(segment.multi).toBe(true);
    expect(segment.optionCard?.multi).toBe(true);
  });

  it('previews 钳制 8×200,非字符串丢弃;options 截 8', () => {
    const segment = approvalSegment(
      fence({
        title: 't',
        options: Array.from({ length: 12 }, (_, i) => ({
          id: `o${i}`,
          label: `L${i}`,
          previews: ['x'.repeat(300), 42, 'ok'],
        })),
      }),
    );
    const card = segment.optionCard!;
    expect(card.options).toHaveLength(8);
    expect(card.options[0]?.previews).toEqual(['x'.repeat(200), 'ok']);
  });

  it('丢围栏裸 JSON 兜底同样产出 optionCard', () => {
    const segment = approvalSegment(
      '{"title":"裸方案","multi":true,"options":[{"id":"a","label":"(ฅ\'ω\'ฅ) 保守"}]}',
    );
    expect(segment.optionCard?.title).toBe('裸方案');
    expect(segment.optionCard?.multi).toBe(true);
    expect(segment.optionCard?.options[0]?.label).toBe("(ฅ'ω'ฅ) 保守");
  });

  it('坏 card JSON:optionCard 缺省走 v1 降级,JSON 行不外晒', () => {
    // 直接构造坏 card-json(绕过 formatAliangOptionsFence 的产出端)
    const segment = approvalSegment(
      '\n<approval-request><card-json>{"title":"broken"</card-json>需要你的批准</approval-request>\n',
    );
    expect(segment.optionCard).toBeUndefined();
    expect(segment.content).not.toContain('card-json');
    expect(segment.content).toContain('需要你的批准');
  });
});

describe('sessionApprovalSuppressPlanKeys(静态卡抑制集合,7647fda 契约收尾)', () => {
  // 2026-11-16 TUI 会话实锤:7647fda 只落了子组件与测试,会话屏从未传
  // suppressedApprovalPlanKeys → 每条 aliang-options 围栏消息渲染一张无交互
  // 死卡,用户「只能看到样式不能选择」。集合计算提为纯函数钉死契约。
  const storeApproval = {
    title: '两边名字必须一字不差：liang liang ≠ aliang',
    options: [
      { id: 'miit-to-liangliang' },
      { id: 'apple-to-aliang' },
      { id: 'tell-me-where' },
    ],
  };

  it('store 权威审批的 key 与消息围栏解析出的静态卡 key 逐字节一致', () => {
    const segment = approvalSegment(
      fence({
        title: storeApproval.title,
        options: [
          { id: 'miit-to-liangliang', label: '备案改回' },
          { id: 'apple-to-aliang', label: 'Apple 改名' },
          { id: 'tell-me-where', label: '说不清' },
        ],
      }),
    );
    const keys = sessionApprovalSuppressPlanKeys([storeApproval]);
    expect(keys.has(derivedApprovalPlanKey(segment.optionCard!))).toBe(true);
  });

  it('无 options 的审批产出独立 key,不误伤真实围栏卡', () => {
    const segment = approvalSegment(
      fence({ title: 't', options: [{ id: 'a', label: 'A' }] }),
    );
    const keys = sessionApprovalSuppressPlanKeys([
      { title: 't' },
      { title: 't', options: [] },
    ]);
    expect(keys.has(derivedApprovalPlanKey(segment.optionCard!))).toBe(false);
  });

  it('空集合→空集合', () => {
    expect(sessionApprovalSuppressPlanKeys([]).size).toBe(0);
  });
});

describe('messageRendering — 截断围栏容忍(传输限幅切尾)', () => {
  // 2026-11-25 local-mwl6wqyvv5ysrg 手机端选项卡消失事故：agent 传输层按
  // 4000 rune 截断单条消息，截断点落在 aliang-options 围栏内——开标签还在、
  // 闭合 ``` 没了，主正则与裸 JSON 配平扫描双双失效，残块被 markdown 当
  // 未闭合代码块原样外晒。这里钉截断形态的兜底契约（与 server 侧
  // extractUnclosedAgentAIOptionBlocks 镜像）：JSON 尚完整时照样转卡，
  // JSON 被切一半则整体吞掉残块。
  const fullJson = JSON.stringify({
    v: 2,
    title: '构建策略',
    options: [
      { id: 'nodeps-triton', label: '最小绕过：--no-deps 解钉 triton' },
      { id: 'wait-upstream', label: '等上游修依赖再升级' },
    ],
    allow_custom: true,
    multi: false,
  });
  const prose = '决策点出现，这影响构建策略且耗时差异大，让你拍板：';

  it('JSON 完整但闭合围栏被切:照样产出 optionCard,残块与悬空开标签不外晒', () => {
    const segments = parseMessageContentSegments(
      'm1',
      prose + '```aliang-options\n' + fullJson,
    );
    const approvals = segments.filter(
      (segment): segment is TranscriptCalloutSegment =>
        segment.kind === 'callout' && segment.variant === 'approval',
    );
    expect(approvals).toHaveLength(1);
    const card = approvals[0].optionCard!;
    expect(card.title).toBe('构建策略');
    expect(card.options).toHaveLength(2);
    expect(card.options[0]?.label).toBe('最小绕过：--no-deps 解钉 triton');
    // 旧路径(裸 JSON 兜底)只换 JSON 本体,悬空的 ```aliang-options 开标签
    // 留在文本段里被 markdown 当未闭合代码块——文本段必须同样干净。
    const text = segments
      .filter(segment => segment.kind === 'text')
      .map(segment => segment.content)
      .join('\n');
    expect(text).not.toContain('aliang-options');
    expect(text).not.toContain('nodeps-triton');
    expect(text).toContain('让你拍板');
  });

  it('JSON 被切一半(生产事故形态):不产卡,残块整体吞掉不外晒', () => {
    const truncated = prose + '```aliang-options\n' + fullJson.slice(0, -90);
    const segments = parseMessageContentSegments('m1', truncated);
    const approvals = segments.filter(
      (segment): segment is TranscriptCalloutSegment =>
        segment.kind === 'callout' && segment.variant === 'approval',
    );
    expect(approvals).toHaveLength(0);
    const text = segments
      .filter(segment => segment.kind === 'text')
      .map(segment => segment.content)
      .join('\n');
    expect(text).toContain('让你拍板');
    expect(text).not.toContain('aliang-options');
    expect(text).not.toContain('nodeps-triton');
  });

  it('开标签后是非选项形状 JSON:吞残块,不误转卡', () => {
    const segments = parseMessageContentSegments(
      'm1',
      prose + '```aliang-options\n{"foo":"bar"}',
    );
    const approvals = segments.filter(
      (segment): segment is TranscriptCalloutSegment =>
        segment.kind === 'callout' && segment.variant === 'approval',
    );
    expect(approvals).toHaveLength(0);
    const text = segments
      .filter(segment => segment.kind === 'text')
      .map(segment => segment.content)
      .join('\n');
    expect(text).not.toContain('aliang-options');
    expect(text).not.toContain('{"foo"');
  });
});

describe('messageRendering — 截断围栏容忍的误伤面(行首纯度锚定)', () => {
  // 对抗评审坐实(2026-11-25):无锚定时,散文内联提及 ```aliang-options 且
  // 其后无代码围栏 → 消息尾部被静默吞掉(修复前整条正常渲染,属本分支引入
  // 的回归);提及标签+其后有选项形状 JSON → 中间解释文字被删+JSON 被改写
  // 成脱离上下文的卡。真实围栏按约定 tag 行只含 tag(其后紧跟换行+{),
  // 以此锚定消掉误伤面;事故形态「拍板：```aliang-options\n{」仍须命中。
  const noApprovalCard = (content: string) => {
    const segments = parseMessageContentSegments('m1', content);
    return {
      approvals: segments.filter(
        (segment): segment is TranscriptCalloutSegment =>
          segment.kind === 'callout' && segment.variant === 'approval',
      ),
      text: segments
        .filter(segment => segment.kind === 'text')
        .map(segment => segment.content)
        .join('\n'),
    };
  };

  it('散文内联提及标签(同行还有正文):不吞尾部,原样渲染', () => {
    const prose =
      '说明:模型会写成 ```aliang-options 围栏,然后手机解析成卡片。这是后半句,必须保留。';
    const { approvals, text } = noApprovalCard(prose);
    expect(approvals).toHaveLength(0);
    expect(text).toContain('这是后半句,必须保留');
    expect(text).toContain('围栏,然后手机解析成卡片');
  });

  it('内联提及标签+其后有选项形状 JSON:解释文字不删(裸 JSON 兜底转卡属既有设计)', () => {
    const json = JSON.stringify({
      v: 2,
      title: '示例',
      options: [{ id: 'demo', label: '示例选项' }],
    });
    const prose =
      '讨论格式时粘贴示例:提到 ```aliang-options 围栏写法,示例 JSON 如下 ' +
      json +
      ' 注意这只是文档说明。';
    const { text } = noApprovalCard(prose);
    // 评审 caveat:粘贴的完整选项 JSON 经既有 replaceBareOptionJson 转卡是
    // 丢围栏裸 JSON 容错的既定行为(2026-11 aliopts 批),非本分支回归;
    // 本分支的契约是——围栏提及点不吞标签之后的解释文字。
    expect(text).toContain('围栏写法,示例 JSON 如下');
    expect(text).toContain('注意这只是文档说明');
  });

  it('行首提及标签但同行跟正文:不吞不转卡', () => {
    const prose = '前置说明。\n```aliang-options 是一种围栏格式说明文字,尾部保留。';
    const { approvals, text } = noApprovalCard(prose);
    expect(approvals).toHaveLength(0);
    expect(text).toContain('尾部保留');
  });

  it('tag 行后换行接非 { 开头正文:不当作截断围栏', () => {
    const prose = '说明如下:\n```aliang-options\n这里不是 JSON,只是没闭合的引用。尾部保留。';
    const { approvals, text } = noApprovalCard(prose);
    expect(approvals).toHaveLength(0);
    expect(text).toContain('尾部保留');
  });
});
