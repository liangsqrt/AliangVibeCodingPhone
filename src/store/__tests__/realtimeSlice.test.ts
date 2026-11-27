jest.mock('../../services/platformTransport', () => ({
  platformTransport: {
    loadSnapshot: jest.fn(),
    disconnect: jest.fn(),
    connect: jest.fn(),
  },
}));

jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client');
  return { ...actual, getApiAuthToken: jest.fn() };
});

import { useControlCenterStore } from '../controlCenterStore';
import { emptySessionData, serverApprovalToClient } from '../internals';
import { platformTransport } from '../../services/platformTransport';
import { getApiAuthToken } from '../../api/client';

const mockedLoadSnapshot = platformTransport.loadSnapshot as jest.MockedFunction<
  typeof platformTransport.loadSnapshot
>;
const mockedGetAuthToken = getApiAuthToken as jest.MockedFunction<
  typeof getApiAuthToken
>;

const emptySnapshot = {
  devices: [],
  projects: [],
  aiSessions: [],
  terminalSessions: [],
  approvals: [],
  notifications: [],
  previewLinks: [],
  realtimeEvents: [],
  loadedAt: '2026-07-12T00:00:00Z',
  warnings: [],
};

describe('refreshFromServer outcome', () => {
  beforeEach(() => {
    mockedLoadSnapshot.mockReset();
    mockedGetAuthToken.mockReset();
    mockedGetAuthToken.mockReturnValue('token');
    useControlCenterStore.setState({
      ...emptySessionData(),
      serverMode: true,
      stale: false,
      lastConnectError: null,
      lastSyncedAt: 1000,
    });
  });

  test('returns {ok:true} on a successful snapshot refresh', async () => {
    mockedLoadSnapshot.mockResolvedValue(emptySnapshot as never);

    const result = (await useControlCenterStore.getState().refreshFromServer()) as {
      ok: boolean;
      error?: string;
    };

    expect(result).toEqual({ ok: true });
  });

  test('keeps cursor-loaded histories across a snapshot refresh', async () => {
    useControlCenterStore.setState({
      notificationHistory: [
        {
          id: 'history-notification',
          type: 'completed',
          title: 'Older completion',
          body: 'done',
          read: true,
          createdAt: '2026-07-01T00:00:00Z',
        },
      ],
      notificationHistoryPage: {
        initialized: true,
        loading: false,
        hasMore: true,
        nextBeforeCursor: 'older-cursor',
      },
    });
    mockedLoadSnapshot.mockResolvedValue(emptySnapshot as never);

    await useControlCenterStore.getState().refreshFromServer();

    expect(useControlCenterStore.getState().notificationHistory).toHaveLength(1);
    expect(useControlCenterStore.getState().notificationHistoryPage).toMatchObject({
      nextBeforeCursor: 'older-cursor',
    });
  });

  test('keeps live approval changes while applying an in-flight snapshot', async () => {
    const pending = {
      id: 'approval-before',
      approval_id: 'approval-before',
      user_id: 'u1',
      device_id: 'd1',
      session_id: 's1',
      kind: 'client_response',
      title: 'Approve?',
      summary: 'Waiting',
      status: 'pending',
      risk: 'low',
      created_at: '2026-07-12T00:00:00Z',
    } as const;
    const newApproval = { ...pending, id: 'approval-live', approval_id: 'approval-live', title: 'Next approval' };
    useControlCenterStore.setState({ approvals: [serverApprovalToClient(pending)] });
    let finish!: (snapshot: Awaited<ReturnType<typeof platformTransport.loadSnapshot>>) => void;
    mockedLoadSnapshot.mockReturnValue(new Promise(resolve => { finish = resolve; }));

    const store = useControlCenterStore.getState();
    const refreshing = store.refreshFromServer();
    store.handleTransportEvent({
      type: 'notification.created',
      notification: {
        id: 'approved-during-refresh', approval_id: pending.id, session_id: 's1',
        type: 'completed', title: 'Resolved', body: 'Approved', read: true,
        created_at: '2026-07-12T00:00:02Z',
      },
    } as never);
    store.handleTransportEvent({ type: 'approval.requested', approval: newApproval } as never);

    finish({
      ...emptySnapshot,
      devices: [{ id: 'd1', deviceId: 'd1', userId: 'u1', name: 'Device', tools: [], capabilities: [], history: [], authorizedDirectories: [], projectIds: [], activePorts: [] }],
      approvals: [pending],
    } as never);
    await refreshing;

    expect(useControlCenterStore.getState().approvals).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'approval-before', status: 'approved' }),
      expect.objectContaining({ id: 'approval-live', status: 'pending' }),
    ]));
  });

  test('returns {ok:false, error} when the snapshot fetch fails', async () => {
    mockedLoadSnapshot.mockRejectedValue(new Error('snapshot boom'));

    const result = (await useControlCenterStore.getState().refreshFromServer()) as {
      ok: boolean;
      error?: string;
    };

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/snapshot boom/);
  });

  test('快照失败仍保持 WS 运输层存活(快照门不再卡死 WS,2026-11-03)', async () => {
    (platformTransport.connect as jest.Mock).mockClear();

    await expect(
      useControlCenterStore.getState().initializeFromServer('token'),
    ).rejects.toThrow();

    // 快照失败:serverMode 仍为 false(数据未就绪),但 transport 必须 connect,
    // 让 WS 失败驱动通道翻转、通道翻对后事件流立即接上(2026-11-02 下午事故:
    // 快照在坏通道上反复失败 → /ws/mobile 全天零发起)。
    expect(platformTransport.connect).toHaveBeenCalled();
    expect(useControlCenterStore.getState().serverMode).toBe(false);
    expect(useControlCenterStore.getState().lastConnectError).toBeTruthy();
  });

  test('returns {ok:false} with a connection error when not connected (noop)', async () => {
    useControlCenterStore.setState({ serverMode: false });
    mockedGetAuthToken.mockReturnValue(null);

    const result = (await useControlCenterStore.getState().refreshFromServer()) as {
      ok: boolean;
      error?: string;
    };

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
