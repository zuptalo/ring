import { describe, it, expect } from 'vitest';
import { sliceOlder, sliceNewer, compareByTimeId } from './chat-pagination';

// Pure pagination/cursor math over a sorted-ascending array (no IndexedDB). The
// bounded reads in queries.ts get the whole chat from the `chatId` index, sort it
// once, and slice with these helpers (research D2). The seam-dedupe property is what
// keeps adjacent batches from returning the row that sits exactly on the cursor twice.

type Row = { id: string; timestamp: number; body?: string };

// A small ascending fixture with DISTINCT timestamps (the common case — `now()` ms
// per send; seedMessages spreads them).
const rows: Row[] = [
  { id: 'a', timestamp: 10 },
  { id: 'b', timestamp: 20 },
  { id: 'c', timestamp: 30 },
  { id: 'd', timestamp: 40 },
  { id: 'e', timestamp: 50 },
];

describe('compareByTimeId', () => {
  it('orders by timestamp, then breaks ties by id (deterministic)', () => {
    const unsorted: Row[] = [
      { id: 'z', timestamp: 30 },
      { id: 'a', timestamp: 30 },
      { id: 'm', timestamp: 10 },
    ];
    const sorted = [...unsorted].sort(compareByTimeId);
    expect(sorted.map((r) => r.id)).toEqual(['m', 'a', 'z']);
  });
});

describe('sliceOlder', () => {
  it('returns the newest `limit` rows when beforeTs is null, oldest-first', () => {
    expect(sliceOlder(rows, null, 2).map((r) => r.id)).toEqual(['d', 'e']);
  });

  it('returns the `limit` rows immediately older than beforeTs, oldest-first', () => {
    // older than 40 → a,b,c ; the 2 immediately older → b,c
    expect(sliceOlder(rows, 40, 2).map((r) => r.id)).toEqual(['b', 'c']);
  });

  it('returns fewer than `limit` when the chat runs out', () => {
    expect(sliceOlder(rows, 20, 5).map((r) => r.id)).toEqual(['a']);
  });

  it('excludes the row sitting exactly on the cursor (seam dedupe)', () => {
    // beforeTs = 30 (oldest currently loaded) → must NOT include c (ts 30) again.
    const older = sliceOlder(rows, 30, 10);
    expect(older.map((r) => r.id)).toEqual(['a', 'b']);
    expect(older.some((r) => r.timestamp === 30)).toBe(false);
  });

  it('returns [] when nothing is older', () => {
    expect(sliceOlder(rows, 10, 3)).toEqual([]);
  });
});

describe('sliceNewer', () => {
  it('returns the `limit` rows immediately newer than afterTs, oldest-first', () => {
    // newer than 20 → c,d,e ; first 2 → c,d
    expect(sliceNewer(rows, 20, 2).map((r) => r.id)).toEqual(['c', 'd']);
  });

  it('excludes the row sitting exactly on the cursor (seam dedupe)', () => {
    // afterTs = 30 (newest currently loaded) → must NOT include c (ts 30) again.
    const newer = sliceNewer(rows, 30, 10);
    expect(newer.map((r) => r.id)).toEqual(['d', 'e']);
    expect(newer.some((r) => r.timestamp === 30)).toBe(false);
  });

  it('returns [] when nothing is newer', () => {
    expect(sliceNewer(rows, 50, 3)).toEqual([]);
  });
});

describe('seam dedupe across adjacent batches', () => {
  it('older(cursor) ∪ newer(cursor) never returns the cursor row twice', () => {
    // Load a middle batch, then page both ways off its edges; the union of all three
    // batches has every id exactly once (no duplicate at the seams).
    const mid = rows.filter((r) => r.timestamp >= 20 && r.timestamp <= 40); // b,c,d
    const older = sliceOlder(rows, mid[0].timestamp, 10); // older than b → a
    const newer = sliceNewer(rows, mid[mid.length - 1].timestamp, 10); // newer than d → e
    const all = [...older, ...mid, ...newer].map((r) => r.id);
    expect(all).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(new Set(all).size).toBe(all.length); // no duplicates
  });
});
