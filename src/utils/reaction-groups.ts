/**
 * Turn a post's stored reaction rows into attributed audience rows (spec 1065 US3).
 *
 * Everyone in the audience sees the aggregate pills. The post's author can
 * additionally open them and see who is behind the tally, with what, and when.
 *
 * The subtlety this exists for: changing your emoji is stored as a removal of
 * the old row plus a live row for the new one, because reactions are keyed
 * (actor, emoji) and reconciled last-write-wins per key. A naive pass would list
 * that person twice, once under each emoji, and the second entry would be a
 * reaction they no longer hold. Dropping removed rows first is all it takes, but
 * it has to be done deliberately.
 *
 * Grouping by emoji happens in the sheet, which already knows how to order by
 * most-used. Here we only produce rows.
 */

export interface ReactionLike {
  actor: string;
  emoji?: string;
  at: number;
  deleted?: boolean;
}

export interface AttributedReaction {
  /** (actor, emoji) — someone may legitimately hold several emoji at once, so
   *  the actor alone is not a stable key. */
  id: string;
  name: string;
  avatar: string;
  emoji: string;
  at: number;
}

export function attributedReactions(
  rows: readonly ReactionLike[],
  nameOf: (actorId: string) => string,
  avatarOf: (actorId: string) => string,
): AttributedReaction[] {
  const out: AttributedReaction[] = [];
  for (const r of rows) {
    if (!r.emoji || r.deleted) continue;
    out.push({
      id: `${r.actor}:${r.emoji}`,
      name: nameOf(r.actor),
      avatar: avatarOf(r.actor),
      emoji: r.emoji,
      at: r.at,
    });
  }
  return out;
}
