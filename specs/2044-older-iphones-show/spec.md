# Feature Specification: Legacy-iOS lite push path — older iPhones always show a notification

**Feature Branch**: `fix/2044-older-iphones-show`

**Created**: 2026-07-19

**Status**: in-progress
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: After spec 2043 (v1.0.5) fixed silent-wake strikes and zombie recovery —
verified working on iPhone 15 / 15 Pro — the **iPhone 8 (iOS 16.7)** still shows no
notifications and loses its subscription. Decisive evidence: senders receive **delivered
receipts for the first 3–4 messages** (the SW wakes and the `/relay/pending` fetch
succeeds — the server emits `delivered` on fetch), then nothing visible appears and iOS
kills the subscription on the ~4th silent strike. The failure is *after* the fetch, in
the decrypt/store/present stage: SW-context IndexedDB on iOS 16.x hangs or throws, and
the rich pipeline (device unlock, settings reads, decrypt, show) dies silently. Recon
also found a 2043 regression hazard: `showGeneric` now awaits an IDB read before its
`showNotification`, so on a hung-IDB device even the timeout generic and the 20s
last-resort fallback can hang.

## Clarifications

### Session 2026-07-19

- Q: Which iOS versions get the lite path? → A: iOS 16 and older (`LEGACY_IOS_MAX_MAJOR = 16`).
  iPhone 8 tops out at 16.7; iOS 17+ keeps the rich path (proven butter-smooth on 15/15 Pro).
  No kill-switch setting — minimal surface.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An old iPhone always shows a notification and keeps its subscription (Priority: P1)

Someone on an iPhone 8 (iOS 16.x) receives messages while Ring is backgrounded. Every
push produces a visible generic "New message" immediately, senders still get their
delivered ticks, and the subscription is never struck out. Opening the app pulls the
real messages in (cold open accepted on this tier).

**Why this priority**: This tier currently loses push entirely — every burst kills the
subscription. A guaranteed-visible generic beats rich-but-dead.

**Independent Test**: With a legacy-iOS UA, drive a msg wake: assert the generic shows
BEFORE any IndexedDB/decrypt work, the pending fetch still fires (delivered receipts),
and the wake ends shown.

**Acceptance Scenarios**:

1. **Given** a legacy-iOS device with Ring backgrounded, **When** a message push
   arrives, **Then** a visible generic notification is shown before any IndexedDB or
   decrypt work is attempted, and the wake ends shown.
2. **Given** the same device, **When** the SW fetches the pending queue after showing,
   **Then** senders receive delivered receipts and no frames are acked or dequeued.
3. **Given** a rapid burst, **Then** the generics collapse onto one self-replacing tag
   (no stacking) and every wake still ends visibly.
4. **Given** an incoming call push on legacy iOS, **Then** the generic ring shows
   without any prior IndexedDB read and the caller's UI flips to "Ringing" (ack fires).

### User Story 2 - Modern devices are completely unaffected (Priority: P1)

Users on iOS 17+ / Android / desktop keep the exact rich-notification behavior shipped
in v1.0.5 — same code path, same output.

**Why this priority**: The current modern flow is verified working in production; the
hard requirement is zero risk to it.

**Independent Test**: A UA-corpus unit test pins the legacy detector to `false` for
every modern UA (iOS 17/26 PWA, Android Chrome, desktop browsers, iPadOS-Macintosh) —
the lite branch is unreachable for them.

**Acceptance Scenarios**:

1. **Given** any modern UA from the corpus, **When** the detector runs, **Then** it
   returns false and `dispatchPush` takes the identical pre-2044 path.
2. **Given** an unparseable or unknown UA, **Then** the detector fails toward modern
   (never lite).

### User Story 3 - The last-resort generic can never hang on a broken database (Priority: P1)

On ANY device whose SW IndexedDB hangs, the fallback generic still shows: the
diagnostics-reason read inside `showGeneric` is time-bounded and fails toward plain
"Tap to open".

**Why this priority**: This is a live 2043 regression hazard — the guard's fallback is
`showGeneric`, and an unbounded IDB read inside it re-creates the exact silent wake the
guard exists to prevent.

**Independent Test**: Unit test with a never-resolving settings read: `showGeneric`'s
show call still happens within the bound.

**Acceptance Scenarios**:

1. **Given** a hung settings read, **When** `showGeneric(reason)` runs, **Then**
   `showNotification` is still called within ~300ms with the plain body.

### Edge Cases

- Reminder call tickle on legacy iOS re-rings generically (no `readRingShown` dedup) —
  accepted: an extra audible ring beats a missed call on this tier.
- Legacy msg wake with a hung `keystore` read: the 3s token race lapses → no fetch this
  wake (no delivered receipts) — but the notification already showed; receipts arrive on
  the next successful wake or app open (fetch is idempotent).
- Old iPads reporting Macintosh UAs are not detected as legacy → they keep the modern
  path (today's behavior; documented limit, no regression).
- `stampPushWake` put hangs on legacy: `push.lastWakeAt` stays stale → the page-side
  zombie heal may rotate that sub at most once per 2h — acceptable churn on a tier iOS
  was killing anyway.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A pure UA detector MUST classify iOS ≤ 16 devices as legacy and everything
  else (including unparseable UAs) as modern, with a unit-tested truth table.
- **FR-002**: On legacy devices, every push wake MUST show its visible notification
  BEFORE any IndexedDB read/write, decrypt, or unlock attempt (the shared prologue's
  already-bounded wake stamp excepted).
- **FR-003**: On legacy devices, the msg wake MUST still fetch the pending queue
  (bounded token read + bounded fetch) so senders receive delivered receipts, and MUST
  NOT ack/dequeue frames (the page drains durably on open).
- **FR-004**: On legacy devices the SW MUST NOT attempt authoritative drain, preview
  decrypt, shown-ledger writes, settle/straggler upgrades, or badge math.
- **FR-005**: The page-claim arm (app open, page renders the alert) MUST keep its
  existing behavior on legacy devices (it is already IDB-free).
- **FR-006**: `showGeneric`'s diagnostics-reason read MUST be time-bounded (~300ms) on
  all devices, failing toward the plain body — a hung database can never block the
  last-resort show.
- **FR-007**: The legacy branch MUST be reachable only via the pure detector; modern
  devices' instruction path stays identical to v1.0.5 except FR-006 (strictly safer).
- **FR-008 (zero-knowledge)**: The lite path adds no new wire surface and transmits
  strictly less than the rich path (no decrypt attempted, same content-free tickle,
  same fetch endpoint).

### Key Entities

- **Legacy device**: a WebKit UA whose parsed iOS major version is ≤ 16.
- **Lite wake**: a push wake that ends visibly using only IDB-free primitives plus at
  most one bounded `keystore` token read and one bounded network fetch.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a legacy device, 100% of backgrounded pushes produce a visible
  notification (device test: iPhone 8 burst — no strike-out, subscription survives).
- **SC-002**: Senders receive delivered receipts for messages pushed to a backgrounded
  legacy device (observed as receipts before the recipient opens the app).
- **SC-003**: The detector truth-table test proves every modern-corpus UA takes the
  unchanged path; full existing test suite stays green.
- **SC-004**: With a simulated hung settings read, `showGeneric` still shows within its
  bound (unit-tested).
- **SC-005**: Prod: `f88bf032` (iPhone 8) stops accumulating stale frames and stops
  losing/rotating its subscription after test bursts.

## Zero-Knowledge Impact

*What crosses the wire, what is encrypted, what metadata is unavoidably visible, and why.*

- No new endpoints, payloads, or fields. The lite path uses the existing content-free
  push tickle and the existing authenticated `GET /v1/relay/pending` fetch — and sends
  strictly LESS than the rich path (it never attempts decryption, so no unlock material
  is touched in the SW at all on this tier).
- The generic notification is content-free by construction ("New message" / "Tap to
  open") — no sender, no body.
- No new logging, metrics, or storage on either side. Server untouched.

## Assumptions

- iOS 16.x SW-context IndexedDB/decrypt flakiness is an OS-level condition we route
  around, not fix (out of scope: rich previews on that tier).
- The `keystore` session-token read works on the affected device class (proven: the
  delivered receipts observed require it), so the bounded fetch is viable.
- The existing per-event guard (`runGuardedWake`, spec 2043) remains the backstop for
  the lite path exactly as for the rich path.
