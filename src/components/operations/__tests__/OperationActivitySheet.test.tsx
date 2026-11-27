import React from 'react';
import { AppState, Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { operationElapsedLabel, type Operation } from '../../../api/operations';
import { OperationActivitySheet } from '../OperationActivitySheet';

const mockRefreshOperations = jest.fn();
const operation: Operation = {
  operation_id: 'op-measured',
  source_kind: 'agent_task',
  session_id: 's1',
  title: 'Measured build',
  phase: 'running',
  progress: { current: 3, total: 8, unit: 'files' },
  revision: 2,
  updated_at: '2026-11-26T00:00:00.000Z',
};
const mockStore = {
  operations: [
    operation,
    { ...operation, operation_id: 'op-unknown', title: 'Waiting for a test runner', progress: undefined },
    { ...operation, operation_id: 'op-other', session_id: 's2', title: 'Another session', progress: undefined },
  ],
  devices: [],
  wsConnected: true,
  operationsUnavailable: false,
  refreshOperations: mockRefreshOperations,
};

jest.mock('../../../store/controlCenterStore', () => ({
  useControlCenterStore: (selector: (state: typeof mockStore) => unknown) => selector(mockStore),
}));

function labels(node: TestRenderer.ReactTestInstance) {
  return node.findAllByType(Text).map(text => React.Children.toArray(text.props.children).join(''));
}

function pressButton(renderer: TestRenderer.ReactTestRenderer, label: string) {
  const button = renderer.root.findAll(node =>
    node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function' &&
    labels(node).includes(label),
  )[0];
  expect(button).toBeDefined();
  act(() => button.props.onPress());
}

test('shows measured progress, scopes the list to the current session, and opens its detail', () => {
  let renderer!: TestRenderer.ReactTestRenderer;
  const onOpenSession = jest.fn();
  act(() => {
    renderer = TestRenderer.create(
      <SafeAreaProvider initialMetrics={{
        frame: { x: 0, y: 0, width: 320, height: 640 },
        insets: { top: 0, bottom: 0, left: 0, right: 0 },
      }}>
        <OperationActivitySheet open onClose={jest.fn()} sessionId="s1" onOpenSession={onOpenSession} />
      </SafeAreaProvider>,
    );
  });
  expect(mockRefreshOperations).toHaveBeenCalledTimes(1);
  expect(labels(renderer.root)).toEqual(expect.arrayContaining(['Measured build', '38%', 'Waiting for a test runner']));
  expect(labels(renderer.root)).not.toContain('Another session');
  expect(labels(renderer.root).filter(label => label.includes('%'))).toEqual(['38%']);

  pressButton(renderer, 'Measured build');
  expect(labels(renderer.root)).toContain('3 / 8');
  pressButton(renderer, '打开会话');
  expect(onOpenSession).toHaveBeenCalledWith('s1');
  act(() => renderer.unmount());
});

test('displays elapsed time for unmeasured work and freezes it at completion', () => {
  jest.useFakeTimers({ now: new Date('2026-11-26T00:00:05Z') });
  const previousOperations = mockStore.operations;
  const previousAppState = AppState.currentState;
  AppState.currentState = 'active';
  const active: Operation = {
    ...operation, kind: 'shell', source_kind: 'ai_progress',
    progress: undefined, started_at: operation.updated_at,
  };
  mockStore.operations = [active];
  const sheet = (open: boolean) => (
    <SafeAreaProvider initialMetrics={{
      frame: { x: 0, y: 0, width: 320, height: 640 },
      insets: { top: 0, bottom: 0, left: 0, right: 0 },
    }}>
      <OperationActivitySheet open={open} onClose={jest.fn()} sessionId="s1" onOpenSession={jest.fn()} />
    </SafeAreaProvider>
  );
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  try {
    act(() => { renderer = TestRenderer.create(sheet(true)); });
    expect(labels(renderer!.root)).toContain('已用时 00:05');
    pressButton(renderer!, 'Measured build');
    expect(labels(renderer!.root)).toContain('会话中的停止按钮会结束整个回合。');
    act(() => { jest.advanceTimersByTime(2000); });
    expect(labels(renderer!.root)).toContain('已用时 00:07');

    mockStore.operations = [{ ...active, phase: 'completed', finished_at: '2026-11-26T00:00:06Z' }];
    act(() => renderer!.update(sheet(true)));
    act(() => { jest.advanceTimersByTime(2000); });
    expect(labels(renderer!.root)).toContain('已用时 00:06');
    expect(labels(renderer!.root)).not.toContain('会话中的停止按钮会结束整个回合。');
  } finally {
    if (renderer) act(() => renderer!.unmount());
    mockStore.operations = previousOperations;
    AppState.currentState = previousAppState;
    jest.useRealTimers();
  }
});

test('shows raw counters for incremental progress without faking a percent', () => {
  const previousOperations = mockStore.operations;
  mockStore.operations = [
    { ...operation, operation_id: 'op-count', title: 'Shell output', kind: 'shell',
      progress: { current: 321, unit: 'bytes' } },
    { ...operation, operation_id: 'op-total', title: 'Measured build' },
  ];
  let renderer!: TestRenderer.ReactTestRenderer;
  try {
    act(() => {
      renderer = TestRenderer.create(
        <SafeAreaProvider initialMetrics={{
          frame: { x: 0, y: 0, width: 320, height: 640 },
          insets: { top: 0, bottom: 0, left: 0, right: 0 },
        }}>
          <OperationActivitySheet open onClose={jest.fn()} onOpenSession={jest.fn()} />
        </SafeAreaProvider>,
      );
    });
    expect(labels(renderer.root)).toContain('321 B');
    expect(labels(renderer.root).filter(label => label.includes('%'))).toEqual(['38%']);
  } finally {
    mockStore.operations = previousOperations;
    if (renderer) act(() => renderer.unmount());
  }
});

test('omits elapsed time for queued work and incomplete timestamps', () => {
  const now = Date.parse('2026-11-26T01:02:03Z');
  const running = { ...operation, started_at: operation.updated_at };
  expect(operationElapsedLabel(running, now)).toBe('1:02:03');
  expect(operationElapsedLabel({ ...running, phase: 'queued' }, now)).toBeUndefined();
  expect(operationElapsedLabel({ ...running, started_at: '' }, now)).toBeUndefined();
  expect(operationElapsedLabel({ ...running, phase: 'failed' }, now)).toBeUndefined();
});
