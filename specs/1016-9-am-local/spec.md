# Feature Specification: 9-AM-Local Version-Announcement Push (Per-Device, Behind-Only)

**Feature Branch**: `feat/1016-9-am-local`

**Created**: 2026-06-22

**Status**: in-review
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "9 AM local version-announcement push (per-device, behind-only)"

## Overview

Ring tells people when a newer version of the app is available with a "what's new"
notification. Today that notification is sent to **every** device **the moment** a new
release is deployed — which can wake people in the middle of the night during a
late-night release, and pesters people who have already updated.

This feature changes **when** and **to whom** the update notification is delivered (it
does not change the notification's content or the separate in-app "what's new" prompt).
The notification is delivered at **09:00 in each device's own local time**, and **only**
to devices that are **behind** the latest release. A device already on the latest version
is never disturbed, and a device that ignores a nudge is not re-nagged for the same
version.

## Clarifications

### Session 2026-06-22

- Q: If a behind device is offline at its local 09:00, how should the update push behave (a held push could otherwise be delivered at night)? → A: The 09:00 push carries a short lifetime and expires by roughly local midday if undelivered, so it is **never** delivered outside the morning window; a device that misses it relies on the in-app prompt, and a future newer release re-triggers a fresh morning nudge. The device is counted as notified-for-this-version when the push is sent (not on confirmed delivery).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Out-of-date user is told at a humane local hour, not overnight (Priority: P1)

Someone whose installed app is older than the latest release should learn about the
update at a reasonable morning hour in their own timezone — never at 3 AM because a
release happened to ship overnight.

**Why this priority**: This is the core problem being solved — avoiding off-hours
disturbance. Without it, the feature delivers nothing.

**Independent Test**: Put a device on an older version in a known timezone; advance to
09:00 local and confirm the update notification arrives; confirm that at any other local
hour (e.g., 03:00 local) it does not.

**Acceptance Scenarios**:

1. **Given** a device is behind the latest version and its local time reaches 09:00,
   **When** the system evaluates pending announcements, **Then** that device receives the
   "a new version is available" notification.
2. **Given** a device is behind the latest version and its local time is outside the
   09:00 hour (e.g., 02:00 or 14:00 local), **When** the system evaluates pending
   announcements, **Then** that device receives no announcement at that time.
3. **Given** a release is deployed at 01:00 in a device's local time, **When** that night
   passes, **Then** the device is not notified until 09:00 local that morning.

---

### User Story 2 - Already-updated users are never pinged (Priority: P1)

Someone who has already updated to the latest version should never receive an "update
available" notification — it would be wrong and annoying.

**Why this priority**: Equally core; notifying up-to-date users is both incorrect and a
disturbance. P1 alongside US1 — together they form the MVP.

**Independent Test**: Put a device on the latest version; advance through 09:00 local and
confirm it receives no update notification.

**Acceptance Scenarios**:

1. **Given** a device's installed version equals the latest deployed version, **When**
   09:00 local arrives, **Then** the device receives no update notification.
2. **Given** a user has two devices — one updated, one behind — **When** both reach 09:00
   local, **Then** only the behind device is notified.

---

### User Story 3 - A user who ignores the nudge isn't re-nagged for the same version (Priority: P2)

Someone who is behind and chooses not to update right away should be told **once** per
release, not nagged every morning.

**Why this priority**: A refinement that prevents the feature from becoming an annoyance;
not required for the basic timing/targeting to work, so P2.

**Independent Test**: Keep a device behind across several days; confirm it receives the
announcement once for the current latest version, then nothing further for that same
version; after a newer version ships, confirm it receives exactly one announcement for
the newer version.

**Acceptance Scenarios**:

1. **Given** a behind device was already notified about the current latest version,
   **When** subsequent 09:00-local windows pass without a new release, **Then** the device
   receives no further announcements.
2. **Given** a behind device that was previously notified about version A, **When** a
   newer version B becomes the latest and the device is still behind, **Then** at the next
   09:00 local the device receives exactly one announcement (for B).

---

### User Story 4 - The operator/server learns only coarse, minimal metadata (Priority: P2)

To schedule per-device, behind-only delivery, the server must know each device's
installed version and roughly what time it is there. This must be the **minimum** needed,
consistent with Ring's zero-knowledge posture — no notification content, no precise
location, no behavioral profiling.

**Why this priority**: Ring's defining constraint is zero-knowledge; this story makes the
privacy envelope explicit and testable. P2 because the headline behavior (US1/US2) can be
demonstrated first, but this MUST hold before shipping.

**Independent Test**: Inspect everything stored/logged for the feature and confirm it is
limited to (a) an installed version string and (b) a coarse local UTC offset in minutes
per device — and that the notification itself carries no content.

**Acceptance Scenarios**:

1. **Given** the feature is active, **When** the data retained per device is inspected,
   **Then** it contains only the installed version, a coarse local UTC offset in whole
   minutes, and a record of the last version that device was notified about — and nothing
   else new.
2. **Given** an update notification is delivered, **When** its payload is inspected,
   **Then** it contains no release notes, version text, location, or user data — only a
   marker that prompts the device to fetch the already-public "what's new" information
   itself.

---

### Edge Cases

- **Multiple releases overnight**: if two releases ship before a device's 09:00, the
  device is notified once at 09:00 for whatever is the **current** latest version then —
  not once per intervening release.
- **Timezone change / DST / travel**: the device's local offset is refreshed when the app
  is next opened, so the next 09:00-local evaluation uses the updated offset.
- **Half-hour / 45-minute timezones** (e.g., UTC+5:30, UTC+5:45): 09:00 local is still
  well-defined from the minute offset.
- **Device offline at its 09:00**: the notification has a short lifetime and expires by
  roughly local midday — it is **never** held and delivered that evening/night. A device
  offline through the morning simply misses that version's push (it still sees the in-app
  prompt on next open, and a future newer release re-triggers a fresh morning nudge).
- **Device never reopens the app after a release**: it never reports a newer installed
  version, so if it was already behind and reachable it still receives one 09:00 nudge for
  the current latest version.
- **No timezone reported yet**: a device that has never reported a local offset is not
  scheduled for 09:00-local delivery; it learns of updates via the in-app prompt instead.
- **Notifications disabled / no registration**: a device with no notification
  registration receives no announcement (inherent).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST record, per device notification registration, the app
  version that device currently has installed.
- **FR-002**: The system MUST record, per device notification registration, the device's
  local time as a coarse UTC offset in whole minutes, and MUST refresh it whenever the
  device re-registers for notifications, so timezone and daylight-saving changes are
  reflected.
- **FR-003**: The system MUST treat a device as "behind" when its recorded installed
  version differs from the latest deployed version.
- **FR-004**: The system MUST deliver the "a new version is available" notification to a
  behind device during the **09:00 hour in that device's local time**.
- **FR-005**: The system MUST NOT deliver the update notification to a device whose
  recorded installed version equals the latest deployed version.
- **FR-006**: For a given latest version, the system MUST deliver the update notification
  to a behind device **at most once** (no repeat for the same target version).
- **FR-007**: If a device remains behind and a **newer** version later becomes the latest,
  the system MUST deliver exactly one notification for that newer version at the device's
  next 09:00 local.
- **FR-008**: The system MUST evaluate "behind" and the local 09:00 window **per device**,
  so different devices belonging to the same user are notified independently based on each
  device's own installed version and local offset.
- **FR-009**: The system MUST NOT perform an immediate, all-device broadcast when a new
  version is deployed; this scheduled, behind-only delivery replaces that behavior.
- **FR-010**: The device MUST obtain the notification's human-readable content (the
  version name and "what's new") at delivery time from the already-public app
  configuration; this content MUST NOT be carried in the notification payload.
- **FR-011**: The separate in-app "what's new" prompt shown when a user opens the app MUST
  be unaffected by this feature.
- **FR-012**: A device that has not reported a local UTC offset MUST NOT be scheduled for
  09:00-local delivery.
- **FR-013**: The device MUST report its installed version and local offset by reusing the
  existing notification-registration exchange (no separate always-on reporting channel is
  introduced).
- **FR-014**: Re-reporting an installed version or offset MUST NOT disturb an existing
  registration's other data, and a re-registration that omits version/offset MUST leave
  the previously recorded values intact.
- **FR-015**: The update notification MUST carry a short lifetime so it is **never**
  delivered outside the morning window: if a device is offline at its 09:00 and does not
  come online by roughly local midday, the notification MUST expire undelivered rather
  than arrive later that evening or night. A device for which the notification was sent
  MUST be treated as notified for that version (once-per-release dedup is on send, not on
  confirmed delivery), so it relies on the in-app prompt for that release and is eligible
  again only when a newer version becomes the latest.

### Non-Functional Requirements — Zero-Knowledge (NFR-ZK)

- **NFR-ZK-001**: The update notification payload MUST remain content-free — it MUST carry
  no release notes, no version text, and no user data; it carries only a marker that
  causes the device to fetch the public "what's new" information itself.
- **NFR-ZK-002**: The only new per-device metadata stored for this feature MUST be (a) the
  installed app version string (already public information), (b) a coarse local UTC offset
  in whole minutes, and (c) the last app version that device was notified about (for
  once-per-release dedup). No IANA timezone name, no precise location, no per-user
  behavioral history, and no notification content may be stored or logged.
- **NFR-ZK-003**: The added metadata MUST be used solely to decide "is this device behind?"
  and "is it the 09:00 hour there?"; it MUST NOT be repurposed for other tracking or
  analytics.
- **NFR-ZK-004**: Logs and other observability output MUST NOT record the new metadata (or
  scheduler activity) in a way that reconstructs a per-user timezone or behavioral profile —
  e.g., no logging of a device's local time of day, send history, or delivery/open events
  beyond the coarse fields needed to operate and debug the scheduler. No delivery- or
  open-confirmation metadata is collected at all (the once-per-release dedup is keyed on
  send, not on delivery).

### Key Entities *(include if feature involves data)*

- **Device notification registration**: one device's registration to receive
  notifications. For this feature it additionally carries the device's installed app
  version, its coarse local UTC offset (minutes), and the last app version it was notified
  about.
- **Latest deployed version**: the app version the running service currently reports as
  current; the reference point for deciding whether a device is "behind."

## Zero-Knowledge Impact

*(Required by Constitution Principle I.)*

- **What new data, if any, becomes visible to the server?** Per device notification
  registration, two new values plus one dedup marker: (a) the installed app version
  string — already public (the running server publishes its own version, and the client
  version is shown in-app); (b) a coarse local UTC offset in **whole minutes**; and (c) the
  last app version that device was notified about. Nothing else.
- **Why is each unavoidable for the feature?** The version is required to decide "is this
  device behind the latest?"; the UTC-offset-minutes is the minimum needed to know when it
  is 09:00 in the device's local time; the last-notified version is required for
  once-per-release dedup. None can be omitted without losing a core requirement.
- **What is explicitly NOT collected?** No notification content (the push stays
  content-free; the device fetches the public "what's new" itself), no IANA timezone name,
  no precise location or coordinates, no per-user behavioral/engagement history, no
  delivery/open tracking. The offset is coarse (minutes, and only the local *hour* is ever
  used), which is far less identifying than a named zone or a location.
- **Boundary:** This feature does not change what the server can read about messages,
  posts, profiles, or media — all of which remain opaque ciphertext. It only adds the two
  coarse routing fields above to the existing notification-registration metadata, used
  solely to time and target the update nudge, never repurposed (NFR-ZK-003).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 0% of update notifications are delivered to a device between 22:00 and 08:59
  in that device's local time (no overnight disturbances).
- **SC-002**: 100% of update notifications delivered to reachable, behind devices land
  during the 09:00 hour in the device's local time.
- **SC-003**: A device whose installed version equals the latest receives 0 update
  notifications.
- **SC-004**: A behind device receives at most 1 update notification per distinct newer
  version (no duplicate nags for the same version).
- **SC-005**: For a user with two devices — one updated, one behind — the update
  notification appears on exactly 1 of the 2 devices (the behind one).
- **SC-006**: The per-device data introduced by this feature is limited to the installed
  version, a UTC-offset-in-minutes, and the last-notified version — verifiable by
  inspection — and the notification payload contains no release content.

## Assumptions

- Delivery occurs **during** the device's local 09:00 hour, as close to 09:00 as the
  system's notification-evaluation cadence allows; exact-to-the-second delivery is not
  promised.
- Only devices running the updated client (which reports installed version + local offset)
  are candidates. On the deploy that **introduces** this feature, devices report the
  now-current version and are therefore not "behind," so the **first real announcement
  occurs on the next version change after this ships**. This is expected, not a defect.
- A device that has not reported a local offset is not scheduled for 09:00-local delivery
  and relies on the in-app prompt; this is acceptable.
- The existing notification (push) delivery mechanism and the existing public app-config
  source for version + "what's new" are reused; "latest version" is the version the
  running service reports as current.
- A device offline across its 09:00 does not receive that version's notification (it
  expires by roughly local midday rather than being held for late delivery); guaranteeing
  every offline device eventually gets a push per release is out of scope — the in-app
  prompt covers that case.
- "Behind" is decided by simple inequality between the device's installed version and the
  latest deployed version, which is correct for Ring's single-deployment model (one
  current version at a time) and for development build identifiers.
