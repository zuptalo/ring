// Pure recorder-clock accounting, shared shape with the voice recorder's `recActiveMs`.
//
// A recording can be paused and resumed; the elapsed/sent duration must reflect only the
// RECORDED time, never the wall-clock gap spent paused. We track `accumMs` (time banked
// from completed segments) and `segStartMs` (when the current live segment began). While
// recording, the live segment `now - segStartMs` is added on top; while paused, only the
// banked time counts. This is a pure function (no Date/Math/DOM) so it is fully
// unit-testable — the recorder passes `Date.now()` as `nowMs`.

export interface RecClock {
  /** Recorded milliseconds banked from segments completed before the current one. */
  accumMs: number;
  /** Timestamp (ms) when the current recording segment started. */
  segStartMs: number;
  /** Whether the recording is currently paused (the live segment is not counted). */
  paused: boolean;
}

/** Total recorded milliseconds: banked time plus the current live segment when recording. */
export function recordedMs(c: RecClock, nowMs: number): number {
  return c.accumMs + (c.paused ? 0 : nowMs - c.segStartMs);
}
