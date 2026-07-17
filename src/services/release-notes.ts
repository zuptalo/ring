// Pure helpers for the "What's new" update flow.
//
// Each build is stamped (at build time, from git) with the list of changes since
// the last release tag — its `ReleaseNote[]`. The running client carries its own
// list as the compile-time constant `__RELEASE_NOTES__`; the incoming build's list
// arrives via `/v1/config`. `computeDelta` is the per-user difference (what the
// incoming build adds that the running one didn't have), keyed by commit SHA so it
// is exact even when the "since last tag" base shifts at a release. `userFacing`
// drops changes a regular user doesn't care about (build/CI/test/docs/chores), and
// `prettify` turns a Conventional-Commit subject into clean user-facing text.
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

// Conventional-Commit types that are NOT worth telling a regular user about: build
// plumbing, CI, chores, dependency bumps, tests, docs, pure refactors, and code style.
// Everything else (feat, fix, perf, security, and any non-conforming subject) is treated
// as a user-facing change worth surfacing. A denylist (rather than an allowlist) errs
// toward SHOWING a genuine change we didn't anticipate the type of, never hiding one.
const NOISE_TYPES = new Set(['build', 'chore', 'ci', 'deps', 'docs', 'refactor', 'style', 'test']);

/** The Conventional-Commit type of a subject in lowercase (e.g. `feat`, `fix`), or
 *  `null` when the subject doesn't start with a `type(scope): ` prefix. */
function commitType(subject: string): string | null {
  const m = /^([a-z]+)(\([^)]*\))?!?:/i.exec(subject.trim());
  return m ? m[1].toLowerCase() : null;
}

/** Whether a note describes a change a regular user cares about (a new feature, fix,
 *  or improvement) rather than internal plumbing. */
export function isUserFacing(note: ReleaseNote): boolean {
  const t = commitType(note.subject);
  return t === null || !NOISE_TYPES.has(t);
}

/** Keep only the user-facing notes (drops build/CI/test/docs/chore/etc.), so the
 *  "What's new" list reads as features and fixes, not a developer changelog. */
export function userFacing(notes: ReleaseNote[]): ReleaseNote[] {
  return notes.filter(isUserFacing);
}

/** A version for display: drop semver build metadata (the `+<sha>` the develop image
 *  stamps, e.g. `0.1.0-dev.127+3ddacbf…`), which is a long unbreakable token that
 *  wrecks toast/sheet layout. Keeps the pre-release part (`-dev.127`, `-rc.1`). */
export function displayVersion(v: string): string {
  return v.split('+')[0];
}

// Conventional-Commit prefix: type, optional (scope), optional `!`, then `: `.
const CC_PREFIX = /^[a-z]+(\([^)]*\))?!?:\s*/i;

// A trailing developer reference users don't need, stripped for display. Covers
// `(spec 1015)`, a spec ref that carries extra detail like `(spec 1013 US2/US3)` or
// `(spec 1015 FR-014)`, a PR/issue number `(#248)`, and a `(gh-12)` reference. The
// `spec\s*\d+[^)]*` form deliberately swallows any suffix after the number (US/FR/task
// labels) — the leak the iOS user saw — while `(finally)` and other prose parentheticals
// are left alone because they don't start with `spec`/`#`/`gh-`.
const TRAILING_REF = /\s*\((?:specs?\s*\d+[^)]*|#\d+|gh-\d+)\)\s*$/i;

// A trailing `(+ …)` developer aside (e.g. `(+ flaky test fix)`) — a parenthetical the
// author tacked on, not user-facing. Only strips parens that OPEN with `+`, so genuine
// notes like `(finally)` survive.
const TRAILING_ASIDE = /\s*\(\+[^)]*\)\s*$/;

/** Turn a commit subject into clean user-facing text: drop the `type(scope):` prefix,
 *  strip a trailing spec/issue/PR reference and any `(+ …)` aside, and upper-case the
 *  first letter. A non-conforming subject is passed through (just trimmed + capitalized),
 *  never dropped. */
export function prettify(subject: string): string {
  let stripped = subject.replace(CC_PREFIX, '').trim();
  // A squash-merge stacks trailing refs — `… (spec 1054) (#1012)` — so strip the aside
  // and reference repeatedly until neither matches, not just once (a single pass would
  // leave the inner `(spec 1054)` behind once `(#1012)` is removed).
  for (let prev = ''; prev !== stripped; ) {
    prev = stripped;
    stripped = stripped.replace(TRAILING_ASIDE, '').replace(TRAILING_REF, '').trim();
  }
  const text = stripped || subject.trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
