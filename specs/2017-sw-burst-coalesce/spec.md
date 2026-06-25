# Feature Specification: Coalesce burst notifications into one clean per-chat notification

**Feature Branch**: `fix/2017-sw-burst-coalesce`

**Created**: 2026-06-25

**Status**: in-progress
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: On-device test (installed iOS PWA, app closed): a rapid burst of 10 messages produced a
messy pile of notifications — a per-chat notification re-shown several times with a JUMPING count
(`(3)`, `(6)`, `(8)`) and the latest body, the SAME state shown TWICE (a duplicate `(8)·9`), a
stranded "New message / timeout" generic that never upgraded, and iOS's own grouping summary ("you
have 5 new notifications…"). Root cause (investigated): the server fires one Web Push tickle per
message, so a burst wakes the service worker SEVERAL overlapping times; each wake — plus its own
straggler-refetch loop — independently fetches, decrypts, and re-shows on the shared per-chat tag with
NO cross-wake lock, computing the count from "frames I personally found unseen THIS pass" against a
racy shown-ledger. Overlapping passes derive the same set (the duplicate) and per-pass slices make the
count bounce. A cold-start wake that times out shows the generic, but a *different* wake marks the
frames shown first, so the slow wake's settle finds no notes and never upgrades OR closes the generic
(it strands). And spec 2016's "nothing new → show nothing" branch leaves some wakes posting no
notification at all, so iOS fills the gap with its own summary.

This is the **high-confidence, platform-agnostic slice** of the fix (the iOS-specific re-alert tuning
is deferred to on-device iteration): serialize the SW's notification work so wakes/straggler iterations
can't interleave a fetch→show→mark; persist a small per-chat "last shown" summary so any wake can
re-assert the ONE authoritative coalesced notification (correct count + latest body) instead of a stale
per-pass slice or nothing; close a stranded generic when another wake already showed the content. No
message content ever leaves the device; no server change.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A burst yields one clean, correct notification (Priority: P1)

When several messages arrive in a burst to a backgrounded/closed app, the recipient sees ONE per-chat
notification that reflects the latest message and an accurate count — not several re-shown copies with a
jumping count, and never a duplicate of the same state.

**Why this priority**: The jumpy, duplicated notifications make the app feel broken and noisy.

**Independent Test**: Drive two overlapping preview/show passes for the same backlog (simulating
overlapping push wakes); assert the per-chat notification is shown once per distinct state, the count
is the true queued total (not a per-pass slice), and a second pass over an already-shown set produces
no duplicate.

**Acceptance Scenarios**:

1. **Given** a burst of N messages in one chat delivered across overlapping SW wakes, **When** they are
   previewed, **Then** the per-chat notification shows the latest message body with a count equal to the
   true number of queued messages for that chat (monotonic, not a bouncing per-pass slice).
2. **Given** two overlapping passes that compute the same unseen set, **When** they run, **Then** the
   notification is not shown twice for that identical state (no duplicate) — the work is serialized so
   the second pass sees the first's `markShown`.

---

### User Story 2 - No stranded generic; every wake still shows something (Priority: P1)

A cold-start wake's "New message" placeholder is replaced or removed once any wake has the content; and
a wake that finds nothing genuinely new re-asserts the existing coalesced notification rather than
showing nothing (so iOS doesn't fill the gap with its own summary).

**Why this priority**: The stranded "timeout" placeholder and iOS's own summary are exactly the noise
the user reported; both stem from a wake either failing to close the generic or showing nothing.

**Independent Test**: After one pass shows + records a chat's content, a second (slow/cold) pass that
posted a generic closes it (the content is already covered); a "nothing new" pass re-asserts the
recorded per-chat notification (a showNotification call) instead of showing nothing.

**Acceptance Scenarios**:

1. **Given** a wake posted a generic placeholder and another wake has since shown the real content for
   those frames, **When** the first wake settles (or any later wake runs), **Then** the generic is
   closed (not left stranded alongside the content).
2. **Given** a "nothing new" wake (all frames already shown) and a recorded per-chat notification,
   **When** it runs, **Then** it re-asserts that notification silently (a showNotification call) rather
   than showing nothing — so the per-push contract is met without a new alert.
3. **Given** a wake with genuinely no prior notification and nothing pending (e.g. a settings-sync
   wake), **When** it runs, **Then** it shows nothing (unchanged from the mute/badge-only path) — the
   re-assert only fires when there is a recorded notification to re-assert.

### Edge Cases

- The persisted per-chat summary must expire/evict (TTL + cap like the existing shown-ledger) and must
  not re-assert a notification for a chat the page has since drained/read (avoid resurrecting a read
  chat's stale count).
- A genuinely-new undecryptable frame still shows the generic (spec 2016 `newUnshown` preserved).
- The straggler loop still surfaces a late message once; serialization makes its show atomic with its
  mark, so it can't duplicate.
- Multiple chats in one burst: each chat coalesces to its own one notification; counts are per-chat.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The SW's notification work (fetch → decide → show → markShown) MUST be serialized so
  overlapping push wakes and straggler-loop iterations cannot interleave and produce a duplicate
  notification for the same state.
- **FR-002**: The per-chat notification's count MUST reflect the true number of queued messages for that
  chat (from the fetched backlog), not the number of frames a single pass happened to find unseen — so
  the count does not bounce across wakes.
- **FR-003**: The SW MUST persist a small per-chat "last shown" summary (tag → title/body/count/ids,
  bounded + TTL) so any wake can re-assert the one authoritative coalesced notification.
- **FR-004**: On a "nothing new" wake (spec 2016), the SW MUST re-assert the recorded per-chat
  notification silently (a showNotification call, no re-alert) when one exists; it shows nothing only
  when there is no recorded notification to re-assert (preserving the mute/badge-only outcome).
- **FR-005**: A generic placeholder MUST NOT be left stranded: when the content for its frames has been
  shown by any wake (covered by the summary/shown-ledger), the generic tag MUST be closed.
- **FR-006**: The persisted summary MUST expire (TTL + cap) and MUST NOT re-assert a stale notification
  for a chat the page has already drained/read.
- **FR-007**: Existing behavior preserved: spec 2014 dev diagnostic reasons; spec 2015 ratchet
  persistence/serialization (this lock is around the notification ledger/show only, not the ratchet);
  spec 2016 `newUnshown` (a genuinely-new undecryptable frame still shows the generic); the
  `suppressed`/`silenced` paths; the badge still reflects the queued backlog.
- **FR-008**: Zero-knowledge unchanged: no plaintext leaves the device; the SW still only fetches the
  sealed ciphertext the relay already stores; no server change.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Overlapping passes over the same backlog show the per-chat notification once per distinct
  state — no duplicate of an identical (count, body).
- **SC-002**: The per-chat count equals the true queued total for that chat across wakes (not a bouncing
  per-pass slice).
- **SC-003**: A generic placeholder is closed once the content is shown by any wake (no stranded
  "timeout" placeholder).
- **SC-004**: A "nothing new" wake re-asserts the recorded notification (a showNotification call) when
  one exists; shows nothing only when none exists.
- **SC-005**: No regression to the notification / SW-decrypt / call e2e suites or the crypto unit suite.

## Assumptions

- The iOS-specific re-alert behavior (whether `renotify:false` yields a truly silent in-place update,
  and whether one coalesced notification suppresses iOS's own grouping summary) is NOT assumed here —
  this slice fixes the platform-agnostic races/strandings and is validated on-device afterward; further
  iOS tuning is a follow-up.
- The fix is client-only; no server or schema change; the zero-knowledge boundary is unchanged.
- The SW runs in a single global scope (one registration); in-memory serialization holds within it, and
  the persisted ledger/summary covers the cross-activation case (same assumption spec 2015 makes).
