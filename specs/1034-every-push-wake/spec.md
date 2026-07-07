# Feature Specification: No Silent Pushes — Every Wake Shows a Notification Unless the App Is Visibly Open

**Feature Branch**: `feat/1034-every-push-wake`

**Created**: 2026-07-07

**Status**: in-review
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped. -->

**Input**: User directive after a live incident: "We should have 0 push
notifications which produce no visible notification on the device — even for
badge-only updates on hidden chats. Silent is only acceptable when the user is
online; offline, always show the generic message with no sender name or
content."

## Why (the incident)

iOS enforces the Web Push `userVisibleOnly` contract: a service worker that
repeatedly consumes a push without showing a notification gets its
subscription silently revoked ("zombie": Apple keeps accepting sends with 201,
the device never wakes again). A dev iPhone hit exactly this — backgrounded
overnight, then push-dead. Audit found SEVEN wake outcomes that show nothing:

1. Message wake, `suppressed` (master toggle off — a race window; the toggle
   unsubscribes, but a wake in flight still consumes silently).
2. Message wake, `silenced` (muted chat / per-chat web-push-off / badge-only /
   hidden chats): badge updates, nothing shows.
3. Message wake, nothing-new with no fresh summary: shows nothing.
4. Message wake, nothing-new with an identical last-shown signature
   (spec 2020's duplicate fix): skips entirely.
5. Store-on-push drain (spec 1032) that persists + acks frames but produced
   zero notes (all frames silenced): returns fully-handled, nothing shows.
6. conn / post / post-activity / version wakes gate their notification on
   `clients.length === 0` — but a FROZEN background PWA still counts as a
   client (the norm on iOS), so these wakes show nothing exactly when the
   phone is in the state that accrues strikes. (post/post-activity are also
   silent when their toggle is off, and a reaction REMOVAL previews to zero
   notes by design.)
7. Message wake where the settle verdict closes a shown generic (visible flash
   already happened — contract-satisfying; kept as is, listed for completeness).

## Policy (FR-001)

Every push wake MUST end with at least one visible notification **unless a
Ring window is currently VISIBLE** (`WindowClient.visibilityState === 'visible'`
— truly on screen, not merely an existing frozen/background client). The
page-ack path (an unlocked page confirming it rendered the user-facing alert)
also counts as visible handling.

When the rich/preview path has nothing it may show (silenced, hidden,
suppressed race, nothing-new, removal-only activity), show the **quiet
generic**: content-free (no sender, no preview — the same zero-knowledge class
as the push payload itself), `silent: true` (no sound/vibration, so mute and
badge-only keep their spirit: the user is not buzzed, but the OS sees a
visible notification), on the generic tag (self-replacing, never a pile).

- Message-kind quiet generic: "New message" / "You have a new message."
  (the existing generic copy).
- Other kinds: "Ring" / "New activity".

## Requirements

- **FR-002**: The seven paths above (minus #7) each terminate in: rich note,
  page-ack, visible client, or the quiet generic. No other outcome exists.
- **FR-003**: The nothing-new identical-signature skip (spec 2020) becomes a
  quiet generic instead of a skip: the duplicate-banner problem it fixed was
  the RICH per-chat banner repeating; the quiet generic is silent, generic-
  tagged, and self-replacing. (Deliberate spec-2020 amendment.)
- **FR-004**: `conn`/`post`/`post-activity`/`version` wakes replace their
  `clients.length` gate with the visible-client test for the SILENT outcome:
  rich behavior is unchanged when the app is fully closed; a frozen background
  app now yields at least the quiet generic. A hidden-but-running page (which
  may itself show a rich note) can briefly coexist with one quiet generic —
  accepted: it is silent, generic, self-replacing, and superseded/closed when
  a rich note shows.
- **FR-005**: The pure decisions (visible-client test, quiet-note content per
  kind) are unit-tested; the wiring is reviewed against the path inventory.

## Zero-Knowledge Impact

None on the wire. The quiet generic carries no sender, no content — exactly
the information the push payload itself already reveals (that *something*
happened), now surfaced instead of silently consumed.

## Success Criteria

- **SC-001**: Unit tests cover the visible-test and quiet-note builders, plus
  the reassert path returning "shown/not shown" so its caller can fall back.
- **SC-002**: Code inventory shows zero remaining wake terminations without a
  show/ack/visible outcome (documented in the PR).
- **SC-003**: `npm run build` + full unit suite + the three notification e2e
  suites pass.
