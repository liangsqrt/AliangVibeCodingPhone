import { aiRunNoticeText, mapAiRunNotice } from '../aiRunNotice';

describe('mapAiRunNotice', () => {
  it('已知 code 映射 textKey', () => {
    expect(mapAiRunNotice('resume_missing')).toMatchObject({
      textKey: 'session.notice.resumeMissing',
    });
    expect(mapAiRunNotice('fork_fallback_fresh')).toMatchObject({
      textKey: 'session.notice.forkFallbackFresh',
    });
  });

  it('fork_fallback_fresh 带 detail 尾注', () => {
    const notice = mapAiRunNotice('fork_fallback_fresh', '  native thread busy  ');
    expect(notice?.detail).toBe('native thread busy');
    expect(aiRunNoticeText('正文', notice?.detail)).toBe('正文 · native thread busy');
  });

  it('未知 code 返回 null（前向兼容）', () => {
    expect(mapAiRunNotice('some_future_code')).toBeNull();
  });
});
