// 无自身能力位场景的素材能力位选择器（草稿伪会话 + 列表快照态的已有会话）。
// 会话级 attachmentsCapability 只随「单会话详情 / WS ai.session.updated 帧」下发，
// 列表快照不带 —— 草稿态（draftRun 伪会话）与刚点开、详情未回的会话自身位必然
// undefined。服务端为此在 mobile snapshot 的 features.attachments 下发了部署级
// 能力位（attachments/capability.ts：enabled 只取决于 COS 配置，与会话/工具无关），
// store 已收进 platformFeatures.attachmentsCapability；这里补上最后一跳：
// 同设备会话代理 → 任意会话代理 → 部署级位兜底（2026-11-25）。
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
  if (!draftConfig) {
    // 无草稿配置 = 从列表打开的已有会话（自身位未知的列表快照态）或非会话屏
    // 调用：设备代理无从谈起，直接回部署级位兜底（2026-11-25 伪会话门控修复）。
    return state.platformFeatures.attachmentsCapability;
  }
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
