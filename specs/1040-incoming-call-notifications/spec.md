# Feature Specification: Incoming Call Notifications — Caller Identity, Badge, and Missed-Call Trace

**Feature Branch**: `feat/1040-incoming-call-notifications`

**Created**: 2026-07-12

**Status**: planned
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "Incoming call notification improvements. (1) When a call comes in while the app is closed or backgrounded, the app icon badge count should increase by one because the incoming call is new activity — but only once for the first call notification of that call; subsequent/repeated notifications for the same ringing call must not increment the badge again. (2) If the user opens the app (by tapping the call notification or opening it directly), further push notifications for that call should stop, and the call's badge increment should be removed so only unread message counts remain on the app badge. (3) When a call is missed — either the user never opened the app, or opened it but chose not to answer — it must be logged as a missed call with a visible trace: in the 1:1 chat with the caller for direct calls, in the group chat the call was started from for group calls, and in the Calls tab for group ad-hoc calls. The point is there must always be a trace of missed calls. (4) The OS notification for an incoming call currently shows no detail about who is calling; it should show caller identity, e.g. 'Kamran is calling you' with a video emoji or audio emoji depending on call type, so the user knows what's happening directly from the notification."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Know who is calling from the notification (Priority: P1)

Sara's phone is in her pocket with Ring closed. Kamran video-calls her. The
notification that appears on her lock screen reads "📹 Kamran is calling you"
instead of today's anonymous "Incoming call — Tap to answer". For a group call
started from the "Weekend Trip" group, the notification names the group and,
when known, who started it (e.g. "🎙️ Kamran is calling in Weekend Trip"). Sara
can decide whether to grab the phone without unlocking anything.

**Why this priority**: This is the moment-of-truth interaction of a calling
app. An anonymous ring forces the user to open the app just to find out who
wants them, and makes the notification indistinguishable from spam. It is also
the piece users notice on every single call.

**Independent Test**: Close the app on device B, call it from device A as a
named contact (audio, then video, then from a group). Inspect the OS
notification text on B in all three cases.

**Acceptance Scenarios**:

1. **Given** the app is closed or backgrounded and the caller is a saved
   contact, **When** an audio call arrives, **Then** the notification shows the
   caller's display name and an audio indicator (e.g. "🎙️ Kamran is calling
   you").
2. **Given** the same state, **When** a video call arrives, **Then** the
   notification shows the caller's name and a video indicator (e.g. "📹 Kamran
   is calling you").
3. **Given** a group call started from a group the user is a member of,
   **When** the ring arrives, **Then** the notification names the group (and
   the initiator when known) plus the call-type indicator.
4. **Given** the caller's identity cannot be determined on the device in time
   (unknown sender, identity not yet resolvable), **When** the ring arrives,
   **Then** the notification falls back to today's generic "Incoming call" —
   the ring alert itself is never delayed or dropped waiting for identity.
5. **Given** the call comes from a chat the user has hidden behind their
   hidden-chats PIN, **When** the ring arrives, **Then** the notification stays
   generic and does not name the caller or group.

---

### User Story 2 - Every missed call leaves a trace (Priority: P2)

Kamran calls Sara while her phone sits silent in a drawer with Ring closed all
day. When she opens Ring that evening, she finds a "Missed call" entry in her
1:1 chat with Kamran and in the Calls tab — even though the app never ran while
the call was ringing. The same holds when she saw the ring and chose not to
answer, and for group calls (trace in the group chat) and ad-hoc group calls
with no originating group chat (trace in the Calls tab).

**Why this priority**: Today a call that rings only as a notification while the
app stays closed can vanish without a record, so the callee never learns anyone
tried to reach them. A messenger that silently loses missed calls breaks trust;
this closes the gap for every path a call can go unanswered.

**Independent Test**: With the app on device B fully closed, call it from
device A and let the ring expire. Open B afterwards and verify the missed-call
entry appears in the 1:1 chat and the Calls tab. Repeat for a group call and
for an ad-hoc group call.

**Acceptance Scenarios**:

1. **Given** the app was closed for the entire ring and the call was never
   answered, **When** the user next opens the app, **Then** a missed-call entry
   for that call appears in the 1:1 chat with the caller and in the Calls tab.
2. **Given** the user saw the incoming-call screen in the app and declined or
   ignored it until it timed out, **Then** the call is recorded with the
   appropriate existing outcome ("Missed call" / "Declined") in the same
   places.
3. **Given** a group call started from a group chat goes unanswered, **Then**
   the trace appears in that group chat and in the Calls tab.
4. **Given** an ad-hoc group call with no originating group chat goes
   unanswered, **Then** the trace appears at least in the Calls tab.
5. **Given** the call was answered on another of the user's devices or the
   caller cancelled before the ring window ended, **Then** it is not recorded
   as missed on this device beyond the existing behavior for those outcomes.
6. **Given** a new missed-call entry exists and has not been seen, **Then** it
   counts toward the existing Calls-tab missed badge until viewed, exactly as
   live-logged missed calls do today.

---

### User Story 3 - A ringing call badges the app icon once (Priority: P3)

Kamran calls Sara while Ring is closed. Her app icon badge, which read "2" for
two unread messages, now reads "3" — the ringing call is new activity. The ring
re-alerts a few times while unanswered, but the badge stays at "3"; repeated
notifications for the same call never inflate the count.

**Why this priority**: The badge is the at-a-glance "something happened"
signal. Without the call contribution, a user who misses the transient
notification sees no evidence anything occurred; but a badge that climbs with
every re-ring would overstate one call as many events.

**Independent Test**: Note the badge count on device B with the app closed.
Call from device A, let it re-alert at least twice, and confirm the badge rose
by exactly 1 over the whole ring.

**Acceptance Scenarios**:

1. **Given** the app is closed or backgrounded with N standing badge items,
   **When** the first notification for an incoming call arrives, **Then** the
   app icon badge shows N+1.
2. **Given** the same call re-alerts (repeated ring notifications for the same
   call), **Then** the badge remains N+1 — no further increments.
3. **Given** two distinct incoming calls ring while the app stays closed,
   **Then** each contributes one increment (N+2).
4. **Given** the ring ends unanswered while the app stays closed, **Then** the
   badge does not double-count the same call as both "ringing" and "missed":
   the total call-related contribution for that call is one until the user
   sees it.

---

### User Story 4 - Opening the app clears the ring's notification footprint (Priority: P4)

Sara hears the ring and opens Ring — by tapping the call notification or just
launching the app. The in-app incoming-call screen takes over: the OS
notification for that call is dismissed, no further notifications for that call
appear, and the badge increment the ringing call added is removed, leaving only
the unread counts that were already standing.

**Why this priority**: Follow-through on stories 1 and 3 — stale call
notifications and a leftover badge after the app is already handling the call
read as bugs, but this only matters once those stories exist.

**Independent Test**: With a call ringing and the badge incremented, open the
app. Verify the OS call notification is gone, no new ones appear while the
in-app ring continues, and the badge reverts to the pre-call unread count.

**Acceptance Scenarios**:

1. **Given** a call notification is showing and the badge is incremented,
   **When** the user opens the app (via the notification or directly),
   **Then** the OS call notification for that call is dismissed and no further
   OS notifications for that call are shown while the app is handling it.
2. **Given** the app has been opened during the ring, **Then** the badge drops
   the ringing-call increment and reflects only the standing unread/missed
   counts.
3. **Given** the user opened the app during the ring but let the call go
   unanswered anyway, **Then** the missed-call trace (User Story 2) is still
   recorded and the existing unseen-missed-call badge behavior applies from
   that point.

---

### Edge Cases

- Caller is not a saved contact and no display identity is resolvable on the
  device → generic notification (US1 scenario 4); never show a raw user id.
- Call from a hidden chat (hidden-chats PIN feature) → generic notification, no
  identity leak on the lock screen; hidden-call exclusions from the Calls tab
  and badges continue to apply to the missed-call trace.
- Identity resolution is slower than the ring alert → show generic immediately
  or upgrade the same notification when identity resolves; never delay the
  first alert.
- Two calls ring in overlapping windows → each is tracked separately for badge
  (one increment each) and missed-call traces (one entry each).
- The caller hangs up (cancel) before the callee ever opens the app → the call
  notification is withdrawn if the platform allows; the call still surfaces as
  a missed call, and the badge contribution follows the missed-call rules
  rather than lingering as "ringing".
- Call answered on the user's other device → this device's notification and
  badge contribution clear; no missed-call entry is created for an
  answered-elsewhere call.
- The user has notifications muted for the relevant chat or has badge-only
  settings → existing notification-preference semantics win; this feature never
  makes a silenced context louder.
- The device's platform does not support app-icon badging from the background
  → badge catches up the next time the app opens, matching existing badge
  behavior; notifications and missed-call traces are unaffected.
- Repeated ring notifications must keep re-alerting audibly (current behavior)
  even though they no longer re-increment the badge.

## Requirements *(mandatory)*

### Functional Requirements

**Caller identity in the notification (US1)**

- **FR-001**: The incoming-call notification MUST display the caller's local
  display name and the call type (audio vs video, with a matching emoji or
  equivalent visual cue) for 1:1 calls when the caller is resolvable on the
  device, e.g. "📹 Kamran is calling you".
- **FR-002**: For group calls, the notification MUST name the group when the
  ring can be associated with a group the user knows, and SHOULD name the
  initiator when known, with the call-type cue.
- **FR-003**: Caller/group identity MUST be resolved exclusively from data
  already on the device or from end-to-end-encrypted material the device can
  decrypt. The push payload the notification service carries MUST remain
  content-free (no names, no user ids, no group ids in plaintext) — the
  zero-knowledge boundary is unchanged.
- **FR-004**: If identity cannot be resolved by the time the ring must be
  shown, the notification MUST fall back to the current generic "Incoming
  call" text. The first ring alert MUST NOT be delayed or suppressed while
  waiting for identity resolution.
- **FR-005**: Calls originating from chats the user has hidden (hidden-chats
  feature) MUST always use the generic notification with no identifying
  detail.
- **FR-006**: A raw internal identifier (user id, room id) MUST never be shown
  as a caller name; unresolvable identity falls back to generic text.

**Badge lifecycle for a ringing call (US3, US4)**

- **FR-007**: The first notification shown for an incoming call while the app
  is closed or backgrounded MUST increase the app icon badge count by exactly
  one.
- **FR-008**: Subsequent/repeated notifications for the same ringing call MUST
  NOT increase the badge further; distinct concurrent calls each count once.
- **FR-009**: When the user opens the app during the ring (via the
  notification or directly), the ringing-call badge contribution MUST be
  removed so the badge reflects only standing unread/missed counts.
- **FR-010**: A single call MUST contribute at most one badge unit at any
  moment across its lifecycle (ringing → missed-unseen); transitioning from
  "ringing" to "missed, unseen" must not double-count.

**Notification lifecycle on open (US4)**

- **FR-011**: Opening the app while a call is ringing MUST dismiss the OS
  notification for that call and suppress further OS notifications for it
  while the app is foreground and handling the ring in-app.
- **FR-012**: If the caller cancels or the ring window expires while the app
  stays closed, the call notification MUST stop re-alerting and, where the
  platform allows, be updated or withdrawn so a stale "incoming call" alert
  does not outlive the actual ring.

**Missed-call trace (US2)**

- **FR-013**: Every incoming call that ends unanswered on this account —
  whether the app was open, backgrounded, or fully closed for the entire ring
  — MUST produce a missed-call record visible to the user.
- **FR-014**: The missed-call record MUST appear in the 1:1 chat with the
  caller for direct calls, in the originating group chat for group calls, and
  in the Calls tab in all cases; an ad-hoc group call with no originating
  group chat MUST at minimum appear in the Calls tab.
- **FR-015**: Calls the user never saw in-app (app closed throughout the ring)
  MUST surface their missed-call record no later than the next time the app is
  opened.
- **FR-016**: Existing outcome distinctions (missed vs declined vs busy vs
  answered-elsewhere) MUST be preserved; answered-elsewhere and
  caller-cancelled-before-ring calls follow their existing recording behavior
  and are not newly classified as missed.
- **FR-017**: Missed-call records created by this feature MUST participate in
  the existing unseen-missed-call badge and "seen" clearing semantics, and
  MUST respect existing exclusions (e.g. hidden chats).
- **FR-018**: Missed-call records MUST NOT be duplicated when multiple signals
  about the same call arrive (e.g. the device later reconnects and also learns
  about the call through normal sync).

### Key Entities

- **Incoming-call notification**: The OS-level alert for a ringing call.
  Gains: caller/group identity text, call-type cue, a lifecycle (shown →
  re-alerted → dismissed on open / withdrawn on cancel or expiry).
- **Ringing-call badge contribution**: A transient, per-call unit added to the
  app icon badge; created on first notification, removed on app open, and
  handed over (not added) to the missed-unseen contribution when the call is
  missed.
- **Missed-call record**: The durable trace of an unanswered call (already
  exists as the call-log entry with missed/outcome/seen semantics); this
  feature extends its coverage to calls the app never witnessed live.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For calls from saved contacts with the app closed, 100% of
  incoming-call notifications name the caller and call type (verified across
  1:1 audio, 1:1 video, and group calls in end-to-end tests / manual device
  checks).
- **SC-002**: A user can tell who is calling and whether it is audio or video
  from the lock screen alone, without unlocking or opening the app.
- **SC-003**: Across a full unanswered ring with repeated alerts, the app icon
  badge rises by exactly 1, and returns to the pre-call count within 5 seconds
  of the app being opened during the ring.
- **SC-004**: 100% of unanswered incoming calls leave a visible missed-call
  trace — including calls whose entire ring happened while the app was closed
  — discoverable in the expected chat and/or Calls tab by the next app open.
- **SC-005**: Zero plaintext identity (names, user ids, group ids) is present
  in any payload handed to the platform push service, verified by inspecting
  the wire payloads in tests.
- **SC-006**: No stale incoming-call notification remains on the lock screen
  more than a ring-window's length after the call ended (answered, cancelled,
  or expired), on platforms that permit notification withdrawal.

## Assumptions

- The existing ~60-second ring window and repeated re-alert behavior for
  unanswered calls stay as they are; this feature changes what the alerts say
  and count, not when they fire.
- Caller/group display names come from the user's own on-device data
  (contacts, group membership); there is no server-side directory lookup, and
  the server continues to see only content-free call tickles.
- The existing call-log data model (missed / outcome / seen, chat call rows,
  Calls tab) is reused and extended in coverage — no parallel "missed call"
  concept is introduced.
- Hidden-chat exclusions (Calls tab, badges, generic notifications) defined by
  the hidden-chats feature take precedence over every behavior in this spec.
- "App icon badge" behavior is subject to platform capability (e.g. badging
  from the background is unavailable on some older platforms); where the
  platform cannot badge in the background, the badge reconciles on next app
  open, which is the existing accepted degradation.
- Notification-preference settings (mute, badge-only, web-push off) continue
  to gate whether any alert or badge change happens at all; this spec only
  shapes alerts that are already allowed to show.
