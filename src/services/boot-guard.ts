/**
 * Boot-loop safe mode (spec 2039).
 *
 * If the app crashes repeatedly right after launch (an OOM in background work,
 * a broken cached build, …), the device can end up unable to even RECEIVE the
 * fixed build: the update toast dies with every crash. This guard is the
 * self-rescue path, deliberately independent of whatever feature is crashing:
 *
 *   - every boot increments a persisted counter (localStorage: it survives the
 *     full app relaunches a crash loop produces, unlike sessionStorage);
 *   - a boot that stays alive HEALTHY_UPTIME_MS clears the counter;
 *   - reaching MAX_CRASHY_BOOTS without a healthy boot puts the NEXT boot into
 *     safe mode: deferrable background work (pending-post drain, media resume)
 *     is paused for that boot, and a WAITING app update is applied immediately
 *     without asking — escaping a broken build is exactly what the mode is for.
 *
 * Safe mode is one boot's shield, not a latch: surviving the healthy-uptime
 * window clears the counter and the next boot is normal.
 */

const KEY = 'ring.bootAttempts';
const HEALTHY_UPTIME_MS = 20_000;
export const MAX_CRASHY_BOOTS = 3;

let safeMode = false;

/** Pure rule, unit-tested: does this boot enter safe mode? */
export function isCrashLoop(attempts: number): boolean {
  return attempts >= MAX_CRASHY_BOOTS;
}

function readAttempts(): number {
  try {
    const n = Number(localStorage.getItem(KEY) ?? '0');
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0; // storage unavailable → never trip the guard
  }
}

/** Call ONCE, as early in boot as possible. Returns whether this boot runs in
 *  safe mode. Arms the healthy-uptime timer that clears the counter. */
export function initBootGuard(): boolean {
  const attempts = readAttempts();
  safeMode = isCrashLoop(attempts);
  try {
    localStorage.setItem(KEY, String(attempts + 1));
  } catch {
    /* storage unavailable — guard stays inert */
  }
  setTimeout(() => {
    try {
      localStorage.setItem(KEY, '0');
    } catch {
      /* ignore */
    }
  }, HEALTHY_UPTIME_MS);
  return safeMode;
}

/** Is the CURRENT boot in safe mode? Deferrable background starters consult
 *  this (pending-post drain, media resumes) and skip for the boot. */
export function inSafeMode(): boolean {
  return safeMode;
}

/** Test-only. */
export function __setSafeModeForTest(v: boolean): void {
  safeMode = v;
}
