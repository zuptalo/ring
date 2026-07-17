# Feature Specification: Notification tap opens the chat, not a stuck chat list

**Feature Branch**: `fix/2018-notification-tap-opens`

**Created**: 2026-07-04

**Status**: shipped
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: Bug report (real device, iOS installed PWA, dev build): "when I tap on a
notification, instead of it taking me directly to the chat it belongs to, it takes me to the
Chats list; tapping the chat it belongs to does nothing, but tapping any other chat works —
and tapping back from there lands me on the chat the notification was about."

## The bug

Tapping a message notification while the app is fully closed cold-starts the app. On iOS the
deep link can't ride the window-open call, so the service worker stashes the target and the
app routes there after unlock (`pending-nav`). The consume path (`App.vue routeRelevant`,
cold-start branch added in `ecdf5f3`, 2026-07-02) performs `router.replace('/tabs/chats')`
immediately followed by `router.push('/chat/<id>')`. Those awaits settle when **vue-router**
resolves — not when **Ionic's animated outlet transition** finishes. When the push fires
while the outlet is still rendering its first view, Ionic drops the second view swap:

- the URL (and router state) become `/chat/<id>`, but the **screen keeps showing the Chats
  list** — the reported landing;
- tapping the notification's chat is a push to the route already current → silent no-op;
- tapping any other chat is a different route → navigates fine;
- Back pops to the never-rendered `/chat/<id>` history entry → NOW it renders, which reads
  as "back takes me to the chat the notification was about".

Pre-existing (introduced by `ecdf5f3`, which fixed Back-underflow after a notification tap,
two days before spec 1032 merged). Spec 1032 made it near-deterministic: with messages
persisted at notification time and dev auto-unlock, the unlock watcher (`immediate: true`)
consumes the pending nav during component SETUP — before the app has even painted — so the
push lands inside the initial mount transition virtually every time.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A tapped notification lands IN the chat (Priority: P1)

I tap a message notification while the app is closed. The app opens showing that
conversation — the messages are on screen, not the chats list. Pressing back from there
returns me to the chats list (the `ecdf5f3` behavior this fix must preserve).

**Independent Test**: stash a pending-nav target for a chat with messages, cold-start the
app (reload), and assert BOTH that the URL is the chat's AND that the chat's messages are
actually rendered; then assert back returns to the chats list.

**Acceptance Scenarios**:

1. **Given** a pending-nav target `/chat/<id>` and a cold start, **When** the app finishes
   opening, **Then** the chat's messages are visible on screen and the URL matches — never
   a chats list rendered under a chat URL.
2. **Given** the app landed in the chat via a notification tap, **When** the user presses
   back, **Then** they land on the Chats list (no history underflow — regression guard for
   `ecdf5f3`'s original fix).
3. **Given** the app is already open when a notification is tapped (`ring:navigate` path),
   **Then** in-app navigation to the chat keeps working as today.

### Edge Cases

- Consume fires before the app has painted (fast dev auto-unlock, `immediate` watcher —
  the reported reproduction): navigation must wait for first paint.
- Platform that honors the deep link (window opens at `/chat/<id>` directly): the
  seed-Chats-beneath behavior must still produce [chats list ← chat] history without
  dropping the rendered view.
- Pending-nav to a non-chat target (`/tabs/contacts`, `/tabs/wall`): same rules.
- No pending nav / expired (60s TTL): nothing changes.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: After a cold start from a tapped notification, the rendered view MUST match
  the routed URL — the deep-link navigation may not be dropped by an in-flight view
  transition.
- **FR-002**: The cold-start deep link MUST wait for the app's first paint before
  navigating (the consume can run during component setup).
- **FR-003**: The Back behavior from `ecdf5f3` is preserved: first back from the deep-link
  target lands on the Chats list, never an underflow.
- **FR-004**: The live-app path (`ring:navigate`) and manual navigation are unchanged.
- **FR-005**: Regression coverage: an e2e that cold-starts with a stashed pending nav and
  asserts the rendered view (not just the URL) matches the target.

## Success Criteria *(mandatory)*

- **SC-001**: Notification tap → chat content visible on screen, 100% of tested cold
  starts (device + e2e).
- **SC-002**: Back from the notification-opened chat lands on Chats list.
- **SC-003**: All existing navigation/e2e suites stay green.

## Zero-Knowledge Impact *(constitution Principle I)*

None — client-side navigation timing only; nothing crosses the wire.

## Assumptions

- Hotfix scope: fix the navigation race; no changes to notification content, the SW, or
  the pending-nav storage contract.
- The headless e2e may not reproduce the exact device timing; the regression test pins the
  invariant (rendered view matches URL after a pending-nav cold start) and the fix is
  additionally verified on the reporting device before merge.
