/**
 * wall-activity-policy — the single pure predicate for "should THIS device alert its
 * user about one piece of Wall engagement?" (spec 1031: owner-only notifications).
 *
 * Why this exists: the server can only route on metadata it already holds (post id,
 * author, actor, unsealed kind) and cannot see the sealed reaction add-vs-remove
 * flag, so the FINAL show/skip decision must live on the device. Keeping it a pure,
 * dependency-free function (mirroring notify-policy.ts) means the live page consults
 * exactly these rules, they're trivially unit-testable, and a misrouted or stale
 * push can never produce a wrong banner — ownership is re-checked right here.
 *
 * Deliberately ABSENT input: the per-person Wall mute/hide ledgers. Per the spec's
 * clarification those govern NEW-POST alerts only — someone engaging with YOUR OWN
 * post always concerns you, muted or not — so the predicate cannot even consult them.
 */

/** How long after the engagement happened it still deserves an alert. A reconnect
 *  after hours offline syncs a backlog; only genuinely-recent items may banner
 *  (mirrors notifyNewPost's recency guard). */
export const WALL_ACTIVITY_FRESH_MS = 5 * 60_000;

export interface WallActivityInput {
  /** The engaged post is OURS (post.outgoing) — the owner-only heart of spec 1031. */
  isOwnPost: boolean;
  /** The sealed reply/reaction target is one of our comments. */
  answersMe?: boolean;
  /** Who performed the engagement. */
  actor: string;
  /** Our own user id (self-actions never alert, FR-004). */
  self: string;
  /** Engagement type as stored locally; views never alert (FR-011). */
  type: 'reaction' | 'comment' | 'view';
  /** Removed/tombstoned — a reaction removal or deleted comment never alerts (FR-002/011). */
  deleted: boolean;
  /** When the engagement happened (its own timestamp, not arrival time). */
  at: number;
  /** The current time — passed in so the function stays pure. */
  now: number;
  /** The "Activity on your posts" setting (notifications.wall.activity). */
  activityEnabled: boolean;
  /** The temporary global Wall mute (wall.muteUntil) is active. */
  tempMuted: boolean;
  /** This engagement item was already alerted (session/ledger dedupe). */
  alreadyNotified: boolean;
}

export type WallActivityDecision = 'alert' | 'skip';

/** Decide whether one freshly-synced engagement item earns a user-visible alert. */
export function wallActivityAlert(i: WallActivityInput): WallActivityDecision {
  if (!i.isOwnPost && !i.answersMe) return 'skip';
  if (i.actor === i.self) return 'skip'; // self-actions are silent (FR-004)
  if (i.type !== 'reaction' && i.type !== 'comment') return 'skip'; // views never alert (FR-011)
  if (i.deleted) return 'skip'; // removals/tombstones never alert (FR-002/FR-011)
  if (i.now - i.at > WALL_ACTIVITY_FRESH_MS) return 'skip'; // stale backlog must not flood
  if (!i.activityEnabled) return 'skip'; // the user turned engagement alerts off (FR-007)
  if (i.tempMuted) return 'skip'; // "quiet the Wall for a while" covers engagement too
  if (i.alreadyNotified) return 'skip'; // dedupe: one alert per engagement item
  return 'alert';
}
