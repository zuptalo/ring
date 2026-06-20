# Feature Specification: Reliable Push & Redesigned In-App Notifications

**Feature Branch**: `feat/1015-reliable-push-notifications`

**Created**: 2026-06-20

**Status**: in-progress
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "Evaluate and harden push notification delivery for both iOS and Android, ensuring web push notifications are reliably delivered. Add push notifications for the friendship-request lifecycle (request received, request accepted, request rejected). Ensure a notification is first visualized for the user and only then reported as delivered. Ensure encrypted messages are decrypted correctly and completely so the user sees actual message content in notifications. Redesign internal (in-app) notifications: translucent background in the greenish theme color, dismissible, positioned so they don't cover critical UI areas. Add a global on/off toggle for in-app notifications, plus per-chat in-app notification toggles. Add a per-chat notification privacy level (no web push for a chat, OR show message content, OR badge-count-only)."

## Overview

Ring already ships a notification stack: the server sends **content-free push
tickles** (`{"t":"msg"}` / `{"t":"call"}`), the service worker decrypts a
**read-only preview** to upgrade the generic "New message" into a rich one, an
in-app green banner system shows alerts while the app is open, and per-chat
**mute** exists. This feature **hardens that delivery path** so notifications
arrive reliably on iOS and Android, **closes coverage gaps** (no push today for
friend-request events; decrypted content sometimes falls back to generic), and
**adds user control**: a redesigned, dismissible, non-intrusive in-app banner; a
global in-app on/off switch; and per-chat controls for in-app notifications and
notification privacy.

The **zero-knowledge boundary is non-negotiable**: the server never learns who
notified whom about what, never sees message content, and the push tickle stays
content-free. All decryption and all preference enforcement happen on the client.

## Clarifications

### Session 2026-06-20

- Q: Per-chat notification privacy model — single graded menu or independent switches? → A: Orthogonal switches (web push on/off, in-app on/off, content visibility full/generic/none).
- Q: "Visualized first, then reported as delivered" — sender-facing receipt or internal reliability? → A: Internal reliability only — defer relay-ack until a notification is actually displayed; no sender-visible delivery-receipt change.
- Q: Where should the redesigned in-app banner be anchored? → A: Top, offset below the header (never covers the header/back control; also clears composer and call controls).
- Q: Do per-chat controls + delivery hardening apply to group chats too, or 1:1 only? → A: Both 1:1 and group chats.
- Q: When a chat has web push off (or is muted), should incoming calls still ring? → A: No — per-chat web-push-off / mute also silences that chat's calls.
- Q: How are friend-request lifecycle notifications governed in settings? → A: Always on, no setting (they always fire; not gated by a per-category toggle).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Reliable delivery with real content, never silently dropped (Priority: P1)

A recipient whose app is backgrounded or closed receives an incoming message.
Their device wakes, decrypts the message locally, and shows a notification with
the **actual sender name and message text** — not a generic "New message".
The incoming item is **not acknowledged/drained from the relay until a
notification has actually been displayed** (or the message rendered in an open
chat), so a notification is never silently lost. If the device is locked (cannot
decrypt) the notification still appears, but as a content-free "New message",
and the content is revealed once the key is available.

**Why this priority**: This is the core promise of a messenger — notifications
that arrive, every time, with the right content. Reliability + correct
decryption + not-dropping-until-shown is the MVP; everything else builds on it.

**Independent Test**: Background the app on an iOS and an Android device, send a
message from another account, and confirm a rich notification appears within a
few seconds. Force conditions where display could fail (locked, slow decrypt)
and confirm the item is not lost — it surfaces when possible. Lock the device
and confirm a generic fallback appears instead, with content revealed on unlock.

**Acceptance Scenarios**:

1. **Given** the recipient's app is backgrounded and the device is unlocked,
   **When** a 1:1 message arrives, **Then** a notification showing the sender's
   name and decrypted message text appears, and it replaces/suppresses any
   transient generic placeholder rather than showing two notifications.
2. **Given** the recipient's device is PIN-locked (no decryption key available),
   **When** a message arrives, **Then** a generic "New message" notification
   appears, and the decrypted content is shown once the device is unlocked.
3. **Given** the device received the push but has not yet displayed a
   notification, **When** the display step fails or is delayed (e.g. slow
   decrypt, transient error), **Then** the incoming item is **not** acknowledged
   or drained from the relay — it remains available and surfaces on the next
   opportunity, so notifications are never silently dropped.
4. **Given** the recipient is actively viewing the originating chat, **When** the
   message arrives, **Then** no redundant banner/system notification is shown
   (the message simply appears) and the item is reconciled normally.
5. **Given** decryption succeeds, **When** the notification renders, **Then** the
   full message text is shown (subject to length truncation), not a partial or
   corrupted preview.

---

### User Story 2 - Friend-request lifecycle notifications (Priority: P1)

When someone sends a connection (friend) request, the recipient is notified —
even if their app is closed — via web push, and sees it in-app if open. When the
recipient accepts or rejects a request, the original requester is notified of the
outcome the same way.

**Why this priority**: Today these events only deliver a live WebSocket frame, so
an offline user never learns about a pending request or a decision until they
happen to reopen the app. Push closes that gap and makes social connection feel
responsive.

**Independent Test**: With account B's app fully closed, have account A send a
friend request and confirm B receives a push notification. Then have B accept
(and in a separate run, reject) and confirm A — app closed — receives a push
reflecting the outcome.

**Acceptance Scenarios**:

1. **Given** account B's app is closed, **When** account A sends a connection
   request, **Then** B receives a push notification indicating a new friend
   request, which deep-links to the requests view on tap.
2. **Given** account A's app is closed and A has a pending outgoing request,
   **When** B accepts it, **Then** A receives a push notification that the
   request was accepted, deep-linking to the new contact/chat.
3. **Given** account A's app is closed, **When** B rejects A's request, **Then**
   A receives a notification that the request was declined (friend-request
   notifications always fire; they are not gated by a per-category setting).
4. **Given** the recipient's app is open, **When** any of these events occurs,
   **Then** an in-app banner is shown instead of (or in addition to, per
   settings) the system notification, with no duplicate alert.
5. **Given** the friend-request push, **When** it is delivered, **Then** the
   server still learns nothing about the identities beyond what connection
   routing already requires — no new plaintext about names or content crosses
   the wire.

---

### User Story 3 - Redesigned, non-intrusive, dismissible in-app banner (Priority: P2)

While the app is open, in-app notifications appear as a **translucent banner in
the app's greenish theme color**, positioned so it **does not cover critical UI**
(e.g. not over the top header/back button, the message composer, or call
controls). Each banner is **dismissible** by the user (swipe/tap-to-close) and
also auto-dismisses after a short time. Tapping it navigates to the relevant
chat/request.

**Why this priority**: The current banner is a solid green bar at the top that can
cover the header and feels heavy. A lighter, repositioned, dismissible banner
improves usability without changing what triggers a notification.

**Independent Test**: With the app open on a non-chat screen and again inside a
chat, trigger an incoming message and confirm the banner appears translucent in
the theme green, never overlaps the composer/header/call controls, can be
manually dismissed, and auto-dismisses if left alone.

**Acceptance Scenarios**:

1. **Given** the app is open, **When** a notification fires, **Then** the in-app
   banner is rendered with a translucent greenish background consistent with the
   app theme (and readable in both light and dark mode).
2. **Given** a banner is visible, **When** the user dismisses it (swipe or close
   affordance), **Then** it disappears immediately and does not reappear for the
   same event.
3. **Given** a banner is visible and untouched, **When** the auto-dismiss timeout
   elapses, **Then** it disappears on its own.
4. **Given** the user is inside a chat (composer visible) or on a call screen,
   **When** a banner appears, **Then** it does not overlap the composer, the top
   header/back control, or call controls.
5. **Given** multiple notifications arrive in quick succession, **When** banners
   stack, **Then** they remain readable and bounded in count, and none covers a
   critical control.

---

### User Story 4 - Global and per-chat in-app notification toggles (Priority: P2)

The user can turn **in-app notifications off globally** from settings. When on,
the user can additionally turn in-app notifications **off for a specific chat**
from that chat's settings, independent of the global system-push behavior.

**Why this priority**: Users want to silence in-app interruptions wholesale or
for noisy chats while still keeping the app and (optionally) system push working.

**Independent Test**: Toggle the global in-app switch off and confirm no in-app
banners appear for any chat while the app is open. Toggle it back on, disable
in-app for one specific chat, and confirm banners appear for other chats but not
that one.

**Acceptance Scenarios**:

1. **Given** the global in-app notifications setting is off, **When** any
   notifiable event occurs while the app is open, **Then** no in-app banner is
   shown (system push and badge behavior are unaffected by this switch).
2. **Given** the global in-app setting is on but a specific chat has in-app
   notifications disabled, **When** a message arrives for that chat while the app
   is open and the user is elsewhere, **Then** no in-app banner is shown for that
   chat, but other chats still banner normally.
3. **Given** in-app notifications are disabled for a chat, **When** the user opens
   that chat's settings, **Then** the current state is clearly reflected and can
   be changed back.

---

### User Story 5 - Per-chat notification privacy controls (Priority: P3)

For any individual chat the user can independently configure three orthogonal
controls: **web push** on/off (does the system notify when the app is closed),
**in-app banner** on/off (does an in-app banner appear when the app is open —
this is the per-chat toggle from US4), and **content visibility** (full content /
generic / none). "None" content visibility with both surfaces effectively means
**badge-only** — the unread count bumps with nothing revealed.

**Why this priority**: Independent switches give users granular control over
sensitive conversations (e.g. show nothing on the lock screen, just bump the
badge) without changing global defaults. It depends on the reliable-delivery and
content-decryption work in P1, so it lands last.

**Independent Test**: For one chat, turn web push off and confirm nothing arrives
while the app is closed (badge reconciles on open). Set content visibility to
"none" with surfaces on and confirm only the badge bumps. Set "generic" and
confirm a placeholder fires. Set "full" and confirm the decrypted preview
appears.

**Acceptance Scenarios**:

1. **Given** a chat has **web push off**, **When** the app is closed and a message
   arrives, **Then** no system push notification is shown for that chat; the
   unread count is reconciled the next time the app opens.
2. **Given** a chat has **content visibility = none** (with surfaces otherwise
   enabled), **When** a message arrives, **Then** the unread badge increases but
   no sender or message text is revealed in any banner or system notification
   (badge-only behavior).
3. **Given** a chat has **content visibility = generic**, **When** a notification
   fires, **Then** it shows a generic placeholder (e.g. "New message") with no
   sender text content.
4. **Given** a chat has **content visibility = full**, **When** a message
   arrives, **Then** the notification shows the decrypted sender name and message
   text (subject to the device being unlocked).
5. **Given** any per-chat control conflicts with a global setting, **When** the
   notification is evaluated, **Then** the **most private** outcome wins (a chat
   can be quieter than the global default, never louder than a global "off").
6. **Given** a chat has **web push off** or is muted, **When** an incoming call
   arrives for that chat while the app is closed, **Then** the call does not ring
   on this device (muting a chat silences its calls as well as its messages).
7. **Given** existing chats with no explicit per-chat controls, **When** the
   feature ships, **Then** they behave exactly as before (sensible defaults: web
   push on, in-app on, content full — no surprise change in noisiness).

---

### Edge Cases

- **PIN-locked device**: decryption key is unavailable → content notifications
  must gracefully fall back to a generic placeholder and reveal content on
  unlock, never show a broken/empty/garbled preview.
- **Duplicate suppression**: when both a live page and the service worker could
  notify, exactly one notification is shown (no double-alert), and the
  surviving one carries content if available.
- **Push fails or is throttled**: transient push failures retry with backoff;
  permanently dead subscriptions are pruned; the user still reconciles state
  (unread counts, pending requests) on next app open.
- **iOS quirks**: app-badge APIs and `pushsubscriptionchange` behave differently
  / unreliably on iOS — the design must tolerate this (re-assert subscription on
  foreground; badge on open where SW badging is unavailable).
- **Permission not granted / revoked**: if notification permission is denied,
  in-app banners and badges still function; the user is guided to enable system
  notifications where appropriate.
- **Friend-request decision races**: a request rejected and re-sent, or accepted
  on one device while another device is offline, must not produce contradictory
  or duplicate outcome notifications.
- **Privacy controls vs mute**: explicit per-chat privacy controls and the existing
  mute must compose predictably (most-private-wins) without one silently
  overriding the other in a surprising way. Muting / web-push-off silences both
  the chat's messages and its incoming calls.
- **Notification shown but app never opened**: the relay-ack deferral (the item
  staying available until a notification is displayed) must not get stuck — once
  a notification has rendered, the item is acknowledged even if the app is killed
  immediately afterward; if display never succeeds, the item still surfaces on
  next open rather than being dropped.

## Requirements *(mandatory)*

### Functional Requirements

**Reliable delivery & decryption (P1)**

- **FR-001**: The system MUST reliably deliver a notification for every incoming
  message to a recipient whose app is backgrounded or closed, on both iOS and
  Android, subject to the platform's push availability and the user's settings.
- **FR-002**: When the decryption key is available, notifications MUST show the
  actual decrypted sender identity and message content, not a generic
  placeholder.
- **FR-003**: Message decryption for notification preview MUST be correct and
  complete (full text, correct sender) and MUST NOT corrupt or advance
  durable message/session state (preview is read-only; the page remains the
  source of truth for persistence).
- **FR-004**: When content cannot be decrypted (e.g. device locked), the system
  MUST show a content-free generic notification and reveal the real content once
  the key becomes available.
- **FR-004a**: When decryption fails, errors, or yields partial/malformed content,
  the system MUST treat the item as undecryptable and fall back to the content-free
  generic notification — it MUST NOT display partial, truncated-mid-decode, or
  garbled text. (Length truncation of a *successfully* decrypted message for
  display is not "malformed" and is permitted.)
- **FR-005**: An incoming item MUST NOT be acknowledged/drained from the relay
  queue until a notification has actually been displayed to the recipient (or the
  message has been rendered in an open chat), so that a notification is never
  silently lost when display fails or is delayed. (This is an internal
  reliability guarantee; it introduces no sender-visible delivery-receipt
  change.)
- **FR-006**: When both a live page and the service worker can notify for the
  same event, the system MUST show exactly one notification (no duplicates) and
  prefer the content-bearing one.
- **FR-007**: The push payload crossing the server MUST remain content-free; all
  content shown in a notification MUST be produced by client-side decryption.
- **FR-007a**: No artifact introduced by this feature — server or client log line,
  metric, error payload, debug aid, or crash report — may contain decrypted
  message content, sender/requester identity, or any per-chat notification
  preference. Diagnostics MUST be limited to non-identifying, content-free signals
  (e.g. counts, tickle kind, opaque ids).

**Friend-request lifecycle (P1)**

- **FR-008**: When a connection (friend) request is created, the recipient MUST
  receive a push notification (when their app is not in the foreground) and an
  in-app banner (when it is). Friend-request lifecycle notifications always fire
  and are NOT gated by a per-category notification setting. The in-app banner
  remains subject to the **global in-app master switch** (FR-018): when in-app
  notifications are globally off, the friend-request **banner** is suppressed but
  the friend-request **web push still fires** ("not gated by a per-category
  setting" means there is no friend-request-specific on/off toggle, not that it
  overrides the global in-app master switch).
- **FR-009**: When a connection request is accepted, the original requester MUST
  be notified (push when closed, in-app when open) that it was accepted.
- **FR-010**: When a connection request is rejected, the original requester MUST
  be notified that it was declined. (Always fires; not gated by a setting.)
- **FR-011**: Friend-request notifications MUST deep-link to the relevant view
  (incoming requests, or the new contact/chat) when tapped.
- **FR-012**: Friend-request notifications MUST preserve the zero-knowledge
  boundary — no new user plaintext (names, content) is exposed to the server
  beyond what connection routing already requires.
- **FR-012a**: When the recipient of an inbound request has no locally known
  identity for the requester (not yet a contact), the notification MUST use a
  generic, identity-safe label (e.g. "New friend request") and MUST NOT surface a
  raw user id or any other identifier. Outbound accept/reject notices MAY name the
  peer when that name is already known locally to the requester.

**Redesigned in-app banner (P2)**

- **FR-013**: In-app notification banners MUST use a translucent background in the
  app's greenish theme color, legible in both light and dark themes.
- **FR-014**: In-app banners MUST be anchored at the top but offset **below the
  header** so they never cover critical UI controls — specifically the header
  title / back control, the message composer, and active-call controls.
- **FR-015**: Each in-app banner MUST be user-dismissible via an explicit
  affordance (e.g. swipe or close), in addition to auto-dismissing after a short
  timeout.
- **FR-016**: Tapping an in-app banner MUST navigate to the associated chat or
  request; dismissing it MUST NOT navigate and MUST NOT re-show for the same
  event.
- **FR-017**: Concurrent banners MUST remain bounded in count and readable, and
  none may cover a critical control.

**Global & per-chat in-app toggles (P2)**

- **FR-018**: The user MUST be able to turn in-app notifications on/off globally
  from settings; when off, no in-app banners appear **for any notifiable event,
  including friend requests** (system push and badge behavior are governed
  separately and are unaffected — friend-request web push still fires per FR-008).
- **FR-019**: The user MUST be able to turn in-app notifications on/off for an
  individual chat from that chat's settings, independent of the global system
  push behavior.
- **FR-020**: Per-chat in-app preferences MUST persist on the device and MUST be
  reflected accurately in the chat's settings UI. (This is the in-app-specific
  case of the general persistence requirement in FR-026.)

**Per-chat notification privacy controls (P3)**

- **FR-021**: The user MUST be able to configure, per chat, three orthogonal
  controls: **web push** on/off, **in-app banner** on/off (the same per-chat
  toggle as FR-019), and **content visibility** (full / generic / none). These
  controls, and the delivery/decryption hardening, MUST apply to **both 1:1 and
  group chats**.
- **FR-022**: **Web push off** MUST suppress system push for that chat while the
  app is closed; **in-app off** MUST suppress in-app banners for that chat; and
  **content visibility** MUST govern how much is shown when a notification does
  fire — full decrypted preview, generic placeholder, or nothing (badge-only).
- **FR-022a**: A chat with **web push off** (or an active mute) MUST also silence
  that chat's incoming **call** rings — i.e. muting a chat silences both its
  messages and its calls, for 1:1 and group calls alike. This is a **hard
  guarantee whenever the caller/chat is resolvable** (always true while the app is
  open/backgrounded with state available). When the app is fully closed and the
  service worker cannot resolve the caller from the content-free call tickle, the
  system MAY ring (**fail-open**, to avoid dropping a genuine time-sensitive call)
  and MUST reconcile the muted state once the app opens. This best-effort boundary
  for the fully-closed case MUST be documented as intended behavior, not a defect.
- **FR-023**: When per-chat and global settings conflict, the system MUST apply
  the **most private** outcome (a chat may be quieter than the global default,
  never louder than a global "off").
- **FR-024**: A chat configured to reveal **no content** MUST still update
  unread/badge counts while revealing no sender, content, or banner anywhere
  (including the lock screen). For the **closed app**, the service worker (woken by
  the content-free tickle the server must still send) MUST suppress the
  notification entirely — including the generic "New message" placeholder — when a
  badge-only / web-push-off / muted chat's message is all that is pending, while
  still bumping the badge. **Caveat**: if the SW cannot decrypt the queued frame
  (cold start / session not yet reachable) it cannot know which chat it belongs to,
  so it falls back to a single generic placeholder to honor the Web Push
  `userVisibleOnly` contract; the content is never revealed, and the placeholder is
  dropped once a later wake decrypts the frame and finds it silenced.
- **FR-025**: Chats with no explicit per-chat controls MUST retain current
  behavior by default (web push on, in-app on, content full), with no change in
  noisiness on upgrade. This "no change" guarantee covers the **new per-chat
  controls' defaults**; it does not override FR-022a — a chat that was **already
  muted** before upgrade additionally stops ringing calls, which is the intended
  extension of mute, not a regression.
- **FR-026**: Per-chat preferences MUST persist on the device and survive app
  restarts; their storage MUST NOT leak chat-level notification preferences to
  the server in plaintext.

**Cross-cutting**

- **FR-027**: All per-chat preferences (in-app toggle, web push, content
  visibility — see FR-019, FR-021, FR-026) and the existing mute MUST compose
  predictably and be individually inspectable from the chat's settings.
- **FR-028**: Notification behavior MUST honor an explicitly denied OS permission
  gracefully — the app keeps working, badges/in-app function where possible, and
  the user is guided to re-enable system notifications when relevant.

### Key Entities *(include if feature involves data)*

- **Notification event**: an incoming item that may notify — a 1:1/group message,
  a friend-request received, a friend-request accepted, a friend-request
  rejected, or a call. Carries the target (chat/request), a kind, and (when
  decryptable) a content preview.
- **Push subscription**: the per-device endpoint the server tickles; opaque to
  content, prunable when dead, re-asserted on foreground.
- **Per-chat notification preference**: device-local settings attached to a chat —
  web push on/off, in-app banner on/off, content visibility (full/generic/none),
  and the existing mute window — never synced to the server in plaintext.
- **Global notification settings**: existing settings tree plus a global in-app
  on/off switch; carries defaults that per-chat preferences can make stricter.
- **Relay acknowledgement**: the point at which an incoming item is drained from
  the relay queue — deferred until a notification has actually been displayed (or
  the message rendered), so nothing is lost. Internal only; not sender-visible.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In manual cross-device testing on a current iOS device and a
  current Android device, **100%** of messages sent to a backgrounded/closed app
  produce a notification — on Android typically within **≤10 s**; on iOS within
  the platform's best-effort Web Push wake (no hard SLA, as iOS push timing is not
  app-controllable) — across at least 20 trials per platform.
- **SC-002**: When the recipient's device is unlocked, **100%** of message
  notifications in testing show the correct sender and the actual (non-generic)
  message text, with the rich (decrypted) notification appearing within **≤2 s**
  of the wake on the device under test.
- **SC-003**: An incoming item is never acknowledged/drained before a
  notification was displayed (or the message rendered) — in fault-injection
  testing (locked device, slow/failed decrypt), **0** notifications are silently
  lost; every item eventually surfaces.
- **SC-004**: For every friend-request event (received / accepted / rejected) with
  the recipient's app closed, a corresponding push notification is delivered in
  **100%** of test trials.
- **SC-005**: In-app banners never overlap the header/back control, composer, or
  call controls in any tested screen/orientation (**0** overlap regressions), and
  every banner is dismissible.
- **SC-006**: Turning the global in-app switch off suppresses **100%** of in-app
  banners while leaving system push/badge behavior intact; per-chat in-app off
  suppresses banners for exactly that chat and no other.
- **SC-007**: For a chat with content visibility set to "none", **0**
  notifications reveal content (no banner, no system alert, no lock-screen text)
  while the unread badge still increments correctly.
- **SC-008**: No regression in the zero-knowledge boundary: in testing, the
  server transmits/stores **no** message content or chat-level notification
  preferences in plaintext (verified by inspecting wire payloads).
- **SC-009**: Duplicate notifications (page + service worker for the same event)
  occur in **0** of tested message-arrival scenarios.

## Assumptions

- **Most-private-wins** is the conflict-resolution rule between global and
  per-chat settings: a chat can be made quieter than the global default but never
  louder than a global "off".
- **Per-chat controls are orthogonal switches** (web push on/off, in-app on/off,
  content visibility full/generic/none) rather than a single graded menu;
  defaults are web push on, in-app on, content full, so upgrading users see no
  change in noisiness.
- The redesigned in-app banner is anchored at the **top but offset below the
  header** so it never covers the header title or back control, and is laid out
  to also clear the composer and call controls; exact pixel placement is a design
  detail for the plan, constrained by FR-014.
- **Friend-request push** reuses the existing content-free tickle mechanism with
  an added event kind; the client decides the user-facing text locally. The
  server may need to know only enough to route the tickle to the right
  device(s), consistent with how connection requests are already routed.
- Per-chat notification preferences are **device-local** (like the existing
  `mutedUntil`) and are not required to sync across a user's devices in this
  feature; cross-device sync of these preferences is out of scope for v1.
- "Visualized first, then reported as delivered" is interpreted as an **internal
  reliability** guarantee: the incoming item is not acknowledged/drained from the
  relay until a notification has actually been displayed (or the message
  rendered). It introduces **no** sender-visible delivery-receipt change.
- Platform support follows current Web Push availability: iOS requires an
  installed (home-screen) PWA for web push; where the platform cannot push,
  the app reconciles state on next open.
- Existing categories (messages, reactions, group, status, calls, badge mode,
  sounds/vibration) remain; this feature adds the global in-app switch, the
  per-chat in-app toggle, the per-chat privacy controls, and friend-request push,
  and hardens delivery/decryption rather than replacing the stack.

## Zero-Knowledge Impact

*(Required by Constitution Principle I.)*

- **What crosses the wire (new)**: one additional content-free push tickle,
  `{"t":"conn"}`, sent to a recipient's / requester's existing push subscription
  when a connection request is created, accepted, or rejected. It carries no
  names, no message content, and no request body — the same privacy class as the
  existing `{"t":"msg"}` and `{"t":"call"}` tickles. The push provider learns only
  that "a connection-related event occurred for this endpoint", which is the same
  metadata shape already accepted for messages and calls.
- **What is encrypted / unchanged**: message bodies stay sealed end-to-end. The
  notification content preview is produced by **client-side, read-only**
  decryption that never advances or persists ratchet state. No crypto primitive,
  key exchange, or ratchet changes.
- **What stays on the device**: all per-chat notification preferences (web push,
  in-app, content visibility) and the global in-app toggle live only in IndexedDB
  and are **never** sent to or stored by the server. "Web push off for this chat"
  is enforced on the client: the server still emits the content-free tickle
  (it cannot know per-chat preferences), and the service worker suppresses the
  user-facing notification locally while still updating the badge.
- **Metadata unavoidably visible**: the server already knows *that* user A
  requested/accepted/rejected a connection with user B, because connection routing
  requires it; this feature adds no new identity metadata and no message-content
  exposure. No telemetry, log line, or error payload introduced here exposes
  plaintext to the server.

## Out of Scope

- Native (non-PWA) iOS/Android push via APNs/FCM SDKs — Ring remains a PWA using
  Web Push.
- Cross-device sync of per-chat notification preferences.
- Quiet-hours / do-not-disturb scheduling, notification history/replay, and rich
  action buttons (quick-reply) inside system notifications.
- Changing the underlying crypto (X3DH / Double Ratchet / sender keys) — only the
  read-only notification preview path is in scope.
