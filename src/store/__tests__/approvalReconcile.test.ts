// 会话级审批对账(mergeApprovalReconcile + reconcileSessionApprovals):
// 服务端 GET /api/approvals?session_id= 是该会话 pending+resolved 全量真值,
// 手机端 upsert 后,会话屏 byId 守卫即可压制事件兜底复活的幽灵 pending。
import { platformTransport, type PlatformApprovalSnapshot } from '../../services/platformTransport';
import {
  mergeApprovalReconcile,
  serverApprovalToClient,
} from '../internals';
import type { VibeCodingRun } from '../../data/platformModels';
import { useControlCenterStore } from '../controlCenterStore';

jest.mock('../../services/platformTransport', () => ({
  platformTransport: {
    loadSessionApprovals: jest.fn(),
    respondApproval: jest.fn(),
  },
}));

const mockedLoadSessionApprovals =
  platformTransport.loadSessionApprovals as jest.MockedFunction<
    typeof platformTransport.loadSessionApprovals
  >;

const baseApproval: PlatformApprovalSnapshot = {
  id: 'appr_1',
  approval_id: 'appr_1',
  user_id: 'u1',
  device_id: 'd1',
  session_id: 'ais_1',
  kind: 'client_response',
  title: '要继续吗?',
  summary: '等待确认',
  risk: 'low',
  status: 'pending',
  created_at: '2026-10-30T00:00:00Z',
};

const server = (
  overrides: Partial<PlatformApprovalSnapshot>,
): PlatformApprovalSnapshot => ({
  ...baseApproval,
  ...overrides,
});

describe('mergeApprovalReconcile', () => {
  it('upserts the server record over the local row (ghost fix core)', () => {
    const localResolvedGone = serverApprovalToClient(
      server({ id: 'appr_1', status: 'denied', resolved_at: '2026-10-30T01:00:00Z' }),
    );
    const other = serverApprovalToClient(
      server({ id: 'appr_2', session_id: 'ais_other' }),
    );
    const merged = mergeApprovalReconcile([localResolvedGone, other], [
      serverApprovalToClient(server({ id: 'appr_1', status: 'denied' })),
    ]);
    const merged1 = merged.find(item => item.id === 'appr_1');
    expect(merged1?.status).toBe('denied');
    // 其他会话不受影响
    expect(merged.find(item => item.id === 'appr_2')?.sessionId).toBe('ais_other');
  });

  it('keeps local-only entries (a reconcile response cannot repudiate what it never carried)', () => {
    const localOnly = serverApprovalToClient(
      server({ id: 'appr_local', status: 'pending' }),
    );
    const merged = mergeApprovalReconcile([localOnly], []);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('appr_local');
  });

  it('demotes same-ask local pends when the server reports a newer pending (supersede)', () => {
    const localGhost = serverApprovalToClient(
      server({ id: 'appr_old', status: 'pending' }),
    );
    const serverNewerPending = serverApprovalToClient(
      server({ id: 'appr_new', status: 'pending' }),
    );
    const merged = mergeApprovalReconcile([localGhost], [serverNewerPending]);
    expect(merged.find(item => item.id === 'appr_old')?.status).toBe('denied');
    expect(merged.find(item => item.id === 'appr_new')?.status).toBe('pending');
  });

  it('does not supersede a newer live pending card with an older response', () => {
    const newer = serverApprovalToClient(server({
      id: 'appr_live', created_at: '2026-10-30T01:00:00Z',
    }));
    const older = serverApprovalToClient(server({ id: 'appr_old' }));

    const merged = mergeApprovalReconcile([newer], [older]);

    expect(merged.find(item => item.id === newer.id)?.status).toBe('pending');
    expect(merged.find(item => item.id === older.id)?.status).toBe('denied');
  });
});

describe('reconcileSessionApprovals', () => {
  beforeEach(() => {
    mockedLoadSessionApprovals.mockReset();
    useControlCenterStore.setState({
      serverMode: true,
      approvals: [],
      approvalHistory: [],
      notifications: [],
      unreadNotificationsTotal: 0,
    });
  });

  it('keeps the pending card after a lost submission response and lets the user retry', async () => {
    useControlCenterStore.setState({ approvals: [serverApprovalToClient(baseApproval)] });
    const respond = jest.mocked(platformTransport.respondApproval);
    respond.mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValueOnce(
      server({ status: 'approved', resolved_at: '2026-10-30T01:00:00Z' }),
    );
    const store = useControlCenterStore.getState();
    const options = { selectedOptionId: 'continue' };
    await expect(store.resolveApproval(baseApproval.id, 'approved', options))
      .rejects.toThrow('Connection lost');
    expect(useControlCenterStore.getState().approvals[0].status).toBe('pending');
    await store.resolveApproval(baseApproval.id, 'approved', options);
    expect(respond).toHaveBeenLastCalledWith(baseApproval.id, 'approved', options);
    expect(useControlCenterStore.getState().approvals[0].status).toBe('approved');
  });

  it('replaces the session approvals with server truth and syncs the unread delta', async () => {
    // 幽灵场景:本地只剩 pending 幽灵快照(权威 resolved 记录已被快照替换丢弃)。
    useControlCenterStore.setState({
      approvals: [
        serverApprovalToClient(server({ id: 'appr_ghost', status: 'pending' })),
      ],
      unreadNotificationsTotal: 3, // 幽灵把 1 个已答复的算进了未读
    });
    mockedLoadSessionApprovals.mockResolvedValue([
      server({ id: 'appr_ghost', status: 'denied', resolved_at: '2026-10-30T01:00:00Z' }),
    ]);

    await useControlCenterStore.getState().reconcileSessionApprovals('ais_1');

    const state = useControlCenterStore.getState();
    expect(state.approvals.find(item => item.id === 'appr_ghost')?.status).toBe('denied');
    // 本会话 pending 从 1 降到 0,未读按行数差值下调 1(3 → 2)。
    expect(state.unreadNotificationsTotal).toBe(2);
  });

  it('raises unread when the server has more pending than the local session', async () => {
    // 漏算场景:WS 事件丢了,服务端有 2 个 pending 本地只有 1 个。
    useControlCenterStore.setState({
      approvals: [
        serverApprovalToClient(server({ id: 'appr_a', status: 'pending' })),
      ],
      unreadNotificationsTotal: 1,
    });
    mockedLoadSessionApprovals.mockResolvedValue([
      server({ id: 'appr_a', status: 'pending' }),
      server({ id: 'appr_b', status: 'pending', title: 'A different request' }),
    ]);

    await useControlCenterStore.getState().reconcileSessionApprovals('ais_1');

    expect(useControlCenterStore.getState().unreadNotificationsTotal).toBe(2);
  });

  it('merges resolved records into the cursor history archive', async () => {
    mockedLoadSessionApprovals.mockResolvedValue([
      server({ id: 'appr_ghost', status: 'approved', resolved_at: '2026-10-30T01:00:00Z' }),
    ]);

    await useControlCenterStore.getState().reconcileSessionApprovals('ais_1');

    expect(
      useControlCenterStore.getState().approvalHistory.map(item => item.id),
    ).toContain('appr_ghost');
  });

  it('keeps a live resolution that arrives while recovery is in flight', async () => {
    let finish!: (rows: PlatformApprovalSnapshot[]) => void;
    mockedLoadSessionApprovals.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    useControlCenterStore.setState({
      approvals: [serverApprovalToClient(baseApproval)],
      unreadNotificationsTotal: 1,
    });

    const store = useControlCenterStore.getState();
    const recovering = store.reconcileSessionApprovals('ais_1');
    store.handleTransportEvent({
      type: 'notification.created',
      notification: {
        id: 'resolved-notice',
        type: 'completed',
        title: 'Resolved',
        body: 'Approved',
        approval_id: baseApproval.id,
        session_id: 'ais_1',
        created_at: '2026-10-30T01:00:00Z',
        read: true,
      },
    } as never);
    const live = useControlCenterStore.getState();
    expect(live.approvals[0].status).toBe('approved');

    finish([baseApproval]);
    await recovering;

    const state = useControlCenterStore.getState();
    expect(state.approvals).toEqual(live.approvals);
    expect(state.unreadNotificationsTotal).toBe(live.unreadNotificationsTotal);
    store.handleTransportEvent({ type: 'approval.requested', approval: baseApproval } as never);
    expect(useControlCenterStore.getState().approvals[0].status).toBe('approved');
  });

  it.each([false, true])('restores the viewed run and its approval on reconnect (resolved=%s)', async resolved => {
    const status = resolved ? 'approved' : 'pending';
    useControlCenterStore.setState({
      vibeRuns: [{
        id: 'ais_1', deviceId: 'd1', status: 'running', transcript: [], events: [],
        structuredEvents: [], runState: 'running', runStateVersion: 3,
      } as unknown as VibeCodingRun],
    });
    const session = {
      session_id: 'ais_1', device_id: 'd1', status: resolved ? 'idle' : 'paused',
      phase: resolved ? 'completed' : 'waiting_approval',
      run_state: resolved ? 'completed' : 'waiting_approval',
      run_state_version: 4,
      last_active_at: '2026-10-30T01:00:00Z',
      transcript_count: 0,
    };
    mockedLoadSessionApprovals.mockResolvedValue({
      session, approvals: [server({ status })],
    } as never);

    await useControlCenterStore.getState().reconcileSessionApprovals('ais_1');
    const state = useControlCenterStore.getState();
    expect(state.approvals).toMatchObject([{ id: baseApproval.id, status }]);
    expect(state.vibeRuns[0]).toMatchObject({
      runState: session.run_state, runStateVersion: 4,
    });
  });

  it('converges across 100 seeded recovery and live-event schedules', async () => {
    let seed = 20261127;
    const nextBits = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed >>> 16;
    };
    for (let attempt = 0; attempt < 100; attempt++) {
      const resolved = (nextBits() & 1) === 1;
      const settlesDuringRecovery = resolved && (nextBits() & 1) === 1;
      const id = `approval-${attempt}`;
      const pending = server({ id, approval_id: id });
      const session = {
        session_id: 'ais_1', device_id: 'd1', status: 'paused',
        phase: 'waiting_approval', run_state: 'waiting_approval', run_state_version: 4,
        transcript_count: 0, last_active_at: '2026-10-30T01:00:00Z',
      } as const;
      const completed = {
        ...session, status: 'idle', phase: 'completed', run_state: 'completed', run_state_version: 5,
      } as const;
      useControlCenterStore.setState({
        approvals: [], approvalHistory: [], notifications: [], events: [],
        vibeRuns: [{
          id: session.session_id, deviceId: 'd1', status: 'running', transcript: [],
          events: [], structuredEvents: [], runState: 'running', runStateVersion: 3,
        } as unknown as VibeCodingRun],
      });

      const snapshot = {
        session: resolved && !settlesDuringRecovery ? completed : session,
        approvals: [{ ...pending, status: resolved && !settlesDuringRecovery ? 'approved' : 'pending' } as const],
      };
      let finish!: (value: typeof snapshot) => void;
      mockedLoadSessionApprovals.mockReturnValue(new Promise(resolve => { finish = resolve; }));
      const store = useControlCenterStore.getState();
      const recovering = store.reconcileSessionApprovals('ais_1');
      if (settlesDuringRecovery) {
        if ((nextBits() & 1) === 1) {
          store.handleTransportEvent({ type: 'approval.requested', approval: pending } as never);
        }
        store.handleTransportEvent({
          type: 'notification.created',
          notification: {
            id: `resolved-${id}`, type: 'completed', title: 'Resolved', body: 'Approved',
            read: true, approval_id: id, session_id: 'ais_1', created_at: '2026-10-30T01:00:00Z',
          },
        } as never);
        store.handleTransportEvent({ type: 'ai.session.updated', session: completed } as never);
      }
      finish(snapshot);
      await recovering;

      store.handleTransportEvent({ type: 'approval.requested', approval: pending } as never);
      const state = useControlCenterStore.getState();
      expect(state.approvals.filter(approval => approval.status === 'pending').map(approval => approval.id))
        .toEqual(resolved ? [] : [id]);
      expect(state.vibeRuns[0].runState).toBe(resolved ? 'completed' : 'waiting_approval');
    }
  });

  it('no-ops without a platform connection', async () => {
    useControlCenterStore.setState({ serverMode: false });
    await useControlCenterStore.getState().reconcileSessionApprovals('ais_1');
    expect(mockedLoadSessionApprovals).not.toHaveBeenCalled();
  });
});
