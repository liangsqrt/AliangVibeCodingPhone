// Listener API contract tests (2026-11-22 P0). The server's direct cloud path
// returns BARE JSON — no {code,data} envelope (web-panel envelopes are injected
// by the agent proxy, absent here). The client module is mocked so these pin
// the verb + URL + bare-payload mapping; the old envelope-peeling version
// silently returned [] forever and would fail the first test below.
jest.mock('../client', () => ({
  apiFetch: jest.fn(),
  apiGet: jest.fn(),
  apiPost: jest.fn(),
  apiPatch: jest.fn(),
  apiPut: jest.fn(),
  apiDelete: jest.fn(),
}));

import { apiGet, apiPatch, apiDelete } from '../client';
import {
  deleteListener,
  fetchListenerEvents,
  fetchListeners,
  patchListener,
  type ListenerEvent,
  type ListenerItem,
} from '../listeners';

const mockedGet = apiGet as jest.MockedFunction<typeof apiGet>;
const mockedPatch = apiPatch as jest.MockedFunction<typeof apiPatch>;
const mockedDelete = apiDelete as jest.MockedFunction<typeof apiDelete>;

/** Compile-time contract lock: every documented field must keep its name/type. */
const fullListener: ListenerItem = {
  id: 'lst-1',
  title: 'build.log ERROR tail',
  status: 'error',
  source_type: 'file_tail',
  last_fired_at: '2026-11-22T08:00:00Z',
  fired_count: 3,
  cooldown_ms: 60_000,
  error_note: 'file removed',
  mode: 'recurring',
  target_session_id: 'sess-9',
  created_by: 'agent',
  created_at: '2026-11-20T00:00:00Z',
  updated_at: '2026-11-22T08:00:00Z',
};

const fullEvent: ListenerEvent = {
  listener_id: 'lst-1',
  fired_at: '2026-11-22T08:00:00Z',
  summary: 'matched ERROR x2',
  detail: 'ERROR: boom',
};

beforeEach(() => {
  mockedGet.mockReset();
  mockedPatch.mockReset();
  mockedDelete.mockReset();
});

describe('fetchListeners', () => {
  test('GETs /api/listeners and returns the bare {listeners:[...]} array directly', async () => {
    // 裸载荷,无信封:旧版信封剥壳在这里拿到 undefined → [] 假绿。
    mockedGet.mockResolvedValue({ listeners: [fullListener] } as never);

    const result = await fetchListeners();

    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(mockedGet).toHaveBeenCalledWith('/api/listeners');
    expect(result).toEqual([fullListener]);
  });

  test('tolerates a missing listeners field with []', async () => {
    mockedGet.mockResolvedValue({} as never);
    await expect(fetchListeners()).resolves.toEqual([]);
  });
});

describe('patchListener', () => {
  test('PATCHes the body to /api/listeners/:id and returns the bare listener object', async () => {
    mockedPatch.mockResolvedValue({ listener: fullListener } as never);

    const result = await patchListener('lst-1', {
      status: 'active',
      updated_at: fullListener.updated_at,
    });

    expect(mockedPatch).toHaveBeenCalledTimes(1);
    expect(mockedPatch).toHaveBeenCalledWith('/api/listeners/lst-1', {
      status: 'active',
      updated_at: '2026-11-22T08:00:00Z',
    });
    expect(result).toEqual(fullListener);
  });

  test('returns null when the payload has no listener field', async () => {
    mockedPatch.mockResolvedValue({} as never);
    await expect(
      patchListener('lst-1', { title: 'renamed' }),
    ).resolves.toBeNull();
  });
});

describe('deleteListener', () => {
  test('DELETEs /api/listeners/:id (passthrough, resolves void)', async () => {
    mockedDelete.mockResolvedValue({} as never);

    await deleteListener('lst-1');

    expect(mockedDelete).toHaveBeenCalledTimes(1);
    expect(mockedDelete).toHaveBeenCalledWith('/api/listeners/lst-1');
  });
});

describe('fetchListenerEvents', () => {
  test('GETs /api/listeners/:id/events and returns the bare {events:[...]} array', async () => {
    mockedGet.mockResolvedValue({ events: [fullEvent] } as never);

    const result = await fetchListenerEvents('lst-1');

    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(mockedGet).toHaveBeenCalledWith('/api/listeners/lst-1/events');
    expect(result).toEqual([fullEvent]);
  });

  test('tolerates a missing events field with []', async () => {
    mockedGet.mockResolvedValue({} as never);
    await expect(fetchListenerEvents('lst-1')).resolves.toEqual([]);
  });
});
