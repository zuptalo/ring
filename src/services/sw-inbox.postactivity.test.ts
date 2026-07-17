// Spec 1031: the closed-app (service worker) side of owner-only Wall notifications.
// A `post-activity` push names the engagement's actor from server metadata and NEVER
// alerts for a reaction removal — the remove flag is sealed under K_post, so the
// device opens it locally and a payload it can't open is SKIPPED (a possibly-spurious
// alert is worse than a missed reaction; comments never need decryption at all).
// These tests pin the pure core (classify + note building); the IO wrapper
// (previewPostActivity) only feeds it IDB/fetch/ledger state.
import { describe, it, expect } from 'vitest';
import { classifyPostActivity, buildPostActivityNotes, type PostActivityRow } from './sw-inbox';

const NOW = 1_750_000_000_000;
const POST = 'post-1';

const row = (over: Partial<PostActivityRow>): PostActivityRow => ({
  id: 'e1',
  actor: 'friend-1',
  kind: 'comment',
  payload: 'SEALED',
  createdAt: NOW - 30_000,
  ...over,
});

// openReaction stub: payloads named 'ADD' open as an add, 'REMOVE' as a removal,
// anything else throws (undecryptable — locked/cold-start).
const openReaction = (_key: string, payload: string): { remove?: boolean } => {
  if (payload === 'ADD') return {};
  if (payload === 'REMOVE') return { remove: true };
  throw new Error('cannot open');
};

const base = {
  post: { outgoing: true, postKey: 'K' } as { outgoing?: boolean; postKey?: string } | null | undefined,
  self: 'me',
  seen: new Set<string>(),
  now: NOW,
  openReaction,
};

describe('classifyPostActivity — comments (US1)', () => {
  it('keeps a fresh comment by another actor on our own post', () => {
    const items = classifyPostActivity({ ...base, rows: [row({})] });
    expect(items).toEqual([{ id: 'e1', actor: 'friend-1', kind: 'comment' }]);
  });

  it('skips our own comment (self-actions never alert)', () => {
    expect(classifyPostActivity({ ...base, rows: [row({ actor: 'me' })] })).toEqual([]);
  });

  it('shows nothing when the post is missing locally or is not ours', () => {
    expect(classifyPostActivity({ ...base, post: undefined, rows: [row({})] })).toEqual([]);
    expect(classifyPostActivity({ ...base, post: { outgoing: false, postKey: 'K' }, rows: [row({})] })).toEqual([]);
  });

  it('skips items already in the shown ledger', () => {
    expect(classifyPostActivity({ ...base, seen: new Set(['e1']), rows: [row({})] })).toEqual([]);
  });

  it('skips stale items (older than the recency window)', () => {
    expect(classifyPostActivity({ ...base, rows: [row({ createdAt: NOW - 11 * 60_000 })] })).toEqual([]);
  });

  it('skips tombstones and unknown kinds', () => {
    expect(classifyPostActivity({ ...base, rows: [row({ kind: 'tombstone' })] })).toEqual([]);
    expect(classifyPostActivity({ ...base, rows: [row({ kind: 'view' })] })).toEqual([]);
  });
});

describe('classifyPostActivity — reactions (US2)', () => {
  it('keeps a fresh reaction that decrypts as an add', () => {
    const items = classifyPostActivity({ ...base, rows: [row({ kind: 'reaction', payload: 'ADD' })] });
    expect(items).toEqual([{ id: 'e1', actor: 'friend-1', kind: 'reaction' }]);
  });

  it('skips a reaction removal (never a spurious alert)', () => {
    expect(classifyPostActivity({ ...base, rows: [row({ kind: 'reaction', payload: 'REMOVE' })] })).toEqual([]);
  });

  it('skips a reaction whose payload cannot be opened (locked) — comments still pass', () => {
    const rows = [row({ kind: 'reaction', payload: 'GARBAGE' }), row({ id: 'e2', kind: 'comment' })];
    expect(classifyPostActivity({ ...base, rows })).toEqual([{ id: 'e2', actor: 'friend-1', kind: 'comment' }]);
  });

  it('skips all reactions when the local post row has no key to open them with', () => {
    const rows = [row({ kind: 'reaction', payload: 'ADD' }), row({ id: 'e2', kind: 'comment' })];
    expect(classifyPostActivity({ ...base, post: { outgoing: true }, rows })).toEqual([
      { id: 'e2', actor: 'friend-1', kind: 'comment' },
    ]);
  });
});

describe('buildPostActivityNotes — display + collapse', () => {
  it('one fresh comment → an actor-named note deep-linking to the post', () => {
    const notes = buildPostActivityNotes(POST, [{ id: 'e1', actor: 'friend-1', kind: 'comment' }], new Map([['friend-1', 'Bea']]));
    expect(notes).toEqual([
      { keys: ['e1'], title: 'Bea', body: 'commented on your post', url: `/wall/post/${POST}`, tag: `ring:post:act:${POST}` },
    ]);
  });

  it('one fresh reaction → "reacted to your post"', () => {
    const notes = buildPostActivityNotes(POST, [{ id: 'e1', actor: 'friend-1', kind: 'reaction' }], new Map([['friend-1', 'Bea']]));
    expect(notes[0].body).toBe('reacted to your post');
    expect(notes[0].title).toBe('Bea');
  });

  it('several fresh items collapse to ONE note covering all their ledger keys', () => {
    const notes = buildPostActivityNotes(
      POST,
      [
        { id: 'e1', actor: 'friend-1', kind: 'comment' },
        { id: 'e2', actor: 'friend-2', kind: 'reaction' },
      ],
      new Map([['friend-1', 'Bea'], ['friend-2', 'Cal']]),
    );
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toBe('New activity on your post');
    expect(notes[0].keys.sort()).toEqual(['e1', 'e2']);
    expect(notes[0].tag).toBe(`ring:post:act:${POST}`);
  });

  it('an unresolvable actor falls back to an identity-safe label', () => {
    const notes = buildPostActivityNotes(POST, [{ id: 'e1', actor: 'x', kind: 'comment' }], new Map());
    expect(notes[0].title).toBe('Someone');
  });

  it('no items → no notes (a removal-only wake shows nothing)', () => {
    expect(buildPostActivityNotes(POST, [], new Map())).toEqual([]);
  });
});
