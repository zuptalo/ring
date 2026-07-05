/**
 * How an emoji profile picture should animate right now (spec 0008 FR-028) —
 * pure and import-clean (no db/vue), so every avatar surface resolves
 * identically and the rule is unit-testable in isolation:
 *  - the master emoji-animation switch wins over everything;
 *  - `attention` (an unread chat) keeps it looping while the toggle allows;
 *  - otherwise the configured loop count applies ('forever' = never stop);
 *  - an unknown stored value falls back to the default (twice).
 */

export interface AvatarAnimation {
  animate: boolean
  /** Loop cap; absent = keep looping while visible. */
  plays?: number
}

const LOOPS: Record<string, number> = { once: 1, twice: 2, thrice: 3 }

export function resolveAvatarAnimation(
  animEmoji: boolean,
  loops: string,
  unreadLoop: boolean,
  attention: boolean,
): AvatarAnimation {
  if (!animEmoji) return { animate: false }
  if (attention && unreadLoop) return { animate: true }
  if (loops === 'forever') return { animate: true }
  return { animate: true, plays: LOOPS[loops] ?? 2 }
}
