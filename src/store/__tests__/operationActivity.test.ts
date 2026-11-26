import { mergeOperations } from '../slices/operationsSlice';
import type { Operation } from '../../api/operations';

const task: Operation = {
  operation_id: 'op_a', title: 'Build', source_kind: 'ai_progress',
  updated_at: '2026-11-25T10:00:00.000Z', phase: 'running', revision: 2,
};

test('a stale snapshot cannot overwrite a newer realtime event', () => {
  expect(mergeOperations([task], [{ ...task, title: 'Old', revision: 1 }])).toEqual([task]);
});

test('a terminal task stays closed when a late running update arrives', () => {
  const completed: Operation = { ...task, phase: 'completed' };
  expect(mergeOperations([completed], [{ ...task, revision: 3 }])).toEqual([completed]);
});
