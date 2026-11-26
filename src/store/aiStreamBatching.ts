import type { PlatformTransportEvent } from '../services/platformTransport';

export const AI_STREAM_TRANSPORT_TYPES = new Set([
  'ai.delta',
  'ai.command',
  'ai.file_change',
  'ai.thinking',
  'ai.usage',
  'ai.task',
  'ai.subagent',
]);

export type AiStreamTransportEvent = Extract<
  PlatformTransportEvent,
  {
    type:
      | 'ai.delta'
      | 'ai.command'
      | 'ai.file_change'
      | 'ai.thinking'
      | 'ai.usage'
      | 'ai.task'
      | 'ai.subagent';
  }
>;

const AI_STREAM_FLUSH_MS = 100;

let pendingEvents: AiStreamTransportEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let applyEvents: ((events: AiStreamTransportEvent[]) => void) | null = null;
const firstTextSeenBySession = new Map<string, number>();
const FIRST_TEXT_TRACK_LIMIT = 1000;

export function markAiStreamRunStarted(sessionId: string, _runId?: string): void {
  firstTextSeenBySession.delete(sessionId);
}

export function markAiStreamRunFinished(sessionId: string): void {
  firstTextSeenBySession.delete(sessionId);
}

function isFirstText(event: AiStreamTransportEvent): boolean {
  return event.type === 'ai.delta' &&
    event.delta.trim() !== '' &&
    (event.raw.channel === undefined ||
      event.raw.channel === 'assistant' ||
      event.raw.channel === 'stdout');
}

function shouldFlushFirstText(event: AiStreamTransportEvent): boolean {
  if (!isFirstText(event)) return false;
  if (firstTextSeenBySession.has(event.sessionId)) return false;
  if (firstTextSeenBySession.size >= FIRST_TEXT_TRACK_LIMIT) {
    const oldest = firstTextSeenBySession.keys().next().value;
    if (oldest !== undefined) firstTextSeenBySession.delete(oldest);
  }
  firstTextSeenBySession.set(event.sessionId, Date.now());
  return true;
}

export const isAiStreamTransportEvent = (
  event: PlatformTransportEvent,
): event is AiStreamTransportEvent => AI_STREAM_TRANSPORT_TYPES.has(event.type);

export function registerAiStreamApplier(
  apply: (events: AiStreamTransportEvent[]) => void,
): void {
  applyEvents = apply;
}

export function cancelAiStreamBatch(): void {
  pendingEvents = [];
  firstTextSeenBySession.clear();
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

export function flushAiStreamEvents(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!pendingEvents.length || !applyEvents) return;
  const events = pendingEvents;
  pendingEvents = [];
  applyEvents(events);
}

export function pushAiStreamEvent(event: AiStreamTransportEvent): void {
  pendingEvents.push(event);
  if (shouldFlushFirstText(event)) {
    flushAiStreamEvents();
    return;
  }
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (!pendingEvents.length || !applyEvents) return;
    const events = pendingEvents;
    pendingEvents = [];
    applyEvents(events);
  }, AI_STREAM_FLUSH_MS);
}
