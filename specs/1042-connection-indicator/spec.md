# Feature Specification: Show when the app has lost its server connection

**Feature Branch**: `fix/2027-long-media-captions`
<!-- Rides the 2027 hotfix branch by explicit request (one CI run); the spec
     number is ad-hoc band. -->

**Created**: 2026-07-12

**Status**: shipped

**Input**: User description: "I think we probably should have some sort of indicator when
the connection to server is down!" (screenshot: sent messages sitting on the pending
clock with no hint that the app is offline).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The app says it is disconnected (Priority: P1)

When the server link is down for more than a moment, a small floating pill appears
telling the user the app is reconnecting, and whether the problem is their own network
or the server. It disappears the instant the link is back.

**Independent Test**: Stop the dev server with the app open. Within a few seconds the
pill appears. Start the server, the pill disappears on reconnect.

**Acceptance Scenarios**:

1. **Given** a signed-in user with the app open, **When** the socket stays non-online
   continuously past a short grace window, **Then** a "Connecting" pill appears above
   the content on every screen.
2. **Given** the device itself has no network, **When** the pill is visible, **Then** it
   reads "Waiting for network" instead, so the user looks at their connectivity rather
   than blaming the app.
3. **Given** the link comes back, **When** the socket reports online, **Then** the pill
   disappears immediately.
4. **Given** a cold app start or a sub-second reconnect blip, **When** the socket cycles
   states briefly, **Then** no pill flashes (grace window).
5. **Given** a signed-out device (onboarding), **Then** the pill never shows.

### Edge Cases

- The retry loop flaps offline↔connecting while disconnected: the grace window runs
  once across flaps, not per flap, so the pill still appears.
- The pill is non-interactive (taps pass through) and sits below the in-app
  notification banners and call overlays in stacking order.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A signed-in app whose sync socket is continuously non-online for a grace
  window (~3s) MUST show a floating connection pill on every screen.
- **FR-002**: The pill copy MUST distinguish device-offline ("Waiting for network") from
  server-unreachable ("Connecting").
- **FR-003**: The pill MUST hide immediately on reconnect and never show before sign-in.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With the server stopped, every screen shows the indicator within ~5s; with
  the server restored, it clears without user action.

## Assumptions

- The existing reactive `syncState` (offline/connecting/online) is the single source of
  truth; no new transport plumbing is needed.
