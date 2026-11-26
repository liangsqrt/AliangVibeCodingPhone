import type { StateCreator } from 'zustand';
import { fetchOperations, isActiveOperation, parseOperation, type Operation } from '../../api/operations';
import type { ControlCenterState } from '../types';

const recentMs = 7 * 86_400_000;

export function mergeOperations(current: Operation[], incoming: unknown[]): Operation[] {
  const rows = new Map(current.map(operation => [operation.operation_id, operation]));
  for (const raw of incoming) {
    const next = parseOperation(raw);
    if (!next) continue;
    const previous = rows.get(next.operation_id);
    if (previous && (previous.revision >= next.revision ||
        (!isActiveOperation(previous) && isActiveOperation(next)))) continue;
    rows.set(next.operation_id, next);
  }
  const cutoff = Date.now() - recentMs;
  return [...rows.values()]
    .filter(row => isActiveOperation(row) || Date.parse(row.updated_at) >= cutoff)
    .sort((a, b) => Number(isActiveOperation(b)) - Number(isActiveOperation(a)) ||
      b.updated_at.localeCompare(a.updated_at))
    .slice(0, 400);
}

type OperationsSlice = Pick<ControlCenterState,
  'operations' | 'refreshOperations' | 'applyOperationEvent' | 'clearOperations' | 'operationsUnavailable'>;

export const createOperationsSlice: StateCreator<ControlCenterState, [], [], OperationsSlice> =
  (set) => {
    let generation = 0;
    let request: Promise<void> | undefined;
    return {
      operations: [],
      operationsUnavailable: false,
      refreshOperations: () => {
        if (request) return request;
        const captured = generation;
        request = fetchOperations().then(({ operations }) => {
          if (captured !== generation || !Array.isArray(operations)) return;
          set(state => ({ operations: mergeOperations(state.operations, operations), operationsUnavailable: false }));
        }).catch(() => {
          if (captured === generation) set({ operationsUnavailable: true });
        }).finally(() => {
          if (captured === generation) request = undefined;
        });
        return request;
      },
      applyOperationEvent: operation => set(state => ({
        operations: mergeOperations(state.operations, [operation]), operationsUnavailable: false,
      })),
      clearOperations: () => {
        generation++;
        request = undefined;
        set({ operations: [], operationsUnavailable: false });
      },
    };
  };
