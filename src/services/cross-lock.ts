/**
 * Cross-context named locks for the inbound message path (spec 1032).
 *
 * The page and the service worker share one IndexedDB but are separate JS
 * contexts, so in-context mutexes (KeyedMutex, useSync's inboundChain) cannot
 * stop a page seal and an SW open from interleaving a load→advance→save on the
 * same Double Ratchet session. The Web Locks API is the platform primitive that
 * does span contexts: origin-scoped, exclusive, and — decisively — auto-released
 * when the holding context dies, so a killed SW can never deadlock the page.
 *
 * Two lock names, strict outer→inner ordering (never inverted):
 *   - 'ring:inbound'            — one frame's check-ledger → decrypt → commit →
 *                                 ack section (page receiveIncoming / SW drain).
 *   - 'ring:session:<chatId>'   — every ratchet load→advance→save (seal, open,
 *                                 preview), in both contexts.
 * Nothing inside a session lock may acquire any other lock, and only the
 * outermost inbound layer takes 'ring:inbound'. Web Locks are NOT reentrant:
 * nesting the same name in one async chain deadlocks, which is why
 * openPacketStaged (messaging.ts) takes no locks and documents that its caller
 * must hold the session lock across decrypt AND commit.
 *
 * Each helper composes the in-context KeyedMutex (FIFO fairness within a
 * context, and the entire serialization story where Web Locks are absent) with
 * navigator.locks (the cross-context guarantee). SW callers pass a timeout: a
 * frozen-but-alive iOS page can hold a lock indefinitely while unable to run,
 * and the SW must degrade to the preview-only path rather than blow its
 * waitUntil budget waiting. Page callers wait without a timeout (they can).
 */
import { KeyedMutex } from './keyed-mutex';

/** Thrown when a lock isn't granted within the caller's timeout. SW callers
 *  catch this and degrade the frame/wake to today's preview-only behavior. */
export class LockTimeoutError extends Error {
  constructor(name: string, timeoutMs: number) {
    super(`lock ${name} not granted within ${timeoutMs}ms`);
    this.name = 'LockTimeoutError';
  }
}

export interface LockOptions {
  /** Abort the acquisition (NOT the running section) after this many ms. */
  timeoutMs?: number;
}

// Minimal structural type for navigator.locks so this module typechecks in both
// the DOM and the service-worker lib without lib-juggling.
interface LocksApi {
  request<T>(
    name: string,
    opts: { mode: 'exclusive'; signal?: AbortSignal },
    cb: () => T | Promise<T>,
  ): Promise<T>;
}

function locksApi(): LocksApi | undefined {
  const nav = (globalThis as { navigator?: { locks?: LocksApi } }).navigator;
  return nav?.locks && typeof nav.locks.request === 'function' ? nav.locks : undefined;
}

/** Whether the cross-context Web Locks API exists here. When false, the helpers
 *  still serialize within this context (KeyedMutex) — today's shipped behavior —
 *  and the SW drain gate keeps the full-persist feature off. */
export function locksAvailable(): boolean {
  return !!locksApi();
}

// In-context FIFO per lock name. Also what guarantees fairness under Web Locks:
// the browser doesn't promise request order across queued same-context calls,
// the mutex hands them to navigator.locks one at a time, in arrival order.
const localMutex = new KeyedMutex();

async function withNamedLock<T>(name: string, fn: () => Promise<T>, opts?: LockOptions): Promise<T> {
  return localMutex.run(name, async () => {
    const locks = locksApi();
    if (!locks) return fn(); // no cross-context primitive → in-context serialization only
    if (opts?.timeoutMs == null) {
      return locks.request(name, { mode: 'exclusive' }, fn);
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
    try {
      return await locks.request(name, { mode: 'exclusive', signal: ctrl.signal }, fn);
    } catch (e) {
      // Only the acquisition can abort (the signal is ignored once granted), so an
      // abort here always means "timed out waiting", never "interrupted mid-section".
      if (ctrl.signal.aborted) throw new LockTimeoutError(name, opts.timeoutMs);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  });
}

export const INBOUND_LOCK = 'ring:inbound';

/** Serialize one inbound frame's apply-and-ack critical section across contexts.
 *  Outermost lock only — the section may take session locks, never the reverse. */
export function withInboundLock<T>(fn: () => Promise<T>, opts?: LockOptions): Promise<T> {
  return withNamedLock(INBOUND_LOCK, fn, opts);
}

export function sessionLockName(chatId: string): string {
  return `ring:session:${chatId}`;
}

/** Serialize a chat's ratchet load→advance→save across contexts. Every seal,
 *  open, and preview goes through here (messaging.ts); the SW drain holds it
 *  across decrypt AND the atomic commit of the advanced session. */
export function withSessionLock<T>(chatId: string, fn: () => Promise<T>, opts?: LockOptions): Promise<T> {
  return withNamedLock(sessionLockName(chatId), fn, opts);
}
