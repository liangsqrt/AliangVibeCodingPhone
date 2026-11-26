import { apiGet } from './client';

const phases = ['queued', 'running', 'waiting', 'completed', 'failed', 'cancelled', 'interrupted'] as const;
export type OperationPhase = typeof phases[number];

export interface Operation {
  operation_id: string;
  source_kind: string;
  source_device_id?: string;
  source_device_name?: string;
  source_device_online?: boolean;
  session_id?: string;
  project_id?: string;
  parent_operation_id?: string;
  title: string;
  kind?: string;
  phase: OperationPhase;
  stage?: string;
  step?: string;
  message?: string;
  error_code?: string;
  progress?: { current: number; total?: number; unit?: string };
  started_at?: string;
  rate?: number;
  eta_seconds?: number;
  transitions?: { phase: OperationPhase; stage?: string; at: string }[];
  updated_at: string;
  finished_at?: string;
  revision: number;
}

export const isActiveOperation = (operation: Operation) =>
  operation.phase === 'queued' || operation.phase === 'running' || operation.phase === 'waiting';

export function parseOperation(raw: unknown): Operation | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
  const op = raw as Operation;
  if (typeof op.operation_id !== 'string' || !op.operation_id ||
      typeof op.source_kind !== 'string' || typeof op.title !== 'string' ||
      !phases.includes(op.phase) || !Number.isSafeInteger(op.revision) || op.revision <= 0 ||
      typeof op.updated_at !== 'string' || !Number.isFinite(Date.parse(op.updated_at))) return;
  return {
    ...op,
    progress: op.progress && Number.isFinite(op.progress.current) && op.progress.current >= 0
      ? op.progress : undefined,
  };
}

export function operationPercent(operation: Operation): number | undefined {
  const value = operation.progress;
  if (!value?.total || !Number.isFinite(value.total) || value.total < 0) return;
  return Math.round(Math.max(0, Math.min(100, 100 * value.current / value.total)));
}

export function operationElapsedLabel(operation: Operation, now: number): string | undefined {
  if (operation.phase === 'queued' || typeof operation.started_at !== 'string') return;
  const start = Date.parse(operation.started_at);
  const end = isActiveOperation(operation)
    ? now
    : typeof operation.finished_at === 'string' ? Date.parse(operation.finished_at) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return;

  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = String(Math.floor(seconds / 60) % 60).padStart(2, '0');
  const remainder = String(seconds % 60).padStart(2, '0');
  return hours ? `${hours}:${minutes}:${remainder}` : `${minutes}:${remainder}`;
}

export const fetchOperations = () => apiGet<{ operations: unknown[] }>('/api/operations/snapshot');
