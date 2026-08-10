import { describe, it, expect } from 'vitest';
import { resolveReplyTarget, resolveThreadParent, buildThreads, type ThreadRow } from './comment-thread';

const c = (id: string, at: number, parent?: string, deleted = false): ThreadRow => ({
  id,
  actor: 'a',
  at,
  parent,
  deleted,
});

describe('resolveThreadParent (spec 1065 FR-025)', () => {
  const rows = [c('top', 100), c('reply', 200, 'top')];

  it('a reply to a top-level comment points at that comment', () => {
    expect(resolveThreadParent('top', rows)).toBe('top');
  });

  it('a reply to a REPLY points at the shared top-level ancestor', () => {
    // One level by construction, not by how it happens to be rendered: the
    // stored tree can never be deeper than one, whatever the UI does later.
    expect(resolveThreadParent('reply', rows)).toBe('top');
  });

  it('survives a parent that is not present locally', () => {
    expect(resolveThreadParent('missing', rows)).toBe('missing');
  });

  it('does not loop on a cycle', () => {
    const cyclic = [c('x', 1, 'y'), c('y', 2, 'x')];
    expect(() => resolveThreadParent('x', cyclic)).not.toThrow();
  });
});

describe('resolveReplyTarget (spec 1065 FR-025/FR-029a)', () => {
  const rows: ThreadRow[] = [
    { ...c('top', 100), actor: 'alice', actorName: 'Alice' },
    { ...c('reply', 200, 'top'), actor: 'bob', actorName: 'Bob' },
  ];

  it('stores the top-level parent but keeps the person directly answered', () => {
    expect(resolveReplyTarget('reply', rows)).toEqual({
      parent: 'top',
      replyToActor: 'bob',
      replyToName: 'Bob',
    });
  });

  it('keeps a missing parent id without inventing an addressee', () => {
    expect(resolveReplyTarget('missing', rows)).toEqual({ parent: 'missing' });
  });
});

describe('buildThreads (spec 1065 US4)', () => {
  it('nests replies under their parent, oldest first within a thread', () => {
    const threads = buildThreads([c('t1', 100), c('r2', 300, 't1'), c('r1', 200, 't1')]);
    expect(threads).toHaveLength(1);
    expect(threads[0].comment.id).toBe('t1');
    expect(threads[0].replies.map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('keeps top-level comments oldest first', () => {
    const threads = buildThreads([c('b', 200), c('a', 100)]);
    expect(threads.map((t) => t.comment.id)).toEqual(['a', 'b']);
  });

  it('keeps a deleted parent so its replies stay readable', () => {
    const threads = buildThreads([c('t1', 100, undefined, true), c('r1', 200, 't1')]);
    expect(threads).toHaveLength(1);
    expect(threads[0].comment.deleted).toBe(true);
    expect(threads[0].replies.map((r) => r.id)).toEqual(['r1']);
  });

  it('drops a deleted comment that has no replies', () => {
    const threads = buildThreads([c('t1', 100, undefined, true), c('t2', 200)]);
    expect(threads.map((t) => t.comment.id)).toEqual(['t2']);
  });

  it('holds a reply whose parent has not arrived, rather than orphaning or dropping it', () => {
    const threads = buildThreads([c('r1', 200, 'not-here-yet')]);
    expect(threads).toEqual([]); // not rendered detached...
    const later = buildThreads([c('r1', 200, 'now-here'), c('now-here', 100)]);
    expect(later[0].replies.map((r) => r.id)).toEqual(['r1']); // ...and attaches on arrival
  });

  it('never nests deeper than one level even if a stored row says otherwise', () => {
    // Defence in depth: resolveThreadParent should have prevented this on the way
    // in, but a row from an older or hostile client must not deepen the tree.
    const threads = buildThreads([c('t1', 100), c('r1', 200, 't1'), c('r2', 300, 'r1')]);
    expect(threads).toHaveLength(1);
    expect(threads[0].replies.map((r) => r.id)).toEqual(['r1', 'r2']);
  });
});
