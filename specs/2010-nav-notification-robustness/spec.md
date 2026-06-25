# Feature Specification: Navigation & notification robustness

**Feature Branch**: `fix/2010-nav-notification-robustness`

**Created**: 2026-06-25

**Status**: planned
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: Two recurring robustness defects in the installed PWA: (1) a back-swipe from a main
screen sometimes drops the user into a blank browser view inside the app window; (2) message
notifications randomly show a generic "New message" placeholder instead of the real content even
when the device is unlocked. Fix both so navigation never escapes the app and notifications are
consistent.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A back-swipe never drops me out of the app (Priority: P1)

A person using the installed app swipes right (the phone's edge back-gesture) to return toward the
main list. Today, from a top-level screen this sometimes lands them on a blank page showing the
browser's own back/forward/reload buttons inside the app window — they appear to have fallen out of
the app and have to relaunch it. After this change, a back-swipe from a main screen keeps them in the
app: it harmlessly returns them to (or holds them on) the main list, and no blank/browser view is
ever shown.

**Why this priority**: Falling out of the app into a dead blank view is a trust-breaking, "the app is
broken" moment that forces a relaunch. It can happen from the most-used screens (the tab roots) with
an ordinary, frequent gesture.

**Independent Test**: From a fresh launch, navigate to each main tab and repeatedly trigger a back
navigation at the tab root; confirm the app stays on an in-app screen every time and the browser
chrome / a blank document never appears. Also confirm drilling into a detail screen and swiping back
still returns to its parent as before.

**Acceptance Scenarios**:

1. **Given** the app is freshly launched at a main tab list, **When** the user triggers a back
   navigation from that tab root, **Then** the app remains on an in-app screen (the main list) and no
   blank page or browser chrome is shown.
2. **Given** the user is several screens deep (e.g. a chat opened from a list), **When** they swipe
   back repeatedly, **Then** each step returns to the expected parent screen and the final back at the
   tab root still keeps them in the app.
3. **Given** any URL/path that does not correspond to a real screen is reached, **When** it loads,
   **Then** the app shows the main list instead of a blank/empty view.

---

### User Story 2 - Notifications consistently show the real message (Priority: P1)

A person has a chat set to show message content in notifications, and their device is unlocked (the
normal state). When a message arrives while the app is backgrounded or closed, they expect the
notification to show the actual decrypted message — every time. Today it flip-flops: the same chat
sometimes shows the real content and sometimes a generic "New message", seemingly at random. After
this change, in the unlocked state the notification reliably reflects the chat's chosen content level
(full content, no-preview/generic, or badge-only), consistently across messages.

**Why this priority**: Inconsistent previews make notifications untrustworthy — the user can't tell at
a glance whether a generic alert means "preview is off" or "the app failed to decrypt this one". It's
the headline complaint and affects every incoming message.

**Independent Test**: With a chat set to full content and the device unlocked, deliver several messages
in succession with the app backgrounded; confirm each notification shows the decrypted content (no
random generic). Repeat with the chat set to no-preview and to badge-only and confirm each behaves
per its setting consistently.

**Acceptance Scenarios**:

1. **Given** a chat set to show full content and an unlocked device, **When** multiple messages arrive
   while the app is backgrounded, **Then** every resulting notification shows the decrypted content
   (none fall back to generic).
2. **Given** decryption of a just-arrived message takes a moment, **When** a placeholder notification
   is shown first, **Then** it is replaced by the real content once decryption completes (within the
   wake window), rather than leaving a stale generic.
3. **Given** a chat set to no-preview (generic) or badge-only, **When** messages arrive, **Then** the
   notification consistently honors that setting (generic text, or badge update with no banner).

---

### User Story 3 - Exactly one notification per message (Priority: P2)

When a message arrives, the user gets a single notification for it — never two for the same message
(one from the running app and one from the background handler), and never zero when they should have
been alerted. The unread badge count stays accurate regardless of the per-chat content setting.

**Why this priority**: Duplicate notifications are noisy and erode trust; a silently-missing alert is
worse. Both stem from the same ambiguous hand-off between the foreground app and the background
handler that drives the US2 flip-flop, so fixing it cleanly resolves duplicates/misses too.

**Independent Test**: Deliver a message in each app state (visible, backgrounded, closed) and confirm
exactly one user-facing alert results, and that the badge reflects the true unread count.

**Acceptance Scenarios**:

1. **Given** the app is open and visible, **When** a message arrives, **Then** the user sees exactly
   one alert (an in-app banner) and not also a system notification for the same message.
2. **Given** the app is backgrounded or closed, **When** a message arrives, **Then** the user sees
   exactly one system notification for it.
3. **Given** any per-chat content setting (full / generic / badge-only / muted), **When** messages
   arrive, **Then** the app's unread badge reflects the true unread count.

---

### Edge Cases

- **Back-swipe at the very first screen after launch**: the gesture must not exit to a blank/browser
  view; it harmlessly keeps the user on the main list.
- **Locked device (PIN/passkey, no auto-unlock)**: the background handler cannot decrypt, so a generic
  placeholder is the correct, expected result — consistency means "always generic while locked", not a
  flip-flop. This is in scope only insofar as the behavior must be deterministic per lock state.
- **Slow network / slow decryption on wake**: a placeholder may appear first but must be upgraded to
  real content once decryption finishes within the wake window; it must not strand a generic.
- **Cold background handler (first message after the app/handler was evicted)**: the first
  notification after a cold wake must still reach the right content level, not reliably degrade to
  generic due to start-up latency.
- **Rapid burst of messages**: each message resolves to a single, correctly-leveled notification;
  placeholders are replaced, not stacked alongside their upgrades.
- **iOS platform constraint**: the background handler must present a notification for every push so the
  platform does not substitute its own fallback notification or revoke the push subscription; the
  badge-only path must satisfy this constraint.

## Requirements *(mandatory)*

### Functional Requirements

**Navigation**

- **FR-001**: A back navigation from a main tab list MUST keep the user within the app — it MUST NOT
  expose the browser's chrome (back/forward/reload) or a blank/empty document inside the app window.
- **FR-002**: Reaching any path that does not correspond to a real screen MUST resolve to the main
  list (never a blank view).
- **FR-003**: Existing back behavior MUST be preserved: from a drilled-in detail screen, back returns
  to its parent screen, step by step, as it does today.
- **FR-004**: The fix MUST use the app's standard routing/navigation behavior (no fragile
  platform-gesture interception) and MUST NOT regress tab switching or the existing navigation suite.

**Notifications**

- **FR-005**: When the device is unlocked, a message notification MUST consistently reflect the
  chat's content setting (full content / generic / badge-only) — the same chat MUST NOT alternate
  between real content and generic across messages under unchanged conditions.
- **FR-006**: Each incoming message MUST produce exactly one user-facing alert — never a duplicate
  from both the foreground app and the background handler, and never a missing alert when one is due.
- **FR-007**: Responsibility for alerting MUST be unambiguous: the foreground app owns the alert only
  when it actually presents an in-app banner; otherwise the background handler owns the notification.
  An item the foreground app does not actually present MUST NOT be suppressed by it.
- **FR-008**: A placeholder notification shown while a message is still being decrypted MUST be
  replaced by the real content once decryption completes within the wake window (no stranded generic
  when content was available).
- **FR-009**: The unread badge MUST stay accurate regardless of the per-chat content setting,
  including badge-only and muted chats.
- **FR-010**: Existing per-chat notification settings (full / generic / badge-only, web-push on/off,
  in-app banner on/off, mute) MUST be honored unchanged; this work makes the existing settings behave
  consistently and MUST NOT add new settings.

**Constraints (cross-cutting)**

- **FR-011**: The zero-knowledge boundary MUST be preserved: message content MUST NOT appear in the
  push payload; the background handler MUST obtain content only by fetching the sealed message over
  the existing relay and decrypting it on-device.
- **FR-012**: The change MUST require no server modifications.
- **FR-013**: On iOS/Safari installed PWAs, the background handler MUST present a notification for
  every push (so the platform does not show its own fallback or revoke the subscription); the
  badge-only path MUST satisfy this constraint while showing no message banner.

### Key Entities *(include if feature involves data)*

- **Per-chat notification preference**: the existing per-conversation choice of content level (full
  content / generic / badge-only), plus web-push, in-app-banner, and mute toggles. Not changed by this
  work; honored consistently.
- **Notification hand-off signal**: the existing coordination between the foreground app and the
  background handler that decides which one alerts the user for a given message. Made deterministic by
  this work.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With a chat set to full content and the device unlocked, every notification over a run of
  consecutive backgrounded messages shows the decrypted content — zero random generic fallbacks (where
  decryption was possible).
- **SC-002**: Each delivered message results in exactly one user-facing alert (no duplicates, no
  misses) across the app states visible / backgrounded / closed.
- **SC-003**: Repeatedly triggering a back navigation from any main tab root never exposes browser
  chrome or a blank document; the app stays on an in-app screen every time.
- **SC-004**: Any non-existent path resolves to the main list rather than a blank view.
- **SC-005**: The unread badge matches the true unread count for chats across all content settings
  (full / generic / badge-only / muted).
- **SC-006**: No regression to the existing navigation, notification, and call test suites.

## Assumptions

- The reported notification flip-flop occurs in the normal unlocked (auto-unlock) state; a PIN/passkey
  lock legitimately forces generic placeholders (the background handler cannot decrypt without the
  unlock), and "consistency" there means deterministically-generic, not content.
- The existing per-chat notification settings and the existing background fetch-and-decrypt pipeline
  are kept; this is a robustness/correctness fix, not a new feature surface.
- "Keep the user in the app" on a tab-root back-swipe is the desired behavior (a benign no-op /
  re-anchor to the main list), in preference to attempting a clean app exit — which the platform does
  not reliably support and which currently manifests as the blank browser view.
- Behavior is validated with the existing automated end-to-end harness plus the background handler's
  own code paths; on-device iOS confirmation covers the platform-specific notification constraint.
- No server changes are required or made; the zero-knowledge boundary is unchanged.
