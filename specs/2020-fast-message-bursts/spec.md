# Feature Specification: Fast message bursts stop showing duplicate notifications

**Feature Branch**: `fix/2020-fast-message-bursts`

**Created**: 2026-07-04

**Status**: shipped

**Input**: Bug report (iOS installed PWA): sending 1..10 quickly produced banners "2", then
a count summary, then "10" — but Notification Center held ~10 entries including the same
content repeated (three "(2)"s, two "(10)"s, a duplicated "6"). "When messages come in
fast, we show a notification for the same message more than once."

## What actually happens

The server sends one content-free push per message. Apple delivers them with lag, so one
wake often drains SEVERAL queued messages (showing the latest body + a count), and the
wakes for the already-drained pushes find nothing new. iOS requires each push wake to
present something, so those wakes re-assert the existing notification "silently" — but iOS
renders every showNotification call as a visible banner AND keeps each as a separate
Notification Center entry (same-tag replacement doesn't collapse history there). Net: the
same body/count is visibly repeated once per superfluous wake.

## Requirements

- **FR-001**: The server debounces MESSAGE push tickles per recipient with a trailing
  edge: a burst within the window yields at most one leading and one trailing tickle, and
  the LAST message of a burst always produces (or is covered by) a wake.
- **FR-002**: Other tickle kinds (call, conn, post, post-activity, version) are NOT
  debounced; calls especially must never be delayed.
- **FR-003**: The client shows nothing on a nothing-new wake whose coalesced notification
  is VISUALLY IDENTICAL (same conversation, body, and count) to what is already displayed;
  a changed body/count still re-asserts.
- **FR-004**: No message is ever silently missed: a debounced tickle's messages are always
  covered by the burst's leading/trailing wake (the worker drains the whole queue on any
  wake), and delivery/badging semantics are unchanged.
- **FR-005**: The push payload stays content-free; the debounce changes only tickle timing.

## Success Criteria

- **SC-001**: A 10-message burst produces at most a handful of wakes, each showing NEW
  content (body or count changed) — no visibly repeated identical banner, on-device.
- **SC-002**: The last message of any burst is always announced within ~the debounce
  window.
- **SC-003**: A single isolated message still notifies immediately (no added latency).
- **SC-004**: Calls ring instantly during a message burst (no cross-kind interference).

## Zero-Knowledge Impact *(constitution Principle I)*

None. The tickle payload is unchanged (content-free); the server debounce only changes
WHEN tickles are sent, using knowledge it already has (that it relayed messages to a
recipient). The client change is display-only.

## Assumptions

- Debounce window ~2s: long enough to fold a fast burst, short enough that a trailing
  message is announced promptly. Tunable constant.
- Skipping the showNotification call on a visually-identical nothing-new wake is the same
  iOS-tolerated outcome class as the existing mute/badge-only paths (spec 2016 precedent);
  the browser-vendor risk of repeated silent wakes is accepted and monitored on the soak
  device.
- iOS's refusal to collapse same-tag history entries in Notification Center is a platform
  behavior we reduce (fewer shows) but cannot eliminate.
