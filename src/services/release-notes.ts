// Pure helpers for the "What's new" update flow.
//
// Each build is stamped (at build time, from git) with the list of changes since
// the last release tag — its `ReleaseNote[]`. The running client carries its own
// list as the compile-time constant `__RELEASE_NOTES__`; the incoming build's list
// arrives via `/v1/config`. `computeDelta` is the per-user difference (what the
// incoming build adds that the running one didn't have), keyed by commit SHA so it
// is exact even when the "since last tag" base shifts at a release. `prettify`
// turns a Conventional-Commit subject into user-facing text.
//
// No DOM / IndexedDB / network here, so this is fully unit-testable in the Node env.

export interface ReleaseNote {
  sha: string; // short commit hash — the stable identity used for the delta
  subject: string; // raw Conventional-Commit subject (prettified for display)
}

/** Changes the incoming build introduces that the running build did not already
 *  have, by commit identity. Order is preserved (newest-first as stamped). An empty
 *  `running` is valid: the delta is then the whole incoming list (everything since
 *  the running release). */
export function computeDelta(incoming: ReleaseNote[], running: ReleaseNote[]): ReleaseNote[] {
  const have = new Set(running.map((n) => n.sha));
  return incoming.filter((n) => !have.has(n.sha));
}

// Conventional-Commit prefix: type, optional (scope), optional `!`, then `: `.
const CC_PREFIX = /^[a-z]+(\([^)]*\))?!?:\s*/i;

/** Turn a commit subject into user-facing text: drop the `type(scope):` prefix and
 *  upper-case the first letter. A non-conforming subject is passed through (just
 *  capitalized), never dropped. */
export function prettify(subject: string): string {
  const stripped = subject.replace(CC_PREFIX, '').trim();
  const text = stripped || subject.trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
