import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Operation } from '../../../api/operations';
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
