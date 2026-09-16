/**
 * Regression test for the shared feed-impression observer (spec 1065 FR-014).
 *
 * The bug: `teardownIfIdle()` disconnects the IntersectionObserver and clears the
 * settle timer once the last row unmounts, but deliberately KEEPS the tracker (it
 * remembers what this session already reported). `ensure()` then returned early on
 * `if (tracker)`, so the observer and timer were never rebuilt — after the feed
 * emptied once, every later mount observed nothing and the Wall silently stopped
 * reporting views for the rest of the session.
 *
 * Emptying the feed takes no effort at all: WallPage has a search box, and a query
 * that matches no posts renders zero rows.
 *
 * The directive owns real globals (window, IntersectionObserver, setInterval), so
 * this drives it through fakes rather than a DOM: what matters is that a remount
 * after a teardown is actually OBSERVED and still reaches recordPostView.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ObjectDirective } from 'vue';

const recordPostView = vi.fn();
vi.mock('@/db/queries', () => ({ recordPostView: (id: string) => recordPostView(id) }));

/** Minimal IntersectionObserver stand-in that records what it is watching and lets
 *  a test hand entries back to the directive's callback. */
class FakeIO {
  static live: FakeIO[] = [];
  observed = new Set<Element>();
  disconnected = false;
  constructor(private cb: (entries: { target: Element; intersectionRatio: number }[]) => void) {
    FakeIO.live.push(this);
  }
  observe(el: Element): void {
    this.observed.add(el);
  }
  unobserve(el: Element): void {
    this.observed.delete(el);
  }
  disconnect(): void {
    this.disconnected = true;
    this.observed.clear();
  }
  /** Report every observed element as fully on screen. */
  fireAllVisible(): void {
    this.cb([...this.observed].map((target) => ({ target, intersectionRatio: 1 })));
  }
}

const el = (): Element => ({}) as Element;
const binding = (value: string) => ({ value }) as never;

/** A fresh module instance per test — the directive's observer/timer/tracker are
 *  module-scoped singletons, so state must not leak between cases. */
type SeenDirective = ObjectDirective<HTMLElement, string | undefined>;

async function loadDirective(): Promise<SeenDirective> {
  vi.resetModules();
  FakeIO.live = [];
  recordPostView.mockClear();
  // Exported as the broader `Directive` union (which also allows the shorthand
  // function form); this file only ever ships the object form.
  return (await import('./seen-in-feed')).vSeenInFeed as SeenDirective;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IntersectionObserver', FakeIO);
  vi.stubGlobal('window', { IntersectionObserver: FakeIO });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Mount a row, let it rest on screen past the dwell, and unmount it. */
function viewThenLeave(d: SeenDirective, target: Element, postId: string) {
  d.mounted?.(target as never, binding(postId), null as never, null as never);
  FakeIO.live.at(-1)!.fireAllVisible();
  vi.advanceTimersByTime(5000); // comfortably past the dwell + settle ticks
  d.unmounted?.(target as never, binding(postId), null as never, null as never);
}

describe('v-seen-in-feed', () => {
  it('reports a post that rests on screen', async () => {
    const d = await loadDirective();
    viewThenLeave(d, el(), 'post-1');
    expect(recordPostView).toHaveBeenCalledWith('post-1');
  });

  it('still reports after the feed empties and repopulates (search with no matches)', async () => {
    const d = await loadDirective();

    // First pass: a post is seen, then the feed empties — which tears the shared
    // observer down, because els.size hits zero.
    viewThenLeave(d, el(), 'post-1');
    expect(FakeIO.live.at(-1)!.disconnected).toBe(true);
    recordPostView.mockClear();

    // Clearing the search re-renders the feed. This is where the bug bit: the
    // observer was never rebuilt, so nothing was ever observed again.
    const back = el();
    d.mounted?.(back as never, binding('post-2'), null as never, null as never);
    const io = FakeIO.live.at(-1)!;
    expect(io.disconnected).toBe(false);
    expect(io.observed.has(back)).toBe(true);

    io.fireAllVisible();
    vi.advanceTimersByTime(5000);
    expect(recordPostView).toHaveBeenCalledWith('post-2');
  });

  it('keeps the once-per-post memory across that teardown, so returning re-reports nothing', async () => {
    const d = await loadDirective();
    viewThenLeave(d, el(), 'post-1');
    expect(recordPostView).toHaveBeenCalledTimes(1);
    recordPostView.mockClear();

    // The tracker surviving teardown is the whole reason ensure() returned early on
    // it; rebuilding the observer must not cost us that memory.
    viewThenLeave(d, el(), 'post-1');
    expect(recordPostView).not.toHaveBeenCalled();
  });
});
