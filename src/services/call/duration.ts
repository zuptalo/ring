/**
 * Active-time accounting for a call that can be paused (call-waiting hold, spec 0005).
 *
 * A call banks the seconds it was active before each hold, so its reported duration is TALK time
 * (held time excluded) and two concurrent calls each report their own duration instead of a shared
 * wall-clock. Pure functions with an injected `now` so they're unit-testable without timers.
 */

export interface ActiveClock {
  startedAt?: number; // ms epoch; start of the CURRENT active stint, cleared while held
  activeSec?: number; // active seconds banked from earlier stints
}

/** Talk time so far: banked stints + the current (running) stint. */
export function activeDurationSec(c: ActiveClock | null | undefined, now: number): number {
  if (!c) return 0;
  const current = c.startedAt ? Math.floor((now - c.startedAt) / 1000) : 0;
  return (c.activeSec ?? 0) + current;
}

/** Bank the current stint and stop the clock — called when the call goes on hold. Idempotent
 *  if already banked (no running stint). */
export function bankActive(c: ActiveClock, now: number): void {
  if (!c.startedAt) return;
  c.activeSec = (c.activeSec ?? 0) + Math.floor((now - c.startedAt) / 1000);
  c.startedAt = undefined;
}

/** (Re)start the clock — called when the call becomes active (initial connect or resume). */
export function startActive(c: ActiveClock, now: number): void {
  c.startedAt = now;
}
