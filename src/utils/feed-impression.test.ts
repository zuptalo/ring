import { describe, it, expect } from 'vitest';
import {
  IMPRESSION_RATIO,
  IMPRESSION_DWELL_MS,
  ImpressionTracker,
  mayReportView,
} from './feed-impression';

describe('view reporting gate (spec 1065 FR-013/FR-015/FR-017b)', () => {
  const base = { outgoing: false, seenReceiptsOn: true, alreadyReported: false };

  it('reports an ordinary first sighting', () => {
    expect(mayReportView(base)).toBe(true);
  });

  it('never reports your own post, so an author is absent from their own list', () => {
    expect(mayReportView({ ...base, outgoing: true })).toBe(false);
  });

  it('reports NOTHING when seen receipts are off, including from the feed', () => {
    // This is the reciprocity gate. It is client-side on both sides and the
    // server knows nothing about it, so if the feed path ever bypassed this,
    // someone who opted out would be silently reported to every author.
    expect(mayReportView({ ...base, seenReceiptsOn: false })).toBe(false);
    expect(mayReportView({ outgoing: false, seenReceiptsOn: false, alreadyReported: false })).toBe(false);
  });

  it('reports a post at most once, so re-scrolling an old feed costs nothing', () => {
    expect(mayReportView({ ...base, alreadyReported: true })).toBe(false);
  });
});

describe('feed impression rule (spec 1065 FR-014)', () => {
  it('counts a post that is half visible for a full second', () => {
    const seen: string[] = [];
    const t = new ImpressionTracker((id) => seen.push(id));

    t.observe('p1', IMPRESSION_RATIO, 0);
    expect(seen).toEqual([]); // the dwell has not elapsed yet
    t.tick(IMPRESSION_DWELL_MS);
    expect(seen).toEqual(['p1']);
  });

  it('does not count a post that scrolls past before the dwell elapses', () => {
    const seen: string[] = [];
    const t = new ImpressionTracker((id) => seen.push(id));

    t.observe('p1', 0.9, 0);
    t.tick(IMPRESSION_DWELL_MS - 1);
    t.observe('p1', 0, IMPRESSION_DWELL_MS - 1); // scrolled away
    t.tick(IMPRESSION_DWELL_MS * 3);
    expect(seen).toEqual([]);
  });

  it('does not count a post that never crosses the visibility threshold', () => {
    const seen: string[] = [];
    const t = new ImpressionTracker((id) => seen.push(id));

    t.observe('p1', IMPRESSION_RATIO - 0.01, 0);
    t.tick(IMPRESSION_DWELL_MS * 5);
    expect(seen).toEqual([]);
  });

  it('restarts the dwell when a post leaves and comes back', () => {
    const seen: string[] = [];
    const t = new ImpressionTracker((id) => seen.push(id));

    t.observe('p1', 1, 0);
    t.tick(IMPRESSION_DWELL_MS - 100);
    t.observe('p1', 0, IMPRESSION_DWELL_MS - 100);
    t.observe('p1', 1, IMPRESSION_DWELL_MS); // back on screen, clock resets
    t.tick(IMPRESSION_DWELL_MS + 50);
    expect(seen).toEqual([]); // only 50ms of the new dwell has passed
    t.tick(IMPRESSION_DWELL_MS * 2);
    expect(seen).toEqual(['p1']);
  });

  it('reports each post at most once, however often it is seen', () => {
    const seen: string[] = [];
    const t = new ImpressionTracker((id) => seen.push(id));

    t.observe('p1', 1, 0);
    t.tick(IMPRESSION_DWELL_MS);
    t.observe('p1', 0, 0);
    t.observe('p1', 1, 0);
    t.tick(IMPRESSION_DWELL_MS * 10);
    expect(seen).toEqual(['p1']);
  });

  it('tracks several posts independently', () => {
    const seen: string[] = [];
    const t = new ImpressionTracker((id) => seen.push(id));

    t.observe('a', 1, 0);
    t.observe('b', 0.1, 0); // below the threshold
    t.observe('c', 1, 0);
    t.tick(IMPRESSION_DWELL_MS);
    expect(seen.sort()).toEqual(['a', 'c']);
  });

  it('forgets a post once it is dropped, without reporting it', () => {
    const seen: string[] = [];
    const t = new ImpressionTracker((id) => seen.push(id));

    t.observe('p1', 1, 0);
    t.drop('p1');
    t.tick(IMPRESSION_DWELL_MS * 5);
    expect(seen).toEqual([]);
  });

  it('treats a post already reported elsewhere as done', () => {
    const seen: string[] = [];
    const t = new ImpressionTracker((id) => seen.push(id), ['p1']);

    t.observe('p1', 1, 0);
    t.tick(IMPRESSION_DWELL_MS * 5);
    expect(seen).toEqual([]);
  });
});
