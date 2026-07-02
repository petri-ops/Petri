// ============================================================
// Copilot trace ring buffer — per-session debug log.
// Captures every tool call / tool result / page change / ack.
// User can copy the trace to share with the developer.
// ============================================================

export interface TraceEntry {
  ts: number;
  kind: 'tool_call' | 'tool_result' | 'page' | 'ack' | 'user_msg' | 'ai_msg' | 'event' | 'error';
  /** Short label, e.g. "act(navigate)" */
  label: string;
  /** Optional payload preview */
  detail?: string;
}

const MAX_ENTRIES = 200;
const buffer: TraceEntry[] = [];
const listeners = new Set<(entries: TraceEntry[]) => void>();

export function addTrace(entry: Omit<TraceEntry, 'ts'>): void {
  const full: TraceEntry = { ts: Date.now(), ...entry };
  buffer.push(full);
  if (buffer.length > MAX_ENTRIES) buffer.shift();
  listeners.forEach((l) => l([...buffer]));
}

export function getTrace(): TraceEntry[] {
  return [...buffer];
}

export function clearTrace(): void {
  buffer.length = 0;
  listeners.forEach((l) => l([]));
}

export function subscribeTrace(cb: (entries: TraceEntry[]) => void): () => void {
  listeners.add(cb);
  cb([...buffer]);
  return () => {
    listeners.delete(cb);
  };
}

export function formatTraceForCopy(entries: TraceEntry[] = buffer): string {
  return entries
    .map((e) => {
      const t = new Date(e.ts).toLocaleTimeString();
      const detail = e.detail ? ' — ' + e.detail.slice(0, 200) : '';
      return `[${t}] ${e.kind}: ${e.label}${detail}`;
    })
    .join('\n');
}
