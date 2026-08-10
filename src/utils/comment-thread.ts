/**
 * One-level comment threads (spec 1065 US4, FR-025/FR-026/FR-027/FR-028).
 *
 * Replies nest exactly one level. A reply to a reply joins the same thread under
 * the same top-level comment rather than indenting further, which is what makes
 * a busy post readable on a phone: the column never runs out of horizontal room
 * and a thread cannot recede into a sliver.
 *
 * The invariant is enforced when a reply is STORED, not when it is drawn:
 * `resolveThreadParent` walks a reply's parent up to its top-level ancestor
 * before the reply is sealed, so the stored tree is one level deep by
 * construction. `buildThreads` still flattens defensively, because a row could
 * arrive from an older client or a hostile one, and the renderer should not be
 * the thing that decides how deep a tree is.
 *
 * Pure: no IndexedDB, no Vue. The rows come from the caller.
 */

export interface ThreadRow {
  id: string;
  actor: string;
  at: number;
  /** The top-level comment this answers; absent for a top-level comment. */
  parent?: string;
  deleted?: boolean;
  text?: string;
  actorName?: string;
  actorAvatar?: string;
  /** The person directly answered. This differs from `parent` when replying to
   *  a reply: storage remains one level deep while the UI and wake route remain
   *  faithful to the comment the person actually tapped. Both fields are sealed. */
  replyToActor?: string;
  replyToName?: string;
}

export interface Thread<T extends ThreadRow = ThreadRow> {
  comment: T;
  replies: T[];
}

/** Guards the walk below against a malformed or hostile parent cycle. */
const MAX_WALK = 8;

/**
 * The top-level ancestor of `parentId`, which is what a new reply should store.
 *
 * Replying to a reply resolves to the reply's own parent, so the thread stays one
 * level deep. If the parent is not held locally we keep the id as given: the
 * reply will attach when the parent syncs, which is better than silently
 * re-pointing it at something else.
 */
export function resolveThreadParent(parentId: string, rows: readonly ThreadRow[]): string {
  const byId = new Map(rows.map((r) => [r.id, r]));
  let id = parentId;
  for (let i = 0; i < MAX_WALK; i++) {
    const row = byId.get(id);
    if (!row?.parent) return id;
    id = row.parent;
  }
  return id;
}

export interface ReplyTarget {
  parent: string;
  replyToActor?: string;
  replyToName?: string;
}

/** Resolve both invariants of a reply in one pass: the stored parent is the
 *  top-level comment, while attribution and notification target the exact row
 *  the sender answered. Nothing here leaves the client in plaintext. */
export function resolveReplyTarget(parentId: string, rows: readonly ThreadRow[]): ReplyTarget {
  const direct = rows.find((r) => r.id === parentId);
  return {
    parent: resolveThreadParent(parentId, rows),
    ...(direct?.actor ? { replyToActor: direct.actor } : {}),
    ...(direct?.actorName ? { replyToName: direct.actorName } : {}),
  };
}

/**
 * Group comments into threads: top-level comments oldest first, each with its
 * replies oldest first.
 *
 * Deleted comments are dropped UNLESS they still hold replies, in which case the
 * row survives so the view can show a "this comment was deleted" placeholder and
 * the answers underneath stay readable (FR-027). A reply whose parent is not
 * present is held back rather than rendered detached (FR-028) — it appears as
 * soon as the parent arrives.
 */
export function buildThreads<T extends ThreadRow>(rows: readonly T[]): Thread<T>[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const tops: T[] = [];
  const repliesBy = new Map<string, T[]>();

  for (const r of rows) {
    if (!r.parent) {
      tops.push(r);
      continue;
    }
    // Flatten defensively: follow the chain to a top-level row so a nested
    // reply from another client still lands at depth one.
    const topId = resolveThreadParent(r.parent, rows);
    if (!byId.has(topId)) continue; // parent not here yet — hold, do not orphan
    const list = repliesBy.get(topId);
    if (list) list.push(r);
    else repliesBy.set(topId, [r]);
  }

  const order = (a: T, b: T): number => a.at - b.at || a.id.localeCompare(b.id);
  return tops
    .map((comment) => ({ comment, replies: (repliesBy.get(comment.id) ?? []).sort(order) }))
    .filter((t) => !t.comment.deleted || t.replies.length > 0)
    .sort((x, y) => order(x.comment, y.comment));
}

/** Replies shown before "show all" is tapped, so one loud thread cannot bury the
 *  rest of the comments (FR-026). */
export const REPLIES_SHOWN = 3;
