import {
  selectDraftAttachmentsCapability,
  type DraftCapabilityState,
} from '../draftAttachments';
import type { AttachmentCapability } from '../../../api/attachments';

const cap = (enabled: boolean): AttachmentCapability => ({
  enabled,
  max_bytes: 10_485_760,
  max_per_message: 8,
  max_text_chars: 32_768,
});

const build = (
  runs: DraftCapabilityState['vibeRuns'],
  platform: AttachmentCapability | undefined,
): DraftCapabilityState => ({
  vibeRuns: runs,
  platformFeatures: { attachmentsCapability: platform },
});

describe('selectDraftAttachmentsCapability — 草稿素材能力位代理链', () => {
  test('无 draftConfig（非草稿态）→ undefined，选择器不参与', () => {
    const state = build([{ deviceId: 'dev-1', attachmentsCapability: cap(true) }], cap(true));
    expect(selectDraftAttachmentsCapability(state, null)).toBeUndefined();
    expect(selectDraftAttachmentsCapability(state, undefined)).toBeUndefined();
  });

  test('同设备会话的位最忠实 → 直接采用', () => {
    const sameDevice = cap(true);
    const state = build(
      [
        { deviceId: 'dev-2', attachmentsCapability: cap(false) },
        { deviceId: 'dev-1', attachmentsCapability: sameDevice },
      ],
      undefined,
    );
    expect(selectDraftAttachmentsCapability(state, { deviceId: 'dev-1' })).toBe(sameDevice);
  });

  test('同设备位未知 → 退化到任意会话代理（列表快照全不带位的旧场景不受影响）', () => {
    const anyRun = cap(true);
    const state = build(
      [
        { deviceId: 'dev-1', attachmentsCapability: undefined },
        { deviceId: 'dev-9', attachmentsCapability: anyRun },
      ],
      undefined,
    );
    expect(selectDraftAttachmentsCapability(state, { deviceId: 'dev-1' })).toBe(anyRun);
  });

  test('零详情缓存（所有 run 位 undefined）+ 部署级位在场 → 部署级兜底（2026-11-25 回归锚）', () => {
    const platform = cap(true);
    const state = build(
      [
        { deviceId: 'dev-1', attachmentsCapability: undefined },
        { deviceId: 'dev-2', attachmentsCapability: undefined },
      ],
      platform,
    );
    expect(selectDraftAttachmentsCapability(state, { deviceId: 'dev-1' })).toBe(platform);
  });

  test('服务端 COS 未配置 → 部署级位 enabled:false 原样透传（诚实下环，不伪造 true）', () => {
    const state = build([], cap(false));
    const result = selectDraftAttachmentsCapability(state, { deviceId: 'dev-1' });
    expect(result?.enabled).toBe(false);
  });

  test('连部署级位都没有（旧 server / 快照未同步）→ undefined 维持 fail-closed', () => {
    const state = build([{ deviceId: 'dev-1', attachmentsCapability: undefined }], undefined);
    expect(selectDraftAttachmentsCapability(state, { deviceId: 'dev-1' })).toBeUndefined();
  });
});
