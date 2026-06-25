# Feature Specification: Stop background notifications showing a generic placeholder when there's nothing new

**Feature Branch**: `fix/2016-sw-no-spurious-generic`

**Created**: 2026-06-25

**Status**: in-progress
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: Reported on-device after spec 2015 shipped: a generic "New message" / "Tap to open"
notification still appears occasionally — but in cases where there is genuinely NOTHING NEW to
announce. Two concrete repros: (1) sending "1", "2", "3" as three quick separate messages shows the
real decrypted content for all three PLUS an extra generic placeholder in between; (2) toggling
Settings → Notifications → Show preview fires a push that shows a generic with the spec-2014 diagnostic
reason `no-frames`, and turning it back on appears to "take time" to fix subsequent messages.

Root cause (confirmed by reading the SW path): the service worker shows the generic placeholder in the
`else if (!suppressed && !silenced)` branch of `showMessageNotification` WHENEVER its preview produced
no notes — which includes two "nothing genuinely new" cases, not just "a new message we couldn't
decrypt":
  - **`no-frames`**: the relay queue is already empty (the page or a prior straggler-refetch drained
    it). `previewPending` returns `reason: 'no-frames'` and the caller shows a placeholder anyway.
  - **all-seen**: every fetched frame's id is already in the shown-ledger (`seen`), so the decrypt loop
    skips them all → `notes: []`, `reason: undefined` → the caller shows a placeholder ("Tap to open").
    In a rapid burst, a later push races the in-wake straggler loop (which already fetched + showed
    those frames) and finds only already-shown frames → the spurious extra generic.

The "Show preview takes time to fix subsequent messages" symptom is the SAME bug: the SW reads the
`notifications.showPreview` setting fresh from IndexedDB on every push (no cache), so the toggle takes
effect immediately for real messages — the lingering generics the user saw are the independent
`no-frames` / all-seen spurious placeholders, not a stale setting.

Fix: the SW shows the generic placeholder ONLY when there is a genuinely-new message it could not
render (a fetched-but-undecryptable frame, a PIN-locked device, a failed relay fetch, or a decrypt
still in flight at the generic deadline) — NEVER when there are no pending frames or every pending
frame was already shown. For a "nothing new" push it honors the per-push notification contract the
same way the existing mute / badge-only (`silenced`) path already does: re-assert an
already-showing notification silently (no new banner/sound) if one exists, otherwise show nothing and
just keep the badge accurate. No content ever leaves the device; no server change.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - No spurious generic during a quick burst (Priority: P1)

When several messages arrive in quick succession, the recipient sees the real content notification(s)
for them and NOT an extra generic "New message / Tap to open" placeholder mixed in.

**Why this priority**: A generic placeholder appearing alongside the real content for the same burst
makes notifications look broken and untrustworthy — the user can't tell a real "couldn't decrypt"
fallback from this noise.

**Independent Test**: Simulate two push wakes for the same backlog where the first shows + marks the
frames shown; the second finds every frame already shown → it shows NO new generic (and the badge stays
correct). Regression: a wake with a genuinely new, undecryptable frame still shows the generic.

**Acceptance Scenarios**:

1. **Given** a push wake whose fetched frames are ALL already in the shown-ledger (a burst straggler
   already displayed them), **When** the SW handles that push, **Then** it shows no new generic
   placeholder; any already-showing content notification is left intact and the badge is unchanged.
2. **Given** a burst of three messages delivered across overlapping push wakes, **When** they are
   previewed, **Then** the user sees content notifications for them with no extra generic placeholder
   interleaved.
3. **Given** a push wake that fetches a genuinely new frame the SW cannot decrypt yet (cold
   start/session not reachable), **When** it handles that push, **Then** it STILL shows the generic
   placeholder (this real fallback is unchanged).

---

### User Story 2 - No generic when there's nothing pending (Priority: P1)

A push that finds the relay queue empty (the message was already drained, or the push carried no queued
message — e.g. a settings/own-data sync wake) does NOT show a "New message" placeholder.

**Why this priority**: The `no-frames` placeholder is pure noise — there is no message to announce —
and it is what the user sees when toggling Show preview.

**Independent Test**: `previewPending` returns the `no-frames` result → the caller shows no new generic
(re-asserts an existing notification if one is up, else shows nothing); the badge reflects on-device
unread only.

**Acceptance Scenarios**:

1. **Given** a push wake where `/relay/pending` returns zero frames, **When** the SW handles it,
   **Then** it shows no new generic placeholder.
2. **Given** a "nothing new" push wake while a content notification is already showing, **When** the SW
   handles it, **Then** it re-asserts that existing notification silently (no new banner or sound) to
   honor the per-push contract — it does not add a generic.
3. **Given** Show preview is toggled and the resulting wake has nothing new, **When** the SW handles it,
   **Then** no generic appears; subsequent real messages preview per the (freshly read) setting.

### Edge Cases

- A wake with BOTH a new undecryptable frame AND already-seen frames: the new undecryptable frame still
  warrants the generic (US1 scenario 3 dominates).
- A "nothing new" wake with no notification currently showing: show nothing and keep the badge accurate
  — mirroring the existing mute / badge-only (`silenced`) path, which already shows no notification on a
  push. (iOS tolerates this; it is the established pattern.)
- A slow cold-start decrypt still in flight at the generic deadline (`timedOut`): the generic still
  shows immediately and is upgraded/closed when the decrypt settles — unchanged from today.
- The generic→content upgrade and the straggler loop are unchanged: a real late-arriving note still
  replaces a generic and still shows once.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The SW MUST NOT show a generic message placeholder when the preview produced no notes
  solely because there were no pending frames (`no-frames`) or every pending frame was already shown
  (all-seen) — i.e. when there is no genuinely-new message to announce.
- **FR-002**: The SW MUST still show the generic placeholder when the preview produced no notes because
  a genuinely-new message could not be rendered: a fetched-but-undecryptable frame (`decrypt-failed`),
  a PIN-locked device (`locked`), a failed relay fetch (`relay-*`), or a decrypt still in flight at the
  generic deadline (`timedOut`).
- **FR-003**: On a "nothing new" push the SW MUST honor the per-push notification contract without a new
  banner: if a notification is already showing, re-assert it silently (no re-alert); otherwise show no
  notification — consistent with the existing mute / badge-only (`silenced`) path.
- **FR-004**: The app-icon badge MUST remain accurate across these paths (on-device unread plus the
  fetched pending backlog), unchanged by suppressing a spurious placeholder.
- **FR-005**: The existing behaviors MUST be preserved: the generic→rich-content upgrade, the
  straggler-refetch loop showing late frames once, the `suppressed` (notifications-off) and `silenced`
  (mute/badge-only) paths, and the spec-2014 dev-only diagnostic reasons.
- **FR-006**: Zero-knowledge unchanged: no plaintext leaves the device; the SW still only fetches the
  sealed ciphertext the relay already stores; no server change.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A push wake whose frames are all already shown produces no new generic placeholder (the
  burst extra-generic no longer occurs).
- **SC-002**: A push wake with zero pending frames (`no-frames`) produces no new generic placeholder.
- **SC-003**: A push wake with a genuinely-new undecryptable frame still produces the generic
  placeholder (no regression to the real fallback).
- **SC-004**: No regression to the notification / SW-decrypt / call e2e suites or the crypto unit suite;
  the badge stays accurate.

## Assumptions

- iOS tolerates a push handler that shows no NEW notification on a "nothing new" wake: the existing
  mute / badge-only (`silenced`) path already does exactly this in production, so reusing that outcome
  is safe. Re-asserting an existing notification silently is the strictly-safer choice when one is up.
- The fix is client-only; no server or schema change; the zero-knowledge boundary is unchanged.
