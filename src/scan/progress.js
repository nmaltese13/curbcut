/**
 * In-process progress bus for running scans.
 *
 * Events are buffered per scan so a browser that connects late — or reloads
 * mid-scan — replays everything it missed rather than showing a blank log. The
 * buffer is capped and dropped shortly after the scan ends, so this stays a
 * transient view over work in flight; the durable record is the database.
 *
 * Single-process by design. Moving scans to a worker pool means replacing this
 * with Redis pub/sub, and nothing else changes: the SSE route only talks to
 * subscribe() and history().
 */

const MAX_BUFFERED = 400;
const RETAIN_AFTER_END_MS = 60_000;

const channels = new Map();

function channel(scanId) {
  if (!channels.has(scanId)) {
    channels.set(scanId, { events: [], listeners: new Set(), ended: false, seq: 0 });
  }
  return channels.get(scanId);
}

export function emit(scanId, event) {
  if (!scanId) return;
  const entry = channel(scanId);
  entry.seq += 1;

  const record = { ...event, seq: entry.seq, at: new Date().toISOString() };
  entry.events.push(record);
  // Keep the tail: recent activity is what a viewer wants to see.
  if (entry.events.length > MAX_BUFFERED) entry.events.splice(0, entry.events.length - MAX_BUFFERED);

  for (const listener of entry.listeners) {
    try {
      listener(record);
    } catch {
      /* A failing listener must never interrupt a scan. */
    }
  }
}

/** Mark the scan finished and schedule cleanup. */
export function end(scanId, summary = {}) {
  const entry = channel(scanId);
  emit(scanId, { type: 'end', ...summary });
  entry.ended = true;

  setTimeout(() => channels.delete(scanId), RETAIN_AFTER_END_MS).unref?.();
}

export function history(scanId) {
  return channels.get(scanId)?.events || [];
}

export function hasEnded(scanId) {
  const entry = channels.get(scanId);
  return entry ? entry.ended : true;
}

export function isTracked(scanId) {
  return channels.has(scanId);
}

/** Subscribe to live events. Returns an unsubscribe function. */
export function subscribe(scanId, listener) {
  const entry = channel(scanId);
  entry.listeners.add(listener);
  return () => entry.listeners.delete(listener);
}

/**
 * A compact progress snapshot for the no-JavaScript fallback and for the
 * initial server render.
 */
export function snapshot(scanId) {
  const events = history(scanId);
  const state = {
    phase: 'starting',
    pagesDone: 0,
    pagesPlanned: 0,
    currentUrl: null,
    findings: { total: 0, definite: 0, review: 0, advisory: 0 },
    discovered: 0,
    ended: hasEnded(scanId),
    log: [],
  };

  for (const event of events) {
    switch (event.type) {
      case 'phase': state.phase = event.phase; break;
      case 'plan': state.pagesPlanned = event.pages; break;
      case 'fetch': state.currentUrl = event.url; break;
      case 'discovered': state.discovered += event.count; break;
      case 'page':
        state.pagesDone = event.index;
        state.findings.total += event.findings || 0;
        state.findings.definite += event.definite || 0;
        state.findings.review += event.review || 0;
        state.findings.advisory += event.advisory || 0;
        break;
      case 'end': state.ended = true; state.phase = 'complete'; break;
      default: break;
    }
  }

  state.log = events.slice(-60);
  return state;
}

export default { emit, end, history, subscribe, snapshot, hasEnded, isTracked };
