import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text, AppState } from 'react-native';

jest.mock('../src/services/platformTransport', () => ({
  platformTransport: { send: jest.fn() },
}));

import { usePresenceHeartbeat } from '../src/hooks/usePresenceHeartbeat';
import { platformTransport } from '../src/services/platformTransport';
import { useControlCenterStore } from '../src/store/controlCenterStore';

const sendMock = platformTransport.send as jest.Mock;
const originalRefreshFromServer =
  useControlCenterStore.getState().refreshFromServer;
const refreshFromServerMock = jest.fn().mockResolvedValue(undefined);
const originalRefreshOperations =
  useControlCenterStore.getState().refreshOperations;
const refreshOperationsMock = jest.fn().mockResolvedValue(undefined);

type ChangeHandler = (state: string) => void;
let changeHandlers: ChangeHandler[] = [];

const Probe: React.FC = () => {
  usePresenceHeartbeat();
  return <Text />;
};

// Drive the captured AppState 'change' handlers (the hook subscribes on mount).
const emitAppState = (state: string) => {
  for (const handler of changeHandlers) handler(state);
};

const setCurrentAppState = (state: string) => {
  Object.defineProperty(AppState, 'currentState', {
    value: state,
    configurable: true,
    writable: true,
  });
};

describe('usePresenceHeartbeat', () => {
  beforeEach(() => {
    changeHandlers = [];
    sendMock.mockClear();
    refreshFromServerMock.mockClear();
    refreshOperationsMock.mockClear();
    useControlCenterStore.setState({
      serverMode: true,
      wsConnected: true,
      currentlyViewedSessionId: undefined,
      refreshFromServer: refreshFromServerMock,
      refreshOperations: refreshOperationsMock,
    });
    jest.useFakeTimers();
    jest.clearAllTimers();
    setCurrentAppState('active');
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((((event: string, handler: ChangeHandler) => {
        if (event === 'change') changeHandlers.push(handler);
        return { remove: jest.fn() };
      }) as unknown) as typeof AppState.addEventListener);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    useControlCenterStore.setState({
      serverMode: false,
      wsConnected: false,
      currentlyViewedSessionId: undefined,
      refreshFromServer: originalRefreshFromServer,
      refreshOperations: originalRefreshOperations,
    });
    jest.useRealTimers();
  });

  it('sends presence.alive on mount and every 60s while in the foreground', () => {
    let screen: ReactTestRenderer.ReactTestRenderer | undefined;
    act(() => {
      screen = ReactTestRenderer.create(<Probe />);
    });

    // Foreground at mount => one immediate heartbeat.
    expect(sendMock).toHaveBeenCalledWith({ type: 'presence.alive' });
    expect(sendMock).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    expect(sendMock).toHaveBeenCalledTimes(2);

    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    expect(sendMock).toHaveBeenCalledTimes(3);

    act(() => {
      screen?.unmount();
    });
  });

  it('stops heartbeats when the app backgrounds and resumes on foreground', () => {
    let screen: ReactTestRenderer.ReactTestRenderer | undefined;
    act(() => {
      screen = ReactTestRenderer.create(<Probe />);
    });
    expect(sendMock).toHaveBeenCalledTimes(1);

    // Background: advancing time must NOT produce new heartbeats.
    act(() => {
      emitAppState('background');
      jest.advanceTimersByTime(180_000);
    });
    expect(sendMock).toHaveBeenCalledTimes(1);

    // Foreground again: an immediate heartbeat fires, then the cadence resumes.
    act(() => {
      emitAppState('active');
    });
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(refreshFromServerMock).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    expect(sendMock).toHaveBeenCalledTimes(3);

    act(() => {
      screen?.unmount();
    });
  });

  it('re-pulls task operations on background→active so missed terminal outcomes are caught up', () => {
    let screen: ReactTestRenderer.ReactTestRenderer | undefined;
    act(() => {
      screen = ReactTestRenderer.create(<Probe />);
    });
    // Initial foreground mount mirrors the initial connect, which already
    // pulls the operations snapshot — no extra pull.
    expect(refreshOperationsMock).not.toHaveBeenCalled();

    // Backgrounding alone pulls nothing.
    act(() => emitAppState('background'));
    expect(refreshOperationsMock).not.toHaveBeenCalled();

    // The background→active hop is the only recovery path when RN keeps the
    // socket "connected" across suspension (no reconnect => no operations
    // refresh): pull the operations feed once alongside the snapshot refresh.
    act(() => emitAppState('active'));
    expect(refreshOperationsMock).toHaveBeenCalledTimes(1);
    expect(refreshFromServerMock).toHaveBeenCalledTimes(1);

    act(() => screen?.unmount());
  });

  it('skips the task-operations catch-up when not in server mode', () => {
    act(() => {
      useControlCenterStore.setState({ serverMode: false });
    });
    let screen: ReactTestRenderer.ReactTestRenderer | undefined;
    act(() => {
      screen = ReactTestRenderer.create(<Probe />);
    });
    act(() => emitAppState('background'));
    act(() => emitAppState('active'));
    expect(refreshOperationsMock).not.toHaveBeenCalled();

    act(() => screen?.unmount());
  });

  it('renews the viewed session and clears it on blur or background', () => {
    let screen: ReactTestRenderer.ReactTestRenderer | undefined;
    act(() => {
      screen = ReactTestRenderer.create(<Probe />);
    });
    act(() => {
      useControlCenterStore.setState({ currentlyViewedSessionId: 'session-a' });
    });
    const watching = { type: 'presence.alive', viewed_session_id: 'session-a' };
    expect(sendMock).toHaveBeenLastCalledWith(watching);
    act(() => jest.advanceTimersByTime(60_000));
    expect(sendMock).toHaveBeenLastCalledWith(watching);

    act(() => useControlCenterStore.setState({ wsConnected: false }));
    sendMock.mockClear();
    act(() => useControlCenterStore.setState({ wsConnected: true }));
    expect(sendMock).toHaveBeenLastCalledWith(watching);

    act(() => {
      useControlCenterStore.setState({ currentlyViewedSessionId: undefined });
    });
    expect(sendMock).toHaveBeenLastCalledWith({ type: 'presence.alive', viewed_session_id: null });
    act(() => useControlCenterStore.setState({ currentlyViewedSessionId: 'session-a' }));
    act(() => emitAppState('background'));
    expect(sendMock).toHaveBeenLastCalledWith({ type: 'presence.alive', viewed_session_id: null });
    sendMock.mockClear();
    act(() => jest.advanceTimersByTime(60_000));
    expect(sendMock).not.toHaveBeenCalled();

    act(() => emitAppState('active'));
    expect(sendMock).toHaveBeenLastCalledWith(watching);
    act(() => screen?.unmount());
  });

  it('does not refresh the server snapshot on initial foreground mount', () => {
    let screen: ReactTestRenderer.ReactTestRenderer | undefined;
    act(() => {
      screen = ReactTestRenderer.create(<Probe />);
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(refreshFromServerMock).not.toHaveBeenCalled();

    act(() => {
      screen?.unmount();
    });
  });

  it('does not send a heartbeat on mount when the app starts backgrounded', () => {
    setCurrentAppState('background');
    let screen: ReactTestRenderer.ReactTestRenderer | undefined;
    act(() => {
      screen = ReactTestRenderer.create(<Probe />);
    });

    act(() => {
      jest.advanceTimersByTime(180_000);
    });
    expect(sendMock).not.toHaveBeenCalled();

    act(() => {
      emitAppState('active');
    });
    expect(sendMock).toHaveBeenCalledTimes(1);

    act(() => {
      screen?.unmount();
    });
  });

  it('clears its interval on unmount so no heartbeats leak', () => {
    let screen: ReactTestRenderer.ReactTestRenderer | undefined;
    act(() => {
      screen = ReactTestRenderer.create(<Probe />);
    });
    expect(sendMock).toHaveBeenCalledTimes(1);

    // Unmount in its own act so the passive effect cleanup (clearInterval) is
    // flushed before we advance fake time.
    act(() => {
      screen?.unmount();
    });
    act(() => {
      jest.advanceTimersByTime(180_000);
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});
