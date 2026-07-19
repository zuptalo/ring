# Feature Specification: Show-first notifications (work when locked, keep the subscription alive)

**Feature Branch**: `fix/2048-notifications-not-appear`

**Created**: 2026-07-19

**Status**: in-progress

**Input**: Methodical device testing isolated the real failure: on modern iOS/iPadOS,
message notifications work fine while the **screen is on** (even backgrounded/closed), but
once the **screen is locked and some time passes**, pushes are accepted and the service
worker wakes + fetches (server logs "delivered") yet **no notification renders** — and after
~4 such silent wakes iOS **revokes the subscription** (confirmed: `push: pruning dead
subscription status=410 reason="Unregistered"`; the 5th message never woke the device). Root
cause: when locked/idle, iOS gives the SW a very tight execution window; Ring's rich path is
too slow to call `showNotification` in time — it waits up to 2200ms for a live page to claim
(`pageWillNotify`), then fetches `/relay/pending` (bounded 8s), then decrypts, then shows.
The spec-2044 legacy path works because it shows FIRST. Extend show-first to the modern path.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A locked phone still shows notifications and keeps its subscription (Priority: P1)

Someone locks their phone, sets it down, and later receives messages. Each one shows a
notification on the lock screen (rich when there's time, a generic "New message" when deeply
throttled), and the subscription is never revoked.

**Why this priority**: This is the core failure — locked-phone notifications silently break
and then the subscription dies, cutting the user off entirely.

**Independent Test**: With the app not foreground-visible, a message push shows a
notification IMMEDIATELY (before the fetch/decrypt); a locked-state burst produces a visible
notification per wake (device test) and no `410 Unregistered` prune follows.

**Acceptance Scenarios**:

1. **Given** the app is backgrounded/closed and the screen is locked, **When** a message
   push wakes the SW, **Then** a placeholder notification is shown before any network fetch
   or decrypt, so the wake ends visibly within iOS's window.
2. **Given** the SW has time (screen on / generous budget), **When** the fetch+decrypt lands,
   **Then** the placeholder is upgraded to the rich "Sender: message" note.
3. **Given** a locked-state sequence of messages, **When** each push wakes the SW, **Then**
   each ends with a visible show → no silent-wake strikes → the subscription is not revoked.
4. **Given** a per-chat notification already shown, **When** more arrive, **Then** they
   coalesce (close-generic-then-show-rich / per-chat tag) without stacking noise.

### User Story 2 - Muted/notifications-off are still respected (Priority: P1)

Show-first must not turn a muted chat or a notifications-off account into a buzzing "New
message."

**Why this priority**: A fix that over-notifies muted chats trades one bug for another.

**Independent Test**: A muted chat's push (if it reaches the SW) ends as the quiet note, not
a loud generic; a notifications-off account suppresses the placeholder.

**Acceptance Scenarios**:

1. **Given** push routing suppresses muted/off pushes server-side, **Then** the SW never
   wakes for them and no placeholder is shown.
2. **Given** a muted-chat push still reaches the SW, **When** the decrypt settles and reports
   silenced, **Then** the loud placeholder is downgraded in place to the quiet note.

### Edge Cases

- App genuinely foreground + focused: the OS notification is shown anyway (revocation-safe);
  iOS suppresses the foreground app's own banner, and such an app usually gets no push at all
  (WS delivery). The page suppresses its duplicate in-app banner where it can.
- Deeply throttled: the placeholder stays generic until the app opens (rich content needs the
  fetch+decrypt, which the OS didn't allow time for) — acceptable; visible beats invisible.
- iOS wake-budget still throttles very rapid bursts (OS-level); show-first keeps the
  subscription alive so throttled messages arrive on the next wake/open, not lost.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: On a message push wake, the SW MUST call `showNotification` (a placeholder)
  BEFORE the page-claim wait, the `/relay/pending` fetch, and decryption — so a
  locked/low-power device shows within iOS's execution window.
- **FR-002**: The SW MUST NOT block the initial show on `pageWillNotify`'s wait when there is
  no focused+visible client; it may still nudge clients to drain without awaiting.
- **FR-003**: When the fetch+decrypt lands in time, the placeholder MUST be upgraded to the
  rich note (close generic tag, show per-chat rich note); when it reports silenced/muted, the
  placeholder MUST be downgraded to the quiet note; when notifications are off (suppressed),
  no placeholder is shown.
- **FR-004**: Every message wake MUST end visibly (or with licensed silence) so no wake
  counts as a silent push — preventing subscription revocation.
- **FR-005**: Show-first applies regardless of app foreground state (no on-screen exemption),
  because iOS revokes on silent wakes even when a window is visible.
- **FR-006**: The legacy lite path (iOS ≤ 16) and existing coalescing/dedup/badge semantics
  MUST NOT regress.

### Key Entities

- **Placeholder → rich upgrade**: an immediate generic notification (`GENERIC_TAG`) replaced
  by the per-chat rich note once decryption completes; downgraded to quiet if the chat is
  silenced.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A backgrounded/locked message push shows a notification before the fetch (unit:
  the show is issued before `previewPending`/fetch; device: a locked-state message appears).
- **SC-002**: A locked-state burst produces a visible notification per wake and **no `410
  Unregistered` prune** for the device afterward (device + prod-log verified).
- **SC-003**: Muted chats end quiet, notifications-off shows nothing (unit).
- **SC-004**: Existing suites (1190+) and the legacy path stay green.

## Zero-Knowledge Impact

None. Ordering/timing of client-side notification display only; no wire, payload, or metadata
change. The push stays the existing content-free tickle; content is still fetched over the
authenticated relay and decrypted locally. (A future ciphertext-in-push optimization is a
separate spec with its own metadata trade-off analysis.)

## Assumptions

- iOS grants a much shorter SW execution window when locked/idle; showing before the network
  fetch fits it, showing after does not (device-confirmed).
- The existing generic→rich upgrade and generic→quiet downgrade settle machinery (specs
  1034/2016/2017) can be driven from an earlier placeholder.
- Push routing (spec 1050) suppresses notifications-off/muted pushes server-side to the
  extent configured; the SW-side downgrade covers any that still arrive.
