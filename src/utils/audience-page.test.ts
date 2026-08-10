import { describe, it, expect } from 'vitest';
import {
  AUDIENCE_PAGE,
  firstPage,
  growPage,
  hasMore,
  sortAudience,
  type AudienceRow,
} from './audience-page';

/** Terse row builder — only the fields the ordering actually reads. */
const row = (id: string, at?: number): AudienceRow => ({ id, name: id, avatar: '', at });

describe('audience paging', () => {
  it('opens with a bounded first window regardless of list size', () => {
    expect(firstPage(5)).toBe(5);
    expect(firstPage(500)).toBe(AUDIENCE_PAGE);
  });

  it('grows by a fixed step and never past the end', () => {
    const total = AUDIENCE_PAGE + 3;
    const one = growPage(firstPage(total), total);
    expect(one).toBe(total); // the remainder is smaller than a step
    expect(growPage(one, total)).toBe(total); // already at the end, stays put
  });

  it('grows by exactly one step when plenty remains', () => {
    const total = AUDIENCE_PAGE * 10;
    expect(growPage(AUDIENCE_PAGE, total)).toBe(AUDIENCE_PAGE * 2);
  });

  it('knows when there is more to load', () => {
    expect(hasMore(AUDIENCE_PAGE, AUDIENCE_PAGE * 2)).toBe(true);
    expect(hasMore(AUDIENCE_PAGE, AUDIENCE_PAGE)).toBe(false);
    expect(hasMore(10, 3)).toBe(false);
  });
});

describe('audience ordering', () => {
  it('puts the most recent first', () => {
    const sorted = sortAudience([row('a', 100), row('c', 300), row('b', 200)]);
    expect(sorted.map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('breaks ties by id so the order never shuffles between openings', () => {
    const once = sortAudience([row('b', 100), row('a', 100), row('c', 100)]);
    const twice = sortAudience([row('c', 100), row('b', 100), row('a', 100)]);
    expect(once.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(twice.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('sinks rows with no time to the bottom, still id-ordered', () => {
    // "Not yet delivered" members carry no moment. They must not sort as epoch 0
    // ahead of nothing, and they must not shuffle either.
    const sorted = sortAudience([row('b'), row('z', 100), row('a')]);
    expect(sorted.map((r) => r.id)).toEqual(['z', 'a', 'b']);
  });

  it('does not mutate the input', () => {
    const input = [row('a', 100), row('b', 200)];
    sortAudience(input);
    expect(input.map((r) => r.id)).toEqual(['a', 'b']);
  });
});
