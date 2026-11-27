import { useControlCenterStore } from '../src/store/controlCenterStore';
import { platformTransport } from '../src/services/platformTransport';
import type { VibeCodingRun } from '../src/data/platformModels';
import { mergeAgentMessages } from '../src/store/internals';

jest.mock('../src/services/platformTransport', () => ({
  platformTransport: {
    disconnect: jest.fn(),
    loadSnapshot: jest.fn(),
    connect: jest.fn(),
    sendAiMessage: jest.fn(),
  },
}));

const run = (transcript: VibeCodingRun['transcript'] = []): VibeCodingRun => ({
  id: 's1',
  title: 'run-s1',
  deviceId: 'device-1',
  projectId: 'project-1',
  directory: '~/proj',
  status: 'idle',
  objective: '',
  model: 'Claude Code',
  risk: 'medium',
  currentStep: '',
  branch: 'main',
  lastActivityMs: 0,
  updatedAt: '',
  suggestions: [],
  transcript,
  events: [],
  structuredEvents: [],
});

describe('appendAgentMessage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useControlCenterStore.setState({
      serverMode: true,
      vibeRuns: [
        run([
          {
            id: 'old-user',
            role: 'user',
            content: 'Initial prompt',
            timestamp: '09:58',
          },
          {
            id: 'old-assistant',
            role: 'assistant',
            content: 'Initial reply',
            timestamp: '09:59',
          },
        ]),
      ],
      devices: [
        {
          id: 'device-1',
          name: 'Device',
          status: 'online',
          location: '',
          os: 'macOS',
          host: 'localhost',
          cpuLoad: 0,
          memLoad: 0,
          authorizedDirectories: [],
          activePorts: [],
          projectIds: [],
          activeSessionIds: [],
          lastSeen: '',
          remoteTerminalEnabled: true,
          aiControlEnabled: true,
                    peerExecEnabled: false,
          peerFetchEnabled: false,          capabilities: [],
          tools: [],
          history: [],
        },
      ],
    });
  });

  it('renders a user prompt optimistically at the visible tail before the request resolves', async () => {
    let resolveSend:
      | ((value: { message_id: string; status: string }) => void)
      | undefined;
    (platformTransport.sendAiMessage as jest.Mock).mockReturnValue(
      new Promise(resolve => {
        resolveSend = resolve;
      }),
    );

    const send = useControlCenterStore
      .getState()
      .appendAgentMessage('s1', 'Follow-up', 'text');

    const optimisticTranscript =
      useControlCenterStore.getState().vibeRuns[0].transcript;
    expect(optimisticTranscript.map(item => item.content)).toEqual([
      'Initial prompt',
      'Initial reply',
      'Follow-up',
    ]);
    expect(optimisticTranscript[2]).toMatchObject({
      role: 'user',
      pending: true,
    });

    resolveSend?.({ message_id: 'server-user', status: 'running' });
    await send;

    const confirmedTranscript =
      useControlCenterStore.getState().vibeRuns[0].transcript;
    expect(confirmedTranscript.map(item => item.id)).toEqual([
      'old-user',
      'old-assistant',
      'server-user',
    ]);
    expect(confirmedTranscript[2]).toMatchObject({
      role: 'user',
      content: 'Follow-up',
      pending: false,
    });
  });

  it('reuses the failed bubble and send ID after a lost response', async () => {
    useControlCenterStore.setState(state => ({
      platformFeatures: { ...state.platformFeatures, messageIdempotency: true },
      devices: state.devices.map(device => ({ ...device, capabilities: ['ai_run_start_v3'] })),
      vibeRuns: state.vibeRuns.map(item => ({ ...item, modelConfigVersion: 7 })),
    }));
    const attachments = [{
      asset_id: 'photo-1', kind: 'photo' as const, name: 'fixture.png', mime: 'image/png', bytes: 100,
    }];
    const send = platformTransport.sendAiMessage as jest.Mock;
    send.mockRejectedValueOnce(new Error('Connection lost'))
      .mockRejectedValueOnce(new Error('Still offline')).mockResolvedValueOnce({
      message_id: 'server-user', run_id: 'run-1', status: 'accepted', replayed: true,
      run_state: 'completed', run_state_version: 12,
    });
    const store = useControlCenterStore.getState();
    await expect(store.appendAgentMessage('s1', 'voice prompt', 'voice', attachments))
      .rejects.toThrow('Connection lost');
    const failed = useControlCenterStore.getState().vibeRuns[0].transcript.at(-1)!;
    expect(failed).toMatchObject({ failed: true, sendUnconfirmed: true });
    const firstArgs = send.mock.calls[0];
    expect(firstArgs[6]).toEqual(expect.any(String));
    expect(firstArgs[4]).toEqual(attachments);

    await store.retryAgentMessage('s1', failed.id);
    expect(send.mock.calls[1]).toEqual(firstArgs);
    expect(useControlCenterStore.getState().vibeRuns[0].transcript.at(-1)).toMatchObject({
      id: failed.id, failed: true, sendUnconfirmed: true,
    });
    await store.retryAgentMessage('s1', failed.id);
    expect(send.mock.calls[2]).toEqual(firstArgs);
    const recovered = useControlCenterStore.getState().vibeRuns[0];
    expect(recovered).toMatchObject({ status: 'idle', runState: 'completed', activeRunId: undefined });
    expect(recovered.transcript.map(message => message.id)).toEqual(['old-user', 'old-assistant', 'server-user']);
    expect(recovered.transcript.at(-1)).toMatchObject({ mode: 'voice', pending: false });
  });

  it('confirms a receipt bubble from the server message ID even after an older identical prompt', () => {
    const previous = { id: 'earlier', role: 'user' as const, content: 'same prompt', timestamp: '09:58' };
    const sent = { ...previous, id: 'msg_request_send-fixture', timestamp: '10:01' };
    const failed = { ...sent, failed: true, sendUnconfirmed: true, sendReceipt: { requestId: 'send-fixture' } };
    expect(mergeAgentMessages([previous, failed], [previous])).toEqual([previous, failed]);
    expect(mergeAgentMessages([previous, failed], [previous, sent])).toEqual([previous, sent]);
  });

  it('binds a new turn to the model config version visible when Send is pressed', async () => {
    useControlCenterStore.setState(state => ({
      vibeRuns: state.vibeRuns.map(item => ({ ...item, modelConfigVersion: 7 })),
    }));
    (platformTransport.sendAiMessage as jest.Mock).mockResolvedValue({
      message_id: 'server-versioned',
      status: 'running',
    });

    await useControlCenterStore.getState().appendAgentMessage('s1', 'versioned', 'text');

    expect(platformTransport.sendAiMessage).toHaveBeenCalledWith(
      's1',
      'versioned',
      'text',
      7,
      // 无素材时也显式传空数组：attachments 是末位可选参。
      [],
    );
  });

  it('does not flash the previous completed v2 run while a new send is pending', async () => {
    let resolveSend:
      | ((value: {
          message_id: string;
          status: string;
          run_id: string;
          run_state: 'queued';
          run_state_version: number;
        }) => void)
      | undefined;
    (platformTransport.sendAiMessage as jest.Mock).mockReturnValue(
      new Promise(resolve => {
        resolveSend = resolve;
      }),
    );
    useControlCenterStore.setState({
      vibeRuns: [
        {
          ...run(),
          status: 'idle',
          phase: 'completed',
          latestRunId: 'old-run',
          runState: 'completed',
          runStateVersion: 8,
        },
      ],
    });

    const send = useControlCenterStore
      .getState()
      .appendAgentMessage('s1', 'new turn', 'text');
    expect(useControlCenterStore.getState().vibeRuns[0]).toMatchObject({
      status: 'running',
      phase: 'running',
      optimisticRunPending: true,
      optimisticRunBaseVersion: 8,
    });

    resolveSend?.({
      message_id: 'server-new',
      status: 'running',
      run_id: 'new-run',
      run_state: 'queued',
      run_state_version: 9,
    });
    await send;
    expect(useControlCenterStore.getState().vibeRuns[0]).toMatchObject({
      activeRunId: 'new-run',
      latestRunId: 'new-run',
      runState: 'queued',
      runStateVersion: 9,
      optimisticRunPending: false,
    });
  });

  it('does not regress a WS-completed run when the HTTP accepted response arrives late', async () => {
    let resolveSend:
      | ((value: {
          message_id: string;
          status: string;
          run_id: string;
          run_state: 'queued';
          run_state_version: number;
        }) => void)
      | undefined;
    (platformTransport.sendAiMessage as jest.Mock).mockReturnValue(
      new Promise(resolve => {
        resolveSend = resolve;
      }),
    );
    useControlCenterStore.setState({
      vibeRuns: [
        {
          ...run(),
          latestRunId: 'old-run',
          runState: 'completed',
          runStateVersion: 8,
        },
      ],
    });
    const send = useControlCenterStore
      .getState()
      .appendAgentMessage('s1', 'fast turn', 'text');

    useControlCenterStore.setState(state => ({
      vibeRuns: state.vibeRuns.map(item =>
        item.id === 's1'
          ? {
              ...item,
              status: 'idle',
              phase: 'completed',
              activeRunId: undefined,
              latestRunId: 'new-run',
              runState: 'completed',
              runStateVersion: 11,
              optimisticRunPending: false,
              optimisticRunBaseVersion: undefined,
            }
          : item,
      ),
    }));
    resolveSend?.({
      message_id: 'server-fast',
      status: 'running',
      run_id: 'new-run',
      run_state: 'queued',
      run_state_version: 9,
    });
    await send;
    expect(useControlCenterStore.getState().vibeRuns[0]).toMatchObject({
      status: 'idle',
      phase: 'completed',
      runState: 'completed',
      runStateVersion: 11,
    });
  });

  describe('claude_code 并发 guard 与 composer 锁 / 停止按钮同源(status 事件驱动)', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      (platformTransport.sendAiMessage as jest.Mock).mockResolvedValue({
        message_id: 'server-msg',
        status: 'running',
      });
      useControlCenterStore.setState({ serverMode: true, devices: [] });
    });

    const setRun = (overrides: Partial<VibeCodingRun>) => {
      useControlCenterStore.setState({
        vibeRuns: [{ ...run(), ...overrides }],
      });
    };

    it('status=running → 拦截 claude_code 并发(回合确定在跑)', async () => {
      // 新模型:status 事件驱动,running 即「真在跑」(ai.done 不再即时翻 idle——对齐服务端
      // soft-settle;idle 由服务端 settle 广播落定),guard 与顶部相位/composer 锁/停止按钮同源。
      setRun({ status: 'running', provider: 'claude_code' });
      await expect(
        useControlCenterStore.getState().appendAgentMessage('s1', 'next-a', 'text'),
      ).rejects.toThrow('Claude Code is still running');
    });

    it('status=idle(服务端 settle 已落定)→ 不拦截,允许继续发送', async () => {
      // 回合真正静止,服务端 soft-settle 广播把 status 落成 idle → guard 放行。
      setRun({ status: 'idle', provider: 'claude_code' });
      await expect(
        useControlCenterStore.getState().appendAgentMessage('s1', 'next-b', 'text'),
      ).resolves.toBeUndefined();
    });

    it('waiting_approval → 拦截(审批期间不可发新消息)', async () => {
      setRun({ status: 'waiting_approval', provider: 'claude_code' });
      // 2026-10-24 codex 审批锁:审批等待期文案从「still running」改为审批
      // 语义(全 provider 一律拦,消息会顶掉待审批)。
      await expect(
        useControlCenterStore.getState().appendAgentMessage('s1', 'next-c', 'text'),
      ).rejects.toThrow('Approval is pending');
    });

    it('v2 runState=waiting_approval 即使裸 status=idle 也拦截', async () => {
      setRun({
        status: 'idle',
        provider: 'claude_code',
        runState: 'waiting_approval',
        runStateVersion: 4,
      });
      await expect(
        useControlCenterStore.getState().appendAgentMessage('s1', 'next-d', 'text'),
      ).rejects.toThrow('Approval is pending');
    });
  });
});
