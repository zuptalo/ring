# Feature Specification: Push zombie subscriptions & silent-wake strikes

**Feature Branch**: `fix/2043-push-zombie-subscriptions`

**Created**: 2026-07-18

**Status**: in-progress
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: A brand-new iPhone 15 (iOS 26.5.2, installed PWA, backgrounded) received a
burst of messages but showed **no notification at all**. Live investigation on prod
(`ring.zuptalo.com`) found this is fleet-wide: **13 of 37 push subscriptions (35%)** carry
`relay_queue` frames the device never acked (some stacked since mid-June) while the push
service keeps 201-accepting every send. The subscriptions are **zombies** — iOS/Chromium
silently revoked delivery after ~3 push wakes that didn't end in `showNotification`, but the
push service still returns 201, so the server sees "delivered" and never prunes.

## Clarifications

### Session 2026-07-18

- Q: How old must the oldest queued frame be (no push wake since) before force-rotating as a zombie? → A: 10 minutes (matches the existing stale-drain bar; a held push to a live sub has landed by then, so a merely-offline device won't false-rotate).
- Q: What retry cap should the force-rotate self-heal use, separate from the existing 24h drain-rotation cap? → A: 2 hours (a device that rotates onto another dead endpoint retries within the day, while a single foreground can't thrash subscriptions).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - New device keeps receiving notifications through a burst (Priority: P1)

A person installs Ring on a fresh phone and a friend sends several messages in quick
succession while the app is backgrounded. Every message produces a visible notification, so
the subscription never accrues a silent-wake strike and is never revoked.

**Why this priority**: This is the acute regression — a rapid burst to a cold device is the
exact shape that strikes out a fresh subscription within its first hour (confirmed on device
`1d0ca925`). If the burst still produces silent wakes, every new device keeps going dark.

**Independent Test**: Drive overlapping `push` events into the SW (5-message burst,
recipient backgrounded) and assert **every** event ends with an accepted `showNotification`
— no event completes silently.

**Acceptance Scenarios**:

1. **Given** two overlapping push events where the later event's notification resolves before
   the earlier event times out, **When** the earlier event's handler ends, **Then** it still
   shows its own notification (its fallback is not suppressed by the sibling's show).
2. **Given** a push handler that resolves cleanly without showing anything and without a
   licensed-silence outcome, **When** the wake ends, **Then** a backstop notification is
   shown.
3. **Given** a wake on a platform/state where silence is licensed (`mayEndWakeSilently`),
   **When** the wake ends silently, **Then** no backstop fires (the exemption is preserved).

### User Story 2 - An already-zombie device heals itself on next open (Priority: P1)

A device whose subscription was silently revoked in the past (the push service still 201s,
but nothing ever wakes it) recovers automatically the next time the person opens the app: it
detects that the server holds messages it never woke for and rotates to a fresh
subscription, after which notifications resume.

**Why this priority**: 35% of the live fleet is currently in this state and cannot recover
today (the existing evidence-based rotation can't match a never-woken or fresh-burst
subscription). Without this, the 13 stuck devices stay dark forever.

**Independent Test**: Seed a device with `lastWakeAt=0` and a server queue whose oldest frame
is >10 min old; on foreground, assert it force-rotates the subscription (fresh endpoint
registered) exactly once, then respects the short retry cap.

**Acceptance Scenarios**:

1. **Given** the server reports queued frames older than the zombie bar and no push wake
   since they queued, **When** the app foregrounds, **Then** the client unsubscribes and
   re-subscribes to a fresh endpoint and registers it.
2. **Given** a merely-offline device whose held push lands and stamps a fresh wake, **When**
   it foregrounds, **Then** it does **not** rotate (no false positive).
3. **Given** a device that just force-rotated, **When** it foregrounds again within the cap,
   **Then** it does not rotate again.

### User Story 3 - We can see why a device fell silent (Priority: P2)

Operators can measure the zombie-fleet size over time, and a person debugging on a real
production device can turn on a diagnostic that reveals *why* a notification fell back to
generic — without any message content leaving the zero-knowledge boundary.

**Why this priority**: This class of bug has recurred across 6+ specs precisely because it is
invisible on real iOS devices. Measurement + on-device reason codes let us confirm the fix
and catch regressions.

**Independent Test**: Run the server sweep and assert a `push: zombie fleet` count is logged;
enable the diagnostic setting and assert the on-device wake ledger records content-free
outcome entries and the generic body surfaces a reason code.

**Acceptance Scenarios**:

1. **Given** the hourly sweep runs, **When** it completes, **Then** it logs the count of
   recipients holding a subscription plus stale unacked backlog.
2. **Given** the diagnostic setting is on, **When** a wake falls back to generic, **Then** the
   notification body shows a content-free reason code and the wake ledger records
   `{ts,kind,outcome,count}` only.

### Edge Cases

- Queue age is reported but `lastWakeAt` is newer (offline phone caught up) → no rotation.
- `/relay/status` fetch fails or times out → heal is a no-op (best-effort), never blocks UI.
- Rotation lands on another dead endpoint → the 2h cap (not 24h) allows a retry next session.
- Every frame in a burst is muted/hidden/badge-only → each wake still ends visibly (quiet
  note) or with licensed silence; never a bare silent completion.
- Reassigning `showNotification` is blocked by the platform → per-event tracking still works
  (attribution moved off the global wrapper).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A push wake MUST NOT complete without either an accepted `showNotification` or a
  `mayEndWakeSilently`-licensed silent outcome — tracked **per event**, so one event's show
  can never suppress another event's fallback.
- **FR-002**: When a push handler resolves cleanly having neither shown nor licensed silence,
  the system MUST show a backstop notification.
- **FR-003**: The server MUST expose queued-frame age + count for the authenticated recipient
  via a side-effect-free endpoint that emits no delivery receipts and returns no payload.
- **FR-004**: On foreground/reconnect, the client MUST detect a likely-zombie subscription
  from server queue age (oldest queued frame older than the **10-minute** zombie bar with no
  push wake since) independent of decryption, WS drain, or a push wake, and force-rotate the
  subscription, bounded by a **2-hour** retry cap distinct from the existing 24h drain cap.
- **FR-005**: The force-rotation MUST reuse the existing unsubscribe→subscribe→register path
  and carry no message data.
- **FR-006**: The server MUST periodically log the count of recipients holding a push
  subscription plus stale unacked relay backlog (zombie-fleet size).
- **FR-007**: The client MUST keep a bounded on-device wake ledger of content-free entries
  (enum kind, enum outcome, count, timestamp) — no sender, body, or tag.
- **FR-008**: A production device MUST be able to opt into surfacing content-free fallback
  reason codes for diagnosis, off by default.
- **FR-009 (zero-knowledge)**: Every new surface MUST remain content-free — `/relay/status`
  returns a timestamp + count only; the ledger and diagnostic carry no plaintext.

### Key Entities

- **Zombie subscription**: a push subscription the upstream service still 201-accepts but the
  device never wakes for; observable server-side as a recipient with a subscription plus
  stale unacked `relay_queue` frames.
- **Wake ledger entry**: `{ ts, kind, outcome, count }` — content-free record of one push
  wake's outcome, capped ring buffer in device settings.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a 5-message burst to a backgrounded fresh device, **100%** of push events end
  with an accepted `showNotification` (zero silent completions in the unit/e2e harness).
- **SC-002**: The prod zombie-fleet count (recipients with a subscription + unacked backlog
  older than 24h) drops from **13** toward 0 as devices foreground after the fix.
- **SC-003**: A device seeded with `lastWakeAt=0` and an old server queue force-rotates
  exactly once per retry-cap window, and a caught-up offline device never rotates.
- **SC-004**: No new surface transmits or stores message plaintext (verified by the required
  zero-knowledge checklist).

## Zero-Knowledge Impact

*What crosses the wire, what is encrypted, what metadata is unavoidably visible, and why.*

- **New endpoint `GET /v1/relay/status`** returns only `{ oldestQueuedAtMs, count }` — a
  server-side timestamp and an integer. No payload, ciphertext, sender, or message id leaves
  the server. Both values derive from `relay_queue` columns the server already holds
  (`created_at`, row count) to relay at all; this exposes no new metadata beyond what queuing
  inherently requires, and strictly less than the existing `GET /v1/relay/pending` (which
  returns the ciphertext frames). It is side-effect-free (no dequeue, no delivery receipt).
- **Server zombie-fleet log** (`push: zombie fleet`, recipients=N) is an aggregate count of
  distinct recipients with stale unacked backlog. No user id, endpoint, or content is logged.
- **On-device wake ledger** (`push.wakeLedger`) stores only `{ ts, kind, outcome, count }` —
  an enum tickle kind, an enum outcome, an integer, a timestamp. It never records sender,
  message body, chat id, or tag, and never leaves the device (surfaced only in the local
  diagnostics view / dev test hook).
- **Production diagnostic** (`diagnostics.pushReasonText`, off by default) surfaces the
  existing content-free fallback reason token (e.g. `timeout`, `clean-resolve-no-show`, an
  error message) in the generic notification body — the same class the spec-2014 dev-host
  reason gate already showed. It never reveals who messaged or what was said.
- **Force-rotation** is a `pushManager` unsubscribe→subscribe→register round trip carrying no
  message data; the server row is replaced under the existing single-subscription-per-user
  design.
- **Nothing decrypts on the server**, and no plaintext enters any log, metric, error payload,
  or migration. The push tickle itself remains the existing content-free type; this spec adds
  no plaintext to it.

## Assumptions

- iOS/WebKit and Chromium both revoke `userVisibleOnly` subscriptions after repeated
  no-`showNotification` wakes, and continue to return 201 afterward (zombie) — cured only by
  a client-side re-subscribe.
- `relay_queue` rows are deleted on ack (with a 35-day sweep backstop), so remaining rows
  represent frames the recipient never drained.
- The single-active-subscription-per-user server design (one row, upsert on rotate) is
  retained; a fresh endpoint replaces the prior row.
- Existing SW hardening (specs 1034/2016/2017/2023) and the `push.ts` rotate/unsubscribe
  machinery are reused, not replaced.
