jest.mock('../../services/platformTransport', () => ({
  platformTransport: {
    createAiSession: jest.fn(),
    createProject: jest.fn(),
  },
}));

import { useControlCenterStore } from '../controlCenterStore';
import { emptySessionData } from '../internals';
import { platformTransport } from '../../services/platformTransport';
import type { ServerAiSession } from '../../api/sessions';

const mockCreateAiSession =
  platformTransport.createAiSession as jest.MockedFunction<
    typeof platformTransport.createAiSession
  >;
const mockCreateProject =
  platformTransport.createProject as jest.MockedFunction<
    typeof platformTransport.createProject
  >;

/** Minimal ServerAiSession fixture; only fields the mapping reads. */
const makeSession = (
  over: Partial<ServerAiSession> & { session_id: string },
): ServerAiSession =>
  ({
    kind: 'ai',
    user_id: 'u1',
    device_id: 'd1',
    status: 'running',
    mode: 'vibe',
    created_at: '2026-01-01T00:00:00Z',
    last_active_at: '2026-01-01T00:00:00Z',
    ...over,
  }) as ServerAiSession;

const resetStore = () => {
  useControlCenterStore.setState({
    ...emptySessionData(),
    serverMode: true,
  });
};

// 2026-11-25 线上事故(服务端 alianggate 联动修复):设备授权目录清单为空时,
// 入口层会兜底出字面 '~' 并把它当 project_path 发给 agent——服务端曾因此把
// 会话 cwd 打成 "~",整局一碰 shell 就死。客户端修复点:startAgentSession 的
// 载荷边界不外发 '~';目录未知按空串处理(服务端空 ⇒ 主目录),也不拿它建
// 项目卡。
describe('startAgentSession — never sends literal ~ as project_path', () => {
  beforeEach(() => {
    mockCreateAiSession.mockReset();
    mockCreateProject.mockReset();
    resetStore();
    mockCreateAiSession.mockResolvedValue(makeSession({ session_id: 's9' }));
    mockCreateProject.mockResolvedValue({
      project_id: 'p1',
      name: 'proj',
      status: 'ready',
    } as never);
  });

  it('directory="~" 下发空 project_path 且不建项目卡', async () => {
    await useControlCenterStore.getState().startAgentSession({
      deviceId: 'd1',
      projectId: '',
      directory: '~',
      provider: 'agentcore',
      objective: '继续',
      clientRequestId: 'r1',
    });

    expect(mockCreateAiSession).toHaveBeenCalledTimes(1);
    const payload = mockCreateAiSession.mock.calls[0][0];
    expect(payload.project_path).toBe('');
    expect(mockCreateProject).not.toHaveBeenCalled();
  });

  it('正常目录仍原样下发(回归保护)', async () => {
    mockCreateProject.mockResolvedValue({
      id: 'p1',
      deviceId: 'd1',
      path: 'D:\\minimind',
      name: 'minimind',
      description: '',
    } as never);

    await useControlCenterStore.getState().startAgentSession({
      deviceId: 'd1',
      projectId: '',
      directory: 'D:\\minimind',
      provider: 'agentcore',
      objective: '跑训练',
      clientRequestId: 'r2',
    });

    const payload = mockCreateAiSession.mock.calls[0][0];
    expect(payload.project_path).toBe('D:\\minimind');
    expect(mockCreateProject).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'D:\\minimind' }),
    );
  });
});
