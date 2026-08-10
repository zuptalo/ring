/**
 * Pure paging + ordering for the shared audience list (spec 1065, FR-004/FR-005).
 *
 * This pages a list that is ALREADY in memory — the members of a group message
 * tier, the viewers of a post, the people behind a reaction pill. It is not the
 * engagement *fetch* paging (that one walks a server cursor); the two are
 * deliberately separate because they solve different problems: this one bounds
 * how many rows we hand Vue, that one bounds how many rows we ask the server for.
 *
 * Ionic 8 has no `ion-virtual-scroll` and the app carries no virtualization
 * dependency, so the established idiom here is the ContactsPage one: render
 * `list.slice(0, visible)` and grow `visible` on `ion-infinite-scroll`. These
 * helpers are that arithmetic, kept pure so they can be tested without a DOM.
 */

/** Rows in the first window, and the step each "load more" adds. Sized so the
 *  first window comfortably overfills a phone screen without paying for 300 rows. */
export const AUDIENCE_PAGE = 25;

/** One person in an audience list. `at` is the moment being shown (seen, delivered,
 *  reacted, first viewed) and is absent for people who have no moment yet. */
export interface AudienceRow {
  id: string;
  name: string;
  avatar: string;
  /** Raw timestamp used for ordering. The view formats it; this module never does. */
  at?: number;
  emoji?: string;
  /** e.g. "no longer in this group" — rendered as a quiet second line. */
  note?: string;
}

/** How many rows to render when the sheet opens. */
export function firstPage(total: number): number {
  return Math.min(AUDIENCE_PAGE, total);
}

/** One "load more" step, clamped to the end of the list. */
export function growPage(visible: number, total: number): number {
  return Math.min(visible + AUDIENCE_PAGE, total);
}

/** Whether `ion-infinite-scroll` should stay enabled. */
export function hasMore(visible: number, total: number): boolean {
  return visible < total;
}

/**
 * Most recent first, with a stable tiebreak.
 *
 * The tiebreak matters more than it looks: without it, two people who were
 * stamped in the same millisecond (common when a batch of receipts reconciles
 * together) would swap places between one opening of the sheet and the next,
 * because Array.prototype.sort is only guaranteed stable with respect to the
 * input order, and the input order comes from a Map iteration we do not control.
 *
 * Rows with no moment sink to the bottom rather than sorting as epoch 0, so
 * "not yet delivered" members do not jostle for position among real timestamps.
 */
export function sortAudience(rows: readonly AudienceRow[]): AudienceRow[] {
  return [...rows].sort((a, b) => {
    if (a.at === undefined && b.at === undefined) return a.id.localeCompare(b.id);
    if (a.at === undefined) return 1;
    if (b.at === undefined) return -1;
    return b.at - a.at || a.id.localeCompare(b.id);
  });
}
