# Feature Specification: Modern iPhones/iPads actually display push notifications

**Feature Branch**: `fix/2047-modern-iphones-and`

**Created**: 2026-07-19

**Status**: in-progress

**Input**: On modern iOS/iPadOS (iOS 26, iPadOS 27), background push notifications for
messages **silently fail to appear on the lock screen**, even though the service worker
wakes and fetches the message (the server logs a "delivered" receipt). Confirmed on two
different modern devices / two accounts, single clean wake. The failure is invisible
server-side. The spec-2044 legacy lite path (iOS ≤ 16) works fine — an iPhone 8 shows
generic notifications reliably. Root cause (investigation): the rich show
(`showNotes`, `sw.ts`) passes **`renotify: true`**, the one option the working generic
(`showGeneric`) omits; on the new OS a `renotify: true` `showNotification` is *accepted*
(the promise resolves) but *not rendered*. Because the spec-2043 guard infers "shown"
from the promise resolving (`ctx.shown/satisfied = true`), it never fires its last-resort
visible generic — so nothing appears at all, and diagnostics can't surface it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A message notification appears on a modern iPhone/iPad (Priority: P1)

Someone on iOS 26 / iPadOS 27 with Ring backgrounded receives a message and sees the
notification on their lock screen — the same as it already works on older iOS.

**Why this priority**: Background message notifications are silently broken for every
modern-iOS user; this is the core function of the app's push.

**Independent Test**: On a modern device, a single backgrounded message produces a visible
notification (device test). Unit: `showNotes` no longer passes `renotify` (the option that
doesn't render); the rich show's option set matches the proven-working generic's shape.

**Acceptance Scenarios**:

1. **Given** a modern-iOS device with Ring closed/locked, **When** a message push wakes the
   SW and it shows the rich note, **Then** the notification is visible on the lock screen.
2. **Given** a per-chat notification already on screen, **When** a new message arrives,
   **Then** it coalesces onto the same tag and remains visible (updated), not dropped.
3. **Given** the rich show fails for any reason, **When** the wake ends, **Then** the
   guard's last-resort generic is visible (the safety net actually displays).

### Edge Cases

- Older iOS (≤ 16) legacy lite path is unchanged (already works; uses `showGeneric`).
- A burst to one chat coalesces on the shared tag; without `renotify` iOS updates the
  notification in place rather than re-alerting each — acceptable (visible beats a
  re-buzz that renders nothing).
- iOS background-wake budget still throttles very rapid bursts (OS-level, out of scope).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The rich message show (`showNotes`) MUST NOT pass `renotify: true`; it relies
  on `tag` for per-chat coalescing, matching the option set that reliably renders on iOS
  (the working generic).
- **FR-002**: Every other content-carrying rich show that passes `renotify: true`
  (`showConnNotes`) MUST drop it for the same reason.
- **FR-003**: The last-resort guard generic and the quiet-note fallback MUST use an option
  set that iOS reliably displays, so the "always show something" invariant is real on
  modern iOS (the fallback that should catch everything must actually render).
- **FR-004**: Behavior on older iOS (≤ 16) and the coalescing/dedup semantics MUST NOT
  regress; only the non-rendering option is removed.

### Key Entities

- **Rich note show**: the per-chat message/connection notification whose options must stay
  within the iOS-renderable set.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a modern iOS/iPadOS device, a single backgrounded message produces a
  visible lock-screen notification (device-verified on the iPad and iPhone 15 Pro).
- **SC-002**: Unit tests assert no rich show passes `renotify: true`.
- **SC-003**: The legacy path and existing notification unit/e2e tests stay green.

## Zero-Knowledge Impact

None. This changes only client-side notification *display* options (`renotify`/`silent`);
no wire surface, no payload, no new data. Notification content is built the same way from
already-decrypted local data.

## Assumptions

- iOS 26 / iPadOS 27 accept-but-don't-render `renotify: true` (confirmed by contrast: the
  only option differing between the working generic and the failing rich show; to be
  device/Web-Inspector-verified).
- Coalescing via `tag` alone (no `renotify`) still displays and updates the per-chat
  notification, as the generic path already does.
