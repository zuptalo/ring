# Feature Specification: Hidden Chats Locked Behind a PIN

**Feature Branch**: `feat/1019-hidden-chats-pin`

**Created**: 2026-06-26

**Status**: in-review
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "Hidden chats locked behind a PIN — let users hide specific 1:1 and group conversations so they don't appear in the main chat list and are only revealed by entering a PIN (with optional biometric unlock). Notifications for hidden chats arrive but show no sender/content preview. Hiding is local to the device and never visible to the server (zero-knowledge). Resetting the PIN wipes hidden-chat local state. Inspired by Viber's hidden chats."

## Overview

Some conversations are private even from someone who is briefly handed the
phone. **Hidden Chats** lets a user take a specific 1:1 or group conversation
out of the visible chat list and tuck it behind a PIN (with optional biometric
unlock). The hidden conversation does not appear in the Chats tab, its incoming
notifications reveal no sender or content, and it is only brought back into view
by entering the PIN. Hiding is a purely local, on-device privacy layer on top of
Ring's existing end-to-end encryption — the server is never told that a chat is
hidden and learns nothing new.

This is plausible-deniability UX, not a second cryptographic scheme: every chat
is already E2E-encrypted, so Hidden Chats governs *visibility on this device*,
backed by an at-rest lock so the hidden designation can't be read off the device
either.

A hidden chat is a **distinct conversation**, not a hidden flag toggled on an
existing one. Modeling it on Ring's existing group-conversation mechanism (a
conversation with its own identity, reusing the established sender-key crypto)
lets a normal, fully visible chat with a friend and a *separate* hidden chat with
that same friend coexist in parallel — the visible one is never removed or
altered when the hidden one exists. Revealing is also "sticky" within a short
grace window so brief app-switching stays fluid, while a full app close always
re-locks and leaves no trace — including in call history.

## Clarifications

### Session 2026-06-26

- **PIN model (FR-015)**: RESOLVED → a **separate, dedicated** Hidden Chats PIN,
  distinct from the app-unlock PIN (defense-in-depth; unlocking the app does not
  reveal hidden chats).
- **Distinct-conversation model (FR-017)**: ADOPTED → a hidden chat is a separate
  conversation (modeled on the group mechanism) that coexists with the normal 1:1;
  hiding never consumes or alters the visible conversation. *Open consequence to
  confirm:* the other participant(s) see this separate conversation as a normal
  chat on their device (hidden-ness is strictly local). See open question below.
- **Reveal grace window (FR-005)**: ADOPTED → revealed hidden chats stay revealed
  across brief backgrounding for a short, configurable timeout (assumed default 1
  minute, options up to 5 minutes) and ALWAYS re-lock on full app termination.
- **Call-history trail (FR-019)**: ADOPTED → calls and missed calls in hidden
  chats are never logged in the Calls tab / call history.
- **Counterpart visibility (FR-018)**: RESOLVED → acceptable that the other
  participant sees the hidden chat as a normal separate conversation; hidden-ness is
  strictly local to the hiding device.
- **PIN-reset wipe scope (FR-016)**: RESOLVED → reset permanently deletes the local
  history of hidden conversations AND blocks them from re-syncing from the server on
  this device (strongest/Viber-style permanence).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Hide a conversation behind a PIN (Priority: P1)

A user wants a specific conversation to stop showing up in their chat list. From
that chat (or via a long-press on the chat row), they choose **Hide Chat**. The
first time, they are asked to create a Hidden Chats PIN. After confirming, the
conversation disappears from the Chats tab. Handing the phone to someone else,
the conversation is nowhere to be found in the normal UI.

**Why this priority**: This is the core of the feature and the minimum viable
slice — the ability to remove a conversation from view and gate it behind a
secret. Without it nothing else matters.

**Independent Test**: Hide a 1:1 chat, confirm it vanishes from the Chats tab and
from search-by-name, and confirm a PIN was required to create the hidden state.
Delivers the headline privacy value on its own.

**Acceptance Scenarios**:

1. **Given** a visible 1:1 chat and no Hidden Chats PIN yet, **When** the user
   chooses Hide Chat, **Then** they are prompted to create and confirm a PIN, and
   on success the chat leaves the Chats tab.
2. **Given** a Hidden Chats PIN already exists, **When** the user hides another
   chat, **Then** the chat is hidden immediately without re-entering the PIN
   creation flow.
3. **Given** a hidden chat, **When** the user browses the Chats tab and the
   normal in-app search, **Then** the hidden chat does not appear in either.
4. **Given** a group chat, **When** the user chooses Hide Chat, **Then** it is
   hidden using the same flow as a 1:1 chat.

---

### User Story 2 - A hidden chat coexists with the normal chat (Priority: P1)

A user wants a private side-conversation with a friend they *also* have a normal,
fully visible chat with. The hidden chat is a **separate conversation** with its
own history — the everyday chat keeps working and stays visible and tracked,
while the hidden one only appears after the PIN is entered. Both can be active at
the same time without one masking or overwriting the other.

**Why this priority**: This is the structural decision that makes the feature
coherent. If "hidden" were just a flag on the single canonical 1:1, a user could
never have both a visible chat and a hidden chat with the same person — they'd
collide. Treating the hidden chat as a distinct conversation (modeled on the
group mechanism, reusing existing crypto) is what makes coexistence possible, so
it ships with the MVP.

**Independent Test**: With a friend you have a normal visible 1:1 with, create
and use a hidden chat with that same friend; confirm the visible 1:1 is unchanged
and still listed, and that the hidden conversation is a separate thread that only
appears after entering the PIN.

**Acceptance Scenarios**:

1. **Given** a normal visible 1:1 with a contact, **When** the user has a hidden
   chat with that same contact, **Then** both conversations exist independently —
   the visible one stays in the Chats tab with its own history, the hidden one
   only appears on reveal.
2. **Given** messages sent in the hidden chat, **When** the user views the visible
   1:1, **Then** those messages do not appear in the visible conversation (and
   vice versa) — the two threads never merge.
3. **Given** the hidden chat is a distinct conversation, **When** it is created,
   **Then** it reuses the existing conversation/crypto machinery rather than a new
   bespoke scheme (no new key-exchange or ratchet design).
4. **Given** the other participant's device, **When** they receive the hidden
   chat's messages, **Then** they see it as a normal separate conversation on
   their side (hidden-ness is local to the hiding user) unless they also hide it.

---

### User Story 3 - Reveal and unhide a conversation with the PIN (Priority: P1)

The user needs to get back into a hidden conversation. They perform the reveal
gesture — entering their PIN in the chat-list search field — and the hidden
conversations matching that PIN appear, openable for the session. From a revealed
chat they can also permanently **Unhide** it so it returns to the normal list.

To keep the experience fluid, revealing is "sticky" for a short, configurable
grace window: stepping out of the app to copy-paste or check something else does
**not** immediately re-lock. The reveal persists across brief backgrounding until
the grace window elapses — and, regardless of the timer, a **full app close
always re-locks**. After a full close, even reopening immediately shows no hidden
chats. Privacy is therefore never more than one full app-close away.

**Why this priority**: A hide feature with no reliable way back in is unusable.
Reveal + unhide is the other half of the MVP and must ship with US1.

**Independent Test**: With a chat already hidden, enter the PIN via the reveal
gesture, confirm the hidden chat becomes openable, read it, switch apps briefly
and return to confirm it is still revealed within the grace window, then unhide
it and confirm it returns to the normal Chats tab.

**Acceptance Scenarios**:

1. **Given** one or more hidden chats, **When** the user enters the correct PIN in
   the reveal gesture, **Then** the matching hidden chats become visible and
   openable.
2. **Given** the reveal gesture, **When** the user enters an incorrect PIN, **Then**
   no hidden chats are revealed and no hint is given that hidden chats exist.
3. **Given** a revealed hidden chat, **When** the user chooses Unhide, **Then** the
   chat returns permanently to the Chats tab and no longer requires the PIN.
4. **Given** hidden chats are currently revealed, **When** the user briefly
   switches to another app and returns within the grace window, **Then** the
   hidden chats are still revealed without re-entering the PIN.
5. **Given** hidden chats are currently revealed, **When** the grace window
   elapses while backgrounded **or** the app is fully closed (whichever happens
   first), **Then** the chats return to hidden and the PIN is required again.
6. **Given** the app was fully closed while hidden chats were revealed, **When**
   the user reopens it immediately, **Then** no hidden chats appear and there is
   no trace that any were revealed.

---

### User Story 4 - Private notifications for hidden chats (Priority: P2)

The user keeps receiving messages in a hidden conversation. A notification still
arrives so they aren't cut off, but it shows no sender name, avatar, or message
content — only a neutral, generic prompt. Tapping it does not open the hidden
chat or reveal that it exists; it lands on the normal Chats tab, where the hidden
chat is still absent until the PIN is entered.

**Why this priority**: A real privacy feature must not leak through the lock
screen. It builds on US1/US2 but is a distinct, independently testable slice.

**Independent Test**: Hide a chat, send it a message from another account, and
confirm the resulting notification carries no sender/content preview and that
tapping it does not reveal or open the hidden chat.

**Acceptance Scenarios**:

1. **Given** a hidden chat, **When** it receives a new message, **Then** the
   notification shows a generic, content-free message with no sender name, avatar,
   or body text.
2. **Given** a hidden-chat notification, **When** the user taps it, **Then** they
   land on the Chats tab without the hidden chat being opened or revealed.
3. **Given** a mix of hidden and visible chats receiving messages, **When**
   notifications are shown, **Then** only the visible chats' notifications carry
   sender/content previews; hidden chats stay generic.
4. **Given** a hidden chat, **When** the device is offline and later reconnects,
   **Then** any queued notification for that chat still respects the no-preview
   rule.

---

### User Story 5 - Hidden chats leave no trace in call history (Priority: P2)

The user makes and receives calls in a hidden conversation. Those calls — placed,
received, and **missed** — never appear in the Calls tab or call history. Like
messages, an incoming call from a hidden chat is delivered with no identifying
preview on the pre-answer surface, and nothing about it is logged where someone
browsing the phone could see it.

**Why this priority**: Call history is a second, easy-to-forget leak path. A
privacy feature that hides the chat but lists the calls right next to it would
defeat itself. Independently testable and important enough to ship with the core.

**Independent Test**: Place and miss calls in a hidden chat, then browse the Calls
tab and confirm none of them are listed, while calls in visible chats still are.

**Acceptance Scenarios**:

1. **Given** a hidden chat, **When** a call is placed or completed in it, **Then**
   it does not appear in the Calls tab / call history.
2. **Given** a hidden chat, **When** a call from it is missed, **Then** no missed-
   call entry appears in call history and no missed-call badge attributes to it.
3. **Given** a hidden chat, **When** an incoming call arrives, **Then** the
   pre-answer surface follows the no-preview rule (no hidden contact/group
   identity shown).
4. **Given** a chat that is later unhidden, **When** the user views call history,
   **Then** the previously hidden calls remain absent (they were never logged),
   consistent with the documented behavior.

---

### User Story 6 - Optional biometric unlock (Priority: P3)

A user who finds typing a PIN repeatedly tedious enables biometric unlock (e.g.
device fingerprint/face) for the reveal gesture. When enabled, the reveal step
offers biometrics and falls back to the PIN if biometrics fail or are
unavailable. Biometrics never replace the PIN as the recovery secret — the PIN
always works.

**Why this priority**: A convenience layer on top of the PIN. Valuable but
strictly optional, and the feature is complete without it.

**Independent Test**: With biometrics enabled on a device that supports them,
trigger reveal, authenticate biometrically, and confirm hidden chats appear
without typing the PIN; then disable biometrics and confirm PIN entry is required
again.

**Acceptance Scenarios**:

1. **Given** biometric unlock is available and enabled, **When** the user triggers
   reveal, **Then** they may authenticate biometrically instead of typing the PIN.
2. **Given** biometric authentication fails or is cancelled, **When** the user
   triggers reveal, **Then** they can still enter the PIN to reveal hidden chats.
3. **Given** a device with no biometric support, **When** the user opens Hidden
   Chats settings, **Then** the biometric option is unavailable/disabled and the
   PIN flow is unaffected.

---

### User Story 7 - Reset the Hidden Chats PIN (Priority: P3)

A user who has forgotten their PIN needs a way out. From Settings they can reset
the Hidden Chats PIN. Because the PIN is the only key to the hidden state and is
never recoverable from the server, resetting it is **destructive**: it permanently
deletes the local history of every hidden conversation on this device and blocks
those conversations from re-downloading from the server, so a forced reset can
never expose their contents. The user is clearly warned about exactly what is lost
before they confirm.

**Why this priority**: A necessary escape hatch, but an edge path most users
never hit. Ships after the core flows.

**Independent Test**: With hidden chats present and the PIN forgotten, perform a
PIN reset, confirm the explicit destructive warning is shown, confirm the hidden
conversations' local history is gone afterward, and confirm they do not reappear
via sync.

**Acceptance Scenarios**:

1. **Given** a Hidden Chats PIN is set, **When** the user chooses Reset PIN,
   **Then** they are shown an explicit, specific warning that hidden conversations
   will be permanently deleted, and must confirm before anything is cleared.
2. **Given** the user confirms the reset, **When** it completes, **Then** the old
   PIN no longer works, a new PIN can be created from scratch, and the previously
   hidden conversations' local history is permanently gone.
3. **Given** the reset deleted hidden conversations, **When** the device continues
   syncing, **Then** those conversations do NOT re-download/reappear on this device.
4. **Given** the user cancels the reset, **When** they return, **Then** their PIN
   and hidden chats are unchanged.

---

### Edge Cases

- **Last chat unhidden / all chats unhidden**: when no chats remain hidden, the
  reveal gesture must behave exactly as it did before the feature existed (e.g. a
  PIN-shaped search query just returns normal search results), giving no signal
  that the feature is even in use.
- **New message into a hidden chat while it is currently revealed**: it appears in
  the open conversation like any message; when the reveal session ends it is
  hidden again.
- **Hiding a chat that is currently open**: hiding navigates the user out and
  requires the PIN to return.
- **Grace window vs. full close**: a revealed session survives brief backgrounding
  up to the grace window, but a full app termination re-locks immediately and
  unconditionally — even an instant relaunch shows no hidden chats and no "recently
  revealed" trace.
- **Incorrect PIN attempts**: repeated wrong PINs must not lock the user out of the
  rest of the app, and must not confirm or deny that any hidden chats exist.
- **Hidden chat with the same person as a visible 1:1**: the hidden conversation
  and the visible 1:1 stay fully independent — separate histories, separate unread
  state — and neither leaks into the other.
- **Unread badges / counts**: aggregate unread indicators must not let a hidden
  chat's unread count visibly attribute to that chat or reveal its existence.
- **Per-device divergence**: because hiding is local, the same conversation can be
  hidden on one of the user's devices and visible on another; this is expected and
  must not cause sync errors.
- **App reinstall / data wipe**: losing local data clears hidden state along with
  everything else; chats re-sync as normal *visible* chats (no hidden flag is
  restored from the server, because the server never had it).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Users MUST be able to mark any 1:1 or group conversation as hidden
  from within that chat and/or from a long-press action on its chat-list row.
- **FR-002**: A hidden chat MUST NOT appear in the Chats tab, in name/keyword
  search, in recent-chats surfaces, in any chat picker, or in the Calls tab / call
  history, while it is hidden.
- **FR-003**: The first time a user hides a chat, the system MUST require them to
  create and confirm a Hidden Chats PIN before the chat is hidden.
- **FR-004**: Users MUST be able to reveal hidden chats by entering the correct
  PIN via the reveal gesture (entering the PIN in the chat-list search field); an
  incorrect PIN MUST reveal nothing and MUST NOT disclose whether any hidden chats
  exist.
- **FR-005**: Revealed hidden chats MUST stay revealed across brief app
  backgrounding for a configurable grace window, and MUST return to the hidden
  state when (a) the grace window elapses, (b) the app is fully closed/terminated,
  or (c) the user explicitly re-hides — whichever happens first. After a full
  close, an immediate relaunch MUST show no hidden chats and no trace that any were
  revealed.
- **FR-006**: Users MUST be able to permanently unhide a revealed chat so it
  returns to the normal Chats tab and no longer requires the PIN.
- **FR-007**: Notifications for messages in a hidden chat MUST be delivered without
  any sender name, avatar, or message content — only a neutral, generic message.
- **FR-008**: Tapping a hidden-chat notification MUST NOT open or reveal the hidden
  chat; it MUST land on the normal Chats tab with the hidden chat still hidden.
- **FR-009**: The hidden designation and the PIN MUST be stored only on the local
  device and MUST NEVER be transmitted to or stored on the server in any form
  (including logs, metrics, or sync payloads).
- **FR-010**: The PIN MUST be verified without storing it in recoverable plaintext,
  and the local record of which chats are hidden MUST be protected at rest so it
  cannot be read off the device without the PIN (or enabled biometric).
- **FR-011**: Users MUST be able to optionally enable biometric unlock for the
  reveal gesture; biometrics MUST be a convenience over the PIN, never a
  replacement — the PIN MUST always work.
- **FR-012**: Users MUST be able to reset the Hidden Chats PIN; the system MUST
  show an explicit, specific destructive-consequences warning and require
  confirmation before clearing anything.
- **FR-013**: The Hidden Chats controls (enable, change PIN, reset PIN, biometric
  toggle, grace-window duration) MUST live in the app's Settings (Privacy) area.
- **FR-013a**: Disabling the Hidden Chats feature MUST NEVER expose existing hidden
  conversations: it only removes the entry points (Hide action, reveal gesture).
  Already-hidden conversations remain hidden and protected; revealing them still
  requires the PIN (or, where supported, re-enabling and unlocking). Disabling MUST
  NOT, by itself, unhide, wipe, or surface any hidden conversation.
- **FR-014**: When no chats are hidden, every surface MUST behave exactly as before
  the feature existed, giving no observable signal that the feature is in use.
- **FR-015**: The Hidden Chats PIN MUST be a separate, dedicated PIN distinct from
  the app-unlock PIN; unlocking the app MUST NOT reveal hidden chats. (Resolved
  2026-06-26.)
- **FR-016**: Resetting the Hidden Chats PIN MUST permanently delete the local
  history of all hidden conversations on this device AND mark those conversations so
  they do **not** re-sync/re-download from the server on this device — so a forced
  reset can never expose hidden contents, even later. The destructive warning
  (FR-012) MUST state this clearly before the user confirms. (Resolved 2026-06-26.)
- **FR-017**: A hidden chat MUST be a distinct conversation that can coexist with a
  normal, visible conversation involving the same participants; creating or
  maintaining a hidden chat MUST NOT remove, alter, or merge into the user's
  existing visible conversation. The distinct conversation MUST reuse Ring's
  existing conversation/crypto machinery (the group mechanism), not a new
  hand-rolled scheme (Constitution Principle IV).
- **FR-018**: "Hidden" MUST be a strictly local-to-the-device property: the other
  participant(s) of a hidden conversation see it as a normal separate conversation
  on their own device unless they independently hide it. The system MUST NOT
  attempt to hide the conversation on anyone else's device.
- **FR-019**: Calls in a hidden chat — placed, received, and missed — MUST NOT be
  logged in the Calls tab / call history, and MUST NOT raise a missed-call badge
  attributable to the hidden chat. An incoming call from a hidden chat MUST follow
  the no-preview rule on its pre-answer surface.
- **FR-020**: The grace-window duration MUST be user-configurable (options:
  immediately / 1 minute / 5 minutes) and MUST default to **1 minute**. A full app
  termination MUST always re-lock regardless of the configured duration.
- **FR-021**: The feature MUST fail closed: if the protected hidden state cannot
  be read or decrypted (locked, corrupt, or unavailable), the system MUST treat
  affected conversations as hidden and notifications as content-free, never
  defaulting to exposing them.
- **FR-022**: An incorrect reveal-PIN attempt MUST NOT lock the user out of the
  rest of the app, MUST NOT reveal whether any hidden chats exist, and the PIN
  check MUST rely on a deliberately slow key derivation (the existing Argon2id
  cost) as its brute-force mitigation; no faster comparison path may exist.
- **FR-023**: The reveal grace window MUST be measured by actual elapsed
  background time such that manipulating the device clock cannot extend a reveal
  session beyond the configured duration.
- **FR-024**: A PIN reset's wipe MUST be atomic with respect to exposure: it MUST
  NOT leave a partially-wiped state in which a hidden conversation becomes visible
  or readable. If interrupted, the conversation MUST remain hidden/locked until
  the wipe completes.
- **FR-025**: When the app's existing auto-lock and an active reveal session
  coincide, the more restrictive state MUST win — an app lock MUST also end any
  reveal session (hidden chats never remain revealed behind a locked app).

### Key Entities *(include if feature involves data)*

- **Hidden Chats lock**: the per-device secret state that gates hidden chats — a
  verifier for the PIN and the key material protecting the hidden set at rest.
  Holds no server-visible data; recoverable only with the PIN (or enabled
  biometric).
- **Hidden conversation**: a distinct conversation (modeled on the group
  mechanism) that may coexist with a normal visible conversation between the same
  people. It is an ordinary conversation on the wire; only its *hidden designation*
  is special, and only locally.
- **Hidden designation**: a per-device, per-conversation marker that a given
  conversation is hidden. Exists only locally, protected at rest, never synced.
- **Reveal session**: ephemeral state indicating hidden chats are currently
  unlocked for viewing; persists across brief backgrounding until the grace window
  elapses and is cleared on grace expiry, full app termination, or explicit
  re-hide.
- **Auto-lock timeout preference**: a local setting for the grace-window duration
  (e.g. immediately / 1 min / 5 min) governing how long a reveal survives
  backgrounding.
- **Biometric preference**: a local on/off setting recording whether biometric
  unlock is enabled for the reveal gesture on this device.

## Zero-Knowledge Impact *(mandatory — Constitution Principle I)*

- **What crosses the wire**: Nothing new. Hidden Chats adds no new client→server
  request, field, or payload. Messages for hidden chats continue to flow as the
  same sealed envelopes as any other chat; the server cannot distinguish a hidden
  chat from a visible one.
- **What is encrypted / protected**: The PIN is never stored in recoverable form;
  the set of hidden-chat ids and the lock state are protected at rest on the device
  (consistent with Ring's existing PIN-derived at-rest wrapping for secrets), so
  the hidden designation cannot be read off the device without the PIN/biometric.
- **What metadata is unavoidably visible to the server**: Unchanged from today. The
  server still relays ciphertext envelopes and sees the same relay-required
  metadata it already sees for every chat. It gains **no** new signal that a chat is
  hidden, that the feature is enabled, or that a PIN exists.
- **Distinct conversation (group model)**: A hidden chat realized as a separate
  conversation is, to the server, just another opaque conversation/group — the same
  thing it already relays. Group membership is already encrypted and invisible to
  the server, so it cannot tell that a hidden conversation shares participants with
  a visible 1:1, nor that it is "hidden." Calls in a hidden chat ride the existing
  call signalling/relay unchanged; hiding them is purely a local call-history
  concern.
- **Notifications**: The push path already carries no plaintext to the server; the
  no-preview rule is enforced entirely on the client when rendering the
  notification, so the privacy guarantee does not depend on the server.
- **Why this is safe**: Hidden Chats is a client-only visibility layer over content
  that is already end-to-end encrypted. It cannot weaken the zero-knowledge
  boundary because it never introduces a new thing for the server to know.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A hidden chat appears in **zero** user-facing surfaces (Chats tab,
  search, pickers, recents, Calls tab / call history) while hidden, verified across
  all such surfaces — including missed calls.
- **SC-002**: 100% of notifications for hidden chats render with no sender name,
  avatar, or content — only the generic message — including offline-queued and
  burst cases.
- **SC-003**: A user can hide a chat and later reveal it with the PIN in under 15
  seconds each way, on first attempt, without external help.
- **SC-004**: The server receives **no** new field, request, or log entry as a
  result of a chat being hidden — confirmed by inspecting the client/server wire
  for a hidden vs. visible chat and seeing them indistinguishable.
- **SC-005**: With no chats hidden, the app is behaviorally identical to before the
  feature (the reveal gesture produces normal search results), so the feature's
  presence is unobservable.
- **SC-006**: An incorrect PIN at the reveal gesture never reveals a hidden chat and
  never produces UI that confirms hidden chats exist (no error that differs from the
  all-chats-visible case).
- **SC-007**: Losing/forgetting the PIN has a defined, warned recovery path; after a
  PIN reset the hidden conversations' local history is gone and does not reappear via
  sync, so no recovery path exposes hidden content without the PIN or enabled
  biometric.
- **SC-008**: A normal visible conversation and a hidden conversation with the same
  participant(s) coexist with fully independent histories — confirmed by exchanging
  messages in each and seeing no cross-contamination.
- **SC-009**: After a full app close, hidden chats are re-locked 100% of the time,
  with no observable difference between "just revealed then closed" and "never
  revealed" on the next launch.

## Assumptions

- **Local-only by design (v1)**: Per the feature description, hiding is per-device
  and is *not* synced across the user's own linked devices in v1. A future spec
  could E2E-sync the hidden designation between a user's own devices; out of scope
  here.
- **Reveal gesture**: The reveal mechanism is entering the PIN in the chat-list
  search field (mirroring Viber), chosen because it adds no discoverable entry
  point. The exact gesture can be refined in plan/UX without changing scope.
- **At-rest protection reuses existing machinery**: Protecting the hidden set and
  verifying the PIN build on Ring's existing PIN-derived, Argon2id-wrapped at-rest
  secret handling rather than inventing new crypto (Constitution Principle IV).
- **Distinct conversation via the group mechanism**: The hidden conversation reuses
  Ring's existing group/sender-key conversation primitive to obtain a distinct
  identity that coexists with the canonical 1:1. This is an implementation reuse
  direction (Principle IV) to be confirmed in the plan; the spec-level requirement
  is only that the hidden chat be a distinct, coexisting conversation.
- **Counterpart visibility**: Confirmed acceptable — because hiding is local, the
  other side sees the hidden conversation as a normal separate chat unless they also
  hide it (FR-018). This matches "hiding a chat on your phone does not hide it on
  anyone else's."
- **Grace-window default**: Assumed default of ~1 minute, user-configurable up to a
  few minutes, with an "immediately" option; a full app close always re-locks. Exact
  values are a plan/UX detail.
- **Settings placement**: Controls live under Settings → Privacy via the
  declarative settings schema (Constitution Principles X/XI), not a bespoke screen,
  wherever the stock components allow it.
- **PIN format**: A numeric PIN (Viber uses 4 digits); exact length/format is a
  plan-level UX detail, assumed to align with Ring's existing app-PIN conventions.
- **Group hiding hides the conversation, not membership**: hiding a group chat
  removes it from view locally; it does not leave the group or change anything other
  members or the server can observe.

## Out of Scope

- Syncing the hidden state across a user's own devices.
- Hiding a contact from the Contacts tab (the conversation and its calls are hidden;
  the contact entry itself is a potential follow-up).
- A separate "vault" for hidden *media/files* distinct from the chats themselves.
- Server-side enforcement of any kind (the feature is intentionally client-only).
- Disappearing-messages / auto-delete behavior for hidden chats (separate concern).

## Dependencies

- Ring's existing PIN / at-rest secret-wrapping machinery (Argon2id-derived key).
- The existing group/conversation primitive (sender keys) reused to mint the
  distinct, coexisting hidden conversation.
- The existing notification rendering path (client-side), where the no-preview rule
  is enforced.
- The existing chat-list, search, chat-picker, and Calls tab / call-history
  surfaces that must learn to exclude hidden chats (including missed calls).
- The app lifecycle / foreground-background signals used to drive the reveal grace
  window and re-lock on full close.
- The own-data sync path, which must support marking specific conversations as
  "do not re-sync to this device" so a PIN reset's wipe is permanent (FR-016).
