// 草稿态（首条消息前、尚无会话）的素材能力位选择器。
// 会话级 attachmentsCapability 只随「单会话详情 / WS ai.session.updated 帧」下发，
// 列表快照不带 —— 全新装机 / 零详情缓存的用户在草稿态必然 undefined（此前的代理
// 选择器拿到 undefined 就 fail-closed 隐藏入口）。服务端为此专门在 mobile snapshot
// 的 features.attachments 下发了部署级能力位（attachments/capability.ts：enabled
// 只取决于 COS 配置，与会话/工具无关），store 已收进
// platformFeatures.attachmentsCapability；这里补上最后一跳：代理会话没有时回退
// 部署级位，草稿入口不再对「从没点开过会话详情」的用户静默消失（2026-11-25）。
import type { AttachmentCapability } from '../../api/attachments';

/** 结构化最小面，便于单测：只需 vibeRuns / platformFeatures / draftConfig。 */
export interface DraftCapabilityState {
  vibeRuns: ReadonlyArray<{
    deviceId?: string;
    attachmentsCapability?: AttachmentCapability;
  }>;
  platformFeatures: {
    attachmentsCapability?: AttachmentCapability;
  };
}

export interface DraftConfigRef {
  deviceId?: string;
}

export function selectDraftAttachmentsCapability(
  state: DraftCapabilityState,
  draftConfig: DraftConfigRef | null | undefined,
): AttachmentCapability | undefined {
  if (!draftConfig) return undefined;
  // 先找同设备的会话（代理最忠实），退化到任意会话，最后回退部署级能力位。
  for (const run of state.vibeRuns) {
    if (
      run.deviceId === draftConfig.deviceId &&
      run.attachmentsCapability !== undefined
    ) {
      return run.attachmentsCapability;
    }
  }
  for (const run of state.vibeRuns) {
    if (run.attachmentsCapability !== undefined) {
      return run.attachmentsCapability;
    }
  }
  return state.platformFeatures.attachmentsCapability;
}
