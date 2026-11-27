// Pins the WebSocket refresh→reconnect contract: after the server rejects an
// expired token (close 1008 + auth reason) and refreshSession rotates the
// access token, the reconnect MUST carry the NEW token. Reusing the token
// frozen at construction (this.token) makes a refreshable soft-expiry escalate
// to a logout every time.

jest.mock('../src/config/localService', () => ({
  getPlatformServiceBaseUrl: jest.fn(async () => 'https://platform.test'),
  toWebSocketUrl: (url: string) => url.replace(/^http/, 'ws'),
  reportChannelFailure: jest.fn(),
}));
jest.mock('../src/api/sessionAuth', () => ({
  isAuthRejectionClose: (code: number) => code === 1008,
  notifySessionInvalidated: jest.fn(),
  refreshSession: jest.fn(),
}));
jest.mock('../src/api/client', () => ({
  getApiAuthToken: jest.fn(),
}));
jest.mock('../src/services/commandGenEvents', () => ({
  dispatchCommandGenEvent: jest.fn(),
}));

import { MobileWebSocket } from '../src/services/websocket';
import { AppState } from 'react-native';
import { refreshSession } from '../src/api/sessionAuth';
import { getApiAuthToken } from '../src/api/client';
import {
  getPlatformServiceBaseUrl,
  reportChannelFailure,
} from '../src/config/localService';

// Minimal fake WebSocket global: records every URL a connection was opened
// against and lets the test drive onclose (the server auth-rejection path).
class FakeWebSocket {
  static OPEN = 1;
  static urls: string[] = [];
  readonly url: string;
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  readyState = FakeWebSocket.OPEN;
  sent: string[] = [];
  send(payload: string) { this.sent.push(payload); }
  constructor(url: string) {
    this.url = url;
    FakeWebSocket.urls.push(url);
  }
  close() {}
  static reset() {
    FakeWebSocket.urls = [];
  }
}

const flush = async (rounds = 5) => {
  for (let i = 0; i < rounds; i++) {
    await new Promise<void>(resolve => setImmediate(resolve));
  }
};

describe('MobileWebSocket refresh→reconnect uses rotated token', () => {
  const originalWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;

  beforeEach(() => {
    FakeWebSocket.reset();
    (globalThis as { WebSocket: unknown }).WebSocket = FakeWebSocket;
    (refreshSession as jest.Mock).mockReset();
    (getApiAuthToken as jest.Mock).mockReset();
  });

  afterEach(() => {
    (globalThis as { WebSocket: unknown }).WebSocket = originalWebSocket;
  });

  it('reconnects with the rotated token, not the stale construction-time token', async () => {
    let currentToken = 'T_OLD';
    (getApiAuthToken as jest.Mock).mockImplementation(() => currentToken);
    (refreshSession as jest.Mock).mockImplementation(async () => {
      currentToken = 'T_NEW'; // refreshSession persists the rotated access token
      return true;
    });

    const socket = new MobileWebSocket(() => {}, { token: 'T_OLD' });
    socket.connect();
    await flush();

    expect(FakeWebSocket.urls).toEqual([
      'wss://platform.test/ws/mobile?token=T_OLD',
    ]);

    // Server rejects the expired token (1008 + auth reason).
    const firstConnection = (socket as unknown as { ws: FakeWebSocket }).ws;
    firstConnection.onclose!({ code: 1008, reason: 'authentication_required' });
    await flush();

    // After refresh rotated the token, the reconnect must carry T_NEW.
    expect(FakeWebSocket.urls).toContain('wss://platform.test/ws/mobile?token=T_NEW');
    expect(refreshSession).toHaveBeenCalledTimes(1);

    socket.disconnect();
  });
});

describe('MobileWebSocket foreground liveness probe', () => {
  const originalWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;

  beforeEach(() => {
    FakeWebSocket.reset();
    (globalThis as { WebSocket: unknown }).WebSocket = FakeWebSocket;
    (getApiAuthToken as jest.Mock).mockImplementation(() => 'T_OLD');
  });

  afterEach(() => {
    jest.useRealTimers();
    (globalThis as { WebSocket: unknown }).WebSocket = originalWebSocket;
  });

  async function connect() {
    const socket = new MobileWebSocket(() => {}, { token: 'T_OLD' });
    socket.connect();
    await flush();
    const connection = (socket as unknown as { ws: FakeWebSocket }).ws;
    connection.onopen!({});
    return { socket, connection };
  }

  it('retains a healthy socket after a delayed reply and coalesces duplicate probes', async () => {
    const { socket, connection } = await connect();
    jest.useFakeTimers();
    try {
      socket.probeForegroundConnection();
      socket.probeForegroundConnection();
      expect(connection.sent).toHaveLength(1);
      jest.advanceTimersByTime(1500);
      expect(connection.sent).toHaveLength(2);
      connection.onmessage!({ data: JSON.stringify({ type: 'pong' }) });
      socket.probeForegroundConnection();
      jest.advanceTimersByTime(1500);
      expect(connection.sent).toHaveLength(2);
      expect(FakeWebSocket.urls).toHaveLength(1);
    } finally {
      socket.disconnect();
    }
  });

  it('replaces a silent socket once and preserves backoff after an unsuccessful dial', async () => {
    const { socket, connection } = await connect();
    jest.useFakeTimers();
    try {
      socket.probeForegroundConnection();
      jest.advanceTimersByTime(2999);
      expect(FakeWebSocket.urls).toHaveLength(1);
      expect(connection.sent).toHaveLength(2);
      await jest.advanceTimersByTimeAsync(1);
      expect(FakeWebSocket.urls).toHaveLength(2);

      const replacement = (socket as unknown as { ws: FakeWebSocket }).ws;
      replacement.onclose!({ code: 1006, reason: '' });
      socket.probeForegroundConnection();
      await jest.advanceTimersByTimeAsync(999);
      expect(FakeWebSocket.urls).toHaveLength(2);
      await jest.advanceTimersByTimeAsync(1);
      expect(FakeWebSocket.urls).toHaveLength(3);
    } finally {
      socket.disconnect();
    }
  });

  it('cancels pending probes when the app backgrounds or disconnects', async () => {
    const { socket, connection } = await connect();
    jest.useFakeTimers();
    try {
      socket.probeForegroundConnection();
      socket.cancelForegroundProbe();
      jest.advanceTimersByTime(3000);
      expect(connection.sent).toHaveLength(1);
      expect(FakeWebSocket.urls).toHaveLength(1);
    } finally {
      socket.disconnect();
    }
  });

  it('detects prolonged foreground silence within ten seconds', async () => {
    const state = AppState.currentState;
    AppState.currentState = 'active';
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    const { socket, connection } = await connect();
    try {
      await jest.advanceTimersByTimeAsync(3000);
      expect(connection.sent).toHaveLength(1);
      await jest.advanceTimersByTimeAsync(5000);
      connection.onmessage!({ data: JSON.stringify({ type: 'ai.session.updated' }) });
      await jest.advanceTimersByTimeAsync(1000);
      expect(FakeWebSocket.urls).toHaveLength(1);
      // The application frame confirmed the original channel; only the next
      // unanswered heartbeat is evidence for switching it.
      await jest.advanceTimersByTimeAsync(6000);
      expect(FakeWebSocket.urls).toHaveLength(2);
    } finally {
      socket.disconnect();
      AppState.currentState = state;
    }
  });
});

describe('MobileWebSocket channel-failure counter wiring', () => {
  const originalWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;

  beforeEach(() => {
    FakeWebSocket.reset();
    (globalThis as { WebSocket: unknown }).WebSocket = FakeWebSocket;
    (refreshSession as jest.Mock).mockReset();
    (getApiAuthToken as jest.Mock).mockReset();
    (getPlatformServiceBaseUrl as jest.Mock).mockClear();
    (reportChannelFailure as jest.Mock).mockClear();
  });

  afterEach(() => {
    (globalThis as { WebSocket: unknown }).WebSocket = originalWebSocket;
  });

  it('counts each abnormal close that schedules a reconnect (3 连败 → 3 计数)', async () => {
    (getApiAuthToken as jest.Mock).mockImplementation(() => 'T_OLD');
    const socket = new MobileWebSocket(() => {}, { token: 'T_OLD' });
    socket.connect();
    await flush();

    // 1006 = abnormal (network-level) close: the channel failed us, so each
    // close→reconnect cycle must feed the channel failure counter.
    const conn = (socket as unknown as { ws: FakeWebSocket }).ws;
    conn.onclose!({ code: 1006, reason: '' });
    conn.onclose!({ code: 1006, reason: '' });
    conn.onclose!({ code: 1006, reason: '' });
    expect(reportChannelFailure).toHaveBeenCalledTimes(3);

    // Intentional disconnect must NOT feed the counter.
    socket.disconnect();
    expect(reportChannelFailure).toHaveBeenCalledTimes(3);
  });

  it('counts a connect failure when doConnect itself rejects', async () => {
    (getPlatformServiceBaseUrl as jest.Mock).mockRejectedValueOnce(
      new Error('unreachable')
    );
    const socket = new MobileWebSocket(() => {}, {});
    socket.connect();
    await flush();

    expect(reportChannelFailure).toHaveBeenCalledTimes(1);
    socket.disconnect();
  });

  it('does not count auth-rejection closes (token problem, not channel)', async () => {
    (getApiAuthToken as jest.Mock).mockImplementation(() => 'T_OLD');
    (refreshSession as jest.Mock).mockResolvedValueOnce(true);
    const socket = new MobileWebSocket(() => {}, { token: 'T_OLD' });
    socket.connect();
    await flush();

    const conn = (socket as unknown as { ws: FakeWebSocket }).ws;
    conn.onclose!({ code: 1008, reason: 'authentication_required' });
    await flush();

    expect(reportChannelFailure).not.toHaveBeenCalled();
    socket.disconnect();
  });
});
