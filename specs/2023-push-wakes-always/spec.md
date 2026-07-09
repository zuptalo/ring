# Feature Specification: Push Wakes Always End Visibly Where Silence Is Unsafe

**Feature Branch**: `fix/2023-push-wakes-always`

**Created**: 2026-07-09

**Status**: in-review
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped. -->

**Input**: Review of an externally-proposed fix to the spec-1034 visible-client
gate, escalated after push deliveries kept dying on iPhones. The review
verified WebKit's enforcement in source and found the licensed silences —
not a stale-visibility bug — are what keep revoking subscriptions.

## Why (the persisting incident)

Spec 1034 made every push wake end visibly **unless a Ring window client looks
visible**, and kept the page-claim handshake (a live page acks that it rendered
the alert, the service worker stays silent). Both licenses are fatal on Apple
platforms, and we now know this from WebKit's own source rather than inference:

- Apple grants **no exemption** for "the user is looking at the app". Chrome
  documents that a focused page may skip the notification; Apple documents the
  opposite ("Safari doesn't support invisible push notifications… If you
  don't [show one], Safari revokes"), and webpushd starts a ~30s timer per
  delivered push waiting for a `showNotification` call.
- The strike counter is **cumulative for the life of the subscription**:
  `silentPushCount` is only ever incremented (no reset API exists), and at
  `maxSilentPushCount = 3` ALL subscriptions for the origin are removed. Three
  licensed silences, ever, kill the device's notifications until it
  re-registers.
- An in-app banner is invisible to webpushd. The page-claim path therefore
  accrues a strike on every foreground-claimed message wake — and one claim arm
  (a message for a locked hidden chat while the page is visible) acks having
  rendered nothing anywhere at all.

The server pushes precisely when the device has no fresh socket — which on
iPhones routinely includes "app on screen, socket dropped after resume" — and
the conn/post/post-activity/version tickles are not socket-gated at all, so
foreground pushes are a designed-in, recurring event, not a corner case.

The review also confirmed three latent error paths where a wake whose
notification attempt FAILED is still counted as visibly ended, defeating the
last-resort fallback that exists for exactly that case.

## Clarifications

### Session 2026-07-09

- Q: Is the silence-safe gate decided by operating system (treat everything on
  Apple hardware as unsafe) or by browser engine (treat every Chromium-engine
  browser as safe)? → A: By engine. The strike counter lives in Apple's push
  daemon, which only WebKit-engine browsers use; Chrome/Edge on macOS run
  Chromium and Chromium's push service on every OS, with Chromium's documented
  focused-page exemption. So Chrome on macOS keeps the exemption, Safari on
  macOS does not, and every iOS browser (all WebKit skins, including
  CriOS/EdgiOS/FxiOS) is unsafe. Resolved from the platform documentation
  cited in Why; recorded here because the original FR wording said
  "non-Apple platforms", which reads as OS-based.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - iPhone notifications survive foreground pushes (Priority: P1)

An iPhone user keeps Ring open (or recently open) while messages, friend
requests, Wall activity, and version announcements arrive. Today each such
wake can legally end with no visible notification and silently burns one of
the three lifetime strikes; after the third, the phone never gets another
notification. After this fix, on Apple platforms every single push wake ends
with a visible notification — at worst the existing content-free quiet note
(silent, no sound, self-replacing, no sender or content) — so the strike
counter never moves.

**Why this priority**: This is the whole incident. Losing push permanently,
invisibly, with no server-side signal, is the worst notification failure the
app can have.

**Independent Test**: Unit-test the pure silence-license decisions (platform
gate and the combined license) with an Apple user agent and a visible, focused
client — the license must be denied; verify every wake kind's terminal against
the wake-outcomes contract inventory. On a dev iPhone with the app foregrounded
and its socket severed, send repeated pushes and confirm notifications keep
arriving afterward (no revocation).

**Acceptance Scenarios**:

1. **Given** an Apple device with a Ring window visible and focused, **When**
   a message push arrives and the page claims the alert with an in-app banner,
   **Then** the service worker still shows the quiet content-free note, and
   the wake ends visibly.
2. **Given** an Apple device with a message arriving for a locked hidden chat
   while the app is visible, **When** the page claims the wake having rendered
   nothing, **Then** the service worker shows the same content-free quiet note
   any message produces (no sender, no chat identity, no content).
3. **Given** an Apple device with the app visibly open, **When** a
   conn/post/post-activity/version wake has nothing rich to show, **Then** the
   quiet note is shown rather than skipped.

---

### User Story 2 - Desktop Chromium stays calm (Priority: P2)

A desktop Chromium user actively using Ring does not start seeing redundant
notification-center entries. Chromium documents that a focused page may skip
the notification, so on Chromium-engine browsers (desktop including macOS,
and Android) the existing skip remains —
gated on a window client that is both **focused and visible** (keeping the
externally-contributed tightened predicate, now with its rationale documented
and its missing test pinned).

**Why this priority**: The fix must not trade the iOS incident for a
notification-spam regression on the platforms that were never at risk.

**Independent Test**: Unit-test the platform gate and predicate: Chromium user
agents license silence only with a focused+visible client; Apple, iOS-WebKit
skins (all iOS browsers), Firefox, and unrecognized user agents never license
silence.

**Acceptance Scenarios**:

1. **Given** a desktop Chromium user agent and a focused, visible Ring window,
   **When** a wake has nothing rich to show, **Then** the service worker may
   stay silent (unchanged behavior).
2. **Given** a desktop Chromium user agent and a Ring window that is visible
   but NOT focused, **When** such a wake occurs, **Then** the quiet note shows
   (tightened predicate).
3. **Given** a Firefox or unrecognized user agent, **When** such a wake
   occurs, **Then** the quiet note shows (safe default).

---

### User Story 3 - A failed notification can never masquerade as a shown one (Priority: P3)

When the platform rejects or hangs a notification call, the wake must not be
recorded as visibly ended: the failure propagates so the last-resort generic
fallback actually fires, and the "a notification was shown during this event"
record is only made once the platform accepts the show.

**Why this priority**: These are rare error paths, but they sit in the exact
guard whose only job is preventing the revocation class this spec exists for.

**Independent Test**: Unit-test the show-tracking and show-counting decisions;
simulate a rejecting notification call and assert the wake either shows the
fallback or propagates an error (never resolves silently).

**Acceptance Scenarios**:

1. **Given** the quiet-note show itself fails, **When** the wake completes,
   **Then** the failure reaches the outer guard and the generic fallback is
   attempted (not swallowed).
2. **Given** a wake whose every rich-note show was rejected, **When** the wake
   completes, **Then** it is not counted as visibly ended and terminates via
   the quiet/fallback path.
3. **Given** the last-resort guard's record of "shown this event", **When** a
   show call is made but rejected by the platform, **Then** no record is made
   and the fallback still fires.

---

### Edge Cases

- **Hidden-chat stealth on silence-unsafe platforms (deliberate trade against
  spec 1027's FR-012 zero-trace)**: the foreground claim becomes the same content-free
  "New message" quiet note any message produces — on every silence-unsafe
  platform (all of WebKit, Firefox, unknowns), not only Apple. It reveals
  nothing about which chat, from whom, or that hidden chats exist; the
  alternative on Apple is permanently losing all notifications for the
  device. Silence-safe (Chromium-engine) platforms keep full zero-trace.
- **Quiet note while the user is in the app on Apple**: appears silently
  (no sound/vibration), self-replaces on its tag, and the app's existing
  foreground cleanup clears it on the next visibility transition. At most one
  entry lingers; accepted.
- **Unknown/spoofed user agents**: anything not confidently Chromium-engine
  is treated like WebKit (always show) — over-notifying is safe on every
  platform, silence is fatal on some.
- **Call wakes**: already show unconditionally; unaffected.
- **Page ack arriving after the wait window**: no claim, service worker shows
  its own notification — existing behavior, unchanged.
- **Notification permission revoked at the OS level**: every show call fails;
  the wake propagates to the outer guard whose fallback also fails — nothing
  more is possible, and no path reports success.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** *(amends spec 1034 FR-001)*: A push wake MAY end without a
  visible notification ONLY when BOTH hold: (a) the platform gate says silence
  is documented-safe (a Chromium-engine browser, which uses Chromium's push
  service on every OS it runs on), and (b) a Ring window client is focused AND
  visible, or a live page claimed the wake. On WebKit-engine platforms (all of
  iOS, Safari on macOS) and any unrecognized platform, EVERY push wake MUST
  end with a notification-show call.
- **FR-002**: The platform gate MUST be a pure, unit-tested decision on the
  service worker's user agent, keyed on browser engine and defaulting to
  "silence unsafe" for anything not confidently Chromium-engine: iOS browser
  skins (CriOS/EdgiOS/FxiOS — WebKit underneath), Safari anywhere, Firefox,
  and unknowns all count as unsafe; Chrome/Edge on macOS count as safe.
- **FR-003**: On silence-unsafe platforms, after a page claims a message wake
  the service worker MUST still show the content-free quiet note (silent,
  self-replacing tag, no sender/content) within the same wake, before the
  push event settles — comfortably inside the platform's silent-push timer.
  This covers the zero-render hidden-chat claim arm by construction. On
  silence-safe platforms the claim keeps its current fully-silent outcome.
- **FR-004**: The visible-client predicate remains "focused AND visible",
  carries a why-comment explaining both conditions, uses the codebase's
  strict-equality house style, and pins the previously-missing test case
  (visibility 'visible' with the focused field absent → not visible).
- **FR-005**: A failure to show the quiet note MUST propagate to the outer
  push guard whenever the quiet note is the wake's only remaining visible
  ending, so the last-resort generic fallback runs. Two call sites MAY contain
  the failure locally because the wake is already visibly ended or re-routed:
  the settle downgrade of an already-accepted loud generic, and the
  authoritative-drain degrade (which falls back to the preview flow, whose own
  quiet terminal propagates).
- **FR-006**: The outer guard's "a notification was shown during this event"
  record MUST be made only when the platform accepts the show (on
  fulfillment), never at call time.
- **FR-007**: Rich-note and conn-note batch shows MUST report how many
  notifications were actually accepted; a wake whose count is zero MUST NOT be
  counted as visibly ended and MUST terminate via the quiet/fallback path. The
  authoritative drain may still ack its committed frames, but the wake must
  end visibly.
- **FR-008**: The superseded requirements gain pointers to this amendment so
  the documents cannot be read as contradicting: spec 1034's policy section
  (visible-client license now platform-gated) and spec 1027's FR-012
  zero-trace behavior (the foreground hidden-chat claim now ends visibly on
  silence-unsafe platforms).

### Key Entities

- **Platform gate**: pure classification of the service worker's user agent
  into "silence may be licensed" (Chromium-engine browsers, on any OS) vs
  "always end visibly" (WebKit, Firefox, and everything unrecognized).
- **Quiet note**: the existing spec-1034 content-free notification (title/body
  carry no sender, chat, or content; silent; self-replacing tag). Its content
  is unchanged by this spec.

## Zero-Knowledge Impact

None on the wire, and none on notification content. The quiet note already
carries exactly the information the push tickle itself reveals (that
*something* happened); this spec only shows it in more situations. No server
changes, no push-payload changes, and no new page↔service-worker message
types or fields. The platform classification is computed locally per wake and
is never logged, stored, or transmitted. The hidden-chat trade on
silence-unsafe platforms discloses no chat identity, sender, or content —
only the same generic "New message" any message produces.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A code inventory (documented in the PR) shows zero wake
  terminations on silence-unsafe platforms that do not call notification-show:
  every dispatch path ends in a rich note, a generic, or the quiet note.
- **SC-002**: On silence-safe platforms, non-failure behavior is unchanged
  apart from the already-applied focused+visible tightening; the error-path
  hardening (a failed show never counts as shown) applies on every platform.
  Checked by the artifacts the tasks produce: the wake-outcomes inventory's
  trusted-platform column row-by-row, plus the Chromium rows of the gate
  truth-table tests.
- **SC-003**: All pure decisions (platform gate, visible predicate, quiet-note
  content, show-count handling) are unit-tested, including the previously
  missing predicate case; `npm run build` and the full unit suite pass.
- **SC-004**: A dev iPhone with the app foregrounded and a severed socket
  receiving 5+ pushes still receives notifications afterward (no revocation);
  validation recipe documented in the PR.

## Assumptions

- The hidden-chat stealth reduction on silence-unsafe platforms (edge case
  above) is an accepted product decision; it was explicitly approved when this
  fix was requested.
- User-agent sniffing inside the service worker is an acceptable and stable
  platform signal: on iOS every browser is WebKit and uses webpushd, and
  Chromium ships its engine token on every OS, so the gate only needs to be
  right about "confidently Chromium-engine vs everything else".
- Existing foreground cleanup (clearing notifications when the app becomes
  visible) is sufficient housekeeping for the new quiet notes; no new
  cleanup mechanism is in scope.
- Chromium's tolerance of skipped notifications (its own "site updated in the
  background" fallback, no revocation) continues to hold per its documented
  push policy.
- No server-side changes are needed; the server's push-sending policy
  (socket-gated messages, ungated activity tickles) is out of scope.
