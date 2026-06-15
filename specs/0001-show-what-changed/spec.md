# Feature Specification: Show what changed in the update toast (release-note delta)

**Feature Branch**: `feat/0001-show-what-changed`

**Created**: 2026-06-15

**Status**: in-review
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped. -->

**Input**: User description: "I would like the update toast sent to the users to now have a
more meaningful purpose and tell them exactly what has been updated or fixed as part of that
update." Deployment context: `develop` is continuously deployed to real testers (pulled ~every
2 minutes); stable changes are promoted to `main` as a release.

## Feature Summary

Today the PWA update toast says only "A new version of Ring is ready" (it can name the version
via `/v1/config`, but nothing about *what changed*). Replace that with a short, human-readable
list of the changes the incoming build introduces **relative to the version the user is running**
— a per-user **delta**, not a static changelog. This is especially valuable because the `develop`
channel pushes frequent updates to testers, who currently can't tell one update from the next.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A develop tester sees exactly what each update brings (Priority: P1)

A family/friend tester is on `develop` build N. The continuous deploy ships build N+1 (one merged
PR). On next launch/foreground, the toast says: **"Ring 0.1.0-dev.42 is ready — What's new:
• Stabilize message status reporting"** with Update / Later buttons.

**Why this priority**: This is the core ask and the highest-frequency case (continuous develop
deploys). It turns an opaque "update available" into a meaningful, trustworthy signal.

**Independent Test**: Given a running build whose notes are {A,B} and an incoming build whose
notes are {A,B,C}, the toast shows only **C**.

**Acceptance Scenarios**:

1. **Given** a running build and an incoming build that adds one change, **When** the update is
   detected, **Then** the toast lists that one change (prettified, human-readable).
2. **Given** an incoming build that adds several changes since the running one, **When** detected,
   **Then** the toast lists them, capped (e.g. top 5) with "+N more" if longer.
3. **Given** the update is accepted, **When** the user taps Update, **Then** the existing
   skip-waiting + reload behavior is unchanged.

### User Story 2 - A user crossing a release sees the release's changes (Priority: P2)

A user on `0.1.0` updates to `0.2.0`. The toast shows everything new to them since `0.1.0`.

**Acceptance Scenarios**:

1. **Given** a running release and an incoming release several changes ahead, **When** detected,
   **Then** the delta is correct even though the build's "since last tag" base changed (delta is
   computed by stable commit identity, not by range).

### User Story 3 - Graceful when there's nothing to say (Priority: P1)

The feature must never make the update experience worse than today.

**Acceptance Scenarios**:

1. **Given** the incoming notes can't be fetched, or the running build predates this feature (no
   baked-in notes), **When** detected, **Then** the toast falls back to today's generic "A new
   version of Ring is ready" message (still names the version when available).
2. **Given** the computed delta is empty, **When** detected, **Then** the generic message is shown
   (no empty "What's new" section).

### Edge Cases

- **No prior release tag** (early project) → notes are the changes since repo start, or empty →
  generic message; never an error.
- **Non-Conventional-Commit / merge-commit subjects** in range → merge-commit noise
  (`Merge pull request #…`) is filtered out; other subjects are shown prettified as-is.
- **Large delta** → cap the visible list with a "+N more" affordance so the toast doesn't overflow.
- **Old running client** (no `__RELEASE_NOTES__`) → treated as "unknown running notes" → fall back
  to generic (do NOT dump the entire incoming list as if all new).
- **Prettification** strips the Conventional-Commit `type(scope):` prefix for display but keeps the
  subject meaning (e.g. `fix(sync): stabilize message status` → "Stabilize message status").

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When an update is available with a non-empty per-user delta, the update toast MUST
  offer a **"What's new"** action that opens a sheet (IonModal) listing the human-readable changes
  the incoming build introduces **relative to the running build**. The toast's Update/Later actions
  and the skip-waiting behavior are unchanged; the sheet itself MAY also offer Update.
- **FR-002**: Release notes MUST be generated automatically at build time from the Conventional-
  Commit subjects since the last release tag — no manual curation — and merge-commit subjects
  MUST be excluded.
- **FR-003**: Each note entry MUST carry a stable identity (its commit SHA) so the delta can be
  computed exactly, including across release-tag resets.
- **FR-004**: The incoming build's notes MUST be exposed to a running client via the existing
  public `/v1/config` endpoint; the running build's own notes MUST be baked into the client at
  build time (a compile-time constant, like `__APP_VERSION__`).
- **FR-005**: The delta MUST be the set of incoming notes whose commit identity is not present in
  the running build's notes (an *empty* running list is valid — the delta is then everything since
  the running release). An empty delta or missing/unavailable incoming notes MUST fall back to the
  current generic message (no regression).
- **FR-006**: The toast MUST surface the change count (e.g. "What's new (3)"); the sheet MUST list
  the full delta, scrollable, newest-first.
- **FR-007**: The same notes-generation path MUST feed both the `develop` image and the release
  image builds, so the feature works on the continuous channel and on formal releases identically.
- **FR-008**: The notes-derivation and delta logic MUST be pure and unit-tested (no DOM/IDB/network
  in the tested core), per the project's testing conventions.

### Key Entities

- **ReleaseNote**: `{ sha: string; subject: string }` — one user-facing change (prettified subject
  + its commit identity). A build carries an ordered list of these (newest first), covering changes
  since the last release tag.
- **`/v1/config` response**: gains an optional `notes: ReleaseNote[]` field alongside `version`.
- **`__RELEASE_NOTES__`**: compile-time constant — the running client build's own `ReleaseNote[]`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A develop tester updating one build sees exactly the change(s) in that update — zero
  unrelated entries — across the test matrix.
- **SC-002**: A user updating across a release sees the correct delta since their version.
- **SC-003**: Missing/empty notes never degrade the experience below today's behavior (generic
  message still shown, version still named when available).
- **SC-004**: The pure notes/delta core is unit-tested ≥ 90% (prettify, merge-filter, SHA-keyed
  delta, cap, fallbacks); client build + server tests stay green.
- **SC-005**: Both `develop` and release images ship correct notes (verified via `/v1/config`).

## Zero-Knowledge Impact *(mandatory — Constitution Principle I)*

None. Release notes are **public, non-user application metadata** (the same class as `version`,
`publicUrl`, `vapidPublicKey` already returned by `/v1/config`). Nothing user-generated or
plaintext crosses the boundary; the server serves its own build's notes, derived from the public
git history. No new endpoint, no auth change.

## Assumptions

- Conventional Commits are enforced (they are, per CLAUDE.md) and their subjects "describe
  user-facing behavior, not internals", making them a fit source for end-user notes. A later spec
  could elevate to spec titles; this one uses commit subjects.
- Notes are computed in CI (which has full git history) and passed into the Docker build as a
  build-arg, then baked into both the client bundle and the server binary — mirroring how `VERSION`
  already flows.
- The update toast's existing detection/skip-waiting machinery (`useAppUpdate` + `sw.ts`) is reused
  unchanged; only the message content changes.

## Clarifications (resolved)

- **Presentation** → **richer "What's new" sheet** (IonModal) opened from a toast action, not
  plain toast text (user decision).
- **Delta vs. full changelog** → **delta** (user decision): show only what's new to *this* user.
- **Source of notes** → Conventional-Commit subjects since the last release tag, automatic,
  prettified; merge commits filtered.
- **Delta identity** → **commit SHA** (exact across tag resets), not subject text or range math.
- **Fallback** → on any gap (no incoming notes, no running notes, empty delta) show today's generic
  message; never worse than current behavior.

## Complexity & Exceptions

The only new moving part is build-time notes generation threaded through the Docker build into both
artifacts. Justified: there is no zero-knowledge-preserving way to show *what changed* without
carrying that metadata in the build, and reusing `/v1/config` + a shared notes script keeps it
minimal. No constitutional principle is waived.
