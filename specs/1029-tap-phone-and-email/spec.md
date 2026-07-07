# Feature Specification: Tap a Phone Number or Email in Messages & Posts

**Feature Branch**: `feat/1028-robust-audio-and`
<!-- Shares the 1028 branch by request: 1028 (calls) + 1029 (this) land in one PR to
     develop. The spec id/category still come from this directory number (1029, ad-hoc). -->

**Created**: 2026-07-02

**Status**: shipped
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "Make it possible to call a phone number detected in a post or message, or send an email to an email address found in a post or a message; also copy them, as well as placing a call, sending a message or sending an email."

## Overview

Text in Ring often contains a phone number or an email address — "call me on
+1 415 555 0134" or "email hello@example.com". Today those are inert plain text:
you have to select, copy, switch apps, and paste. This feature detects phone
numbers and email addresses inside **chat messages** and **Wall posts** and makes
them tappable, so a tap offers the obvious actions and hands off to the device's
own apps.

Ring has no telephone network, SMS, or email of its own, so these actions hand off
to the operating system: **Call** opens the phone dialer, **Message** opens the SMS
app, **Email** opens the mail app, and **Copy** puts the value on the clipboard.
Detection and the whole interaction happen entirely on the device, on text that is
already decrypted locally — nothing new is sent to the server.

## Clarifications

### Session 2026-07-02

- Q: What should the Call / Message / Email actions do, given Ring has no
  PSTN/SMS/email of its own? → A: Native app hand-off — Call opens the device
  dialer (`tel:`), Email opens the mail app (`mailto:`), plus Copy.
- Q: For a detected PHONE number, what does "Send a message" do? → A: SMS via the
  native app (`sms:`).
- Q: How is this organized relative to the calls work? → A: A separate spec (1029)
  built on the 1028 branch so both land in one PR to develop.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Act on a phone number in a message or post (Priority: P1)

A friend messages "reach me at +1 415 555 0134" (or posts it on the Wall). The
number appears as a tappable link. Tapping it offers **Call**, **Message**, and
**Copy**. Call opens the phone dialer pre-filled with the number; Message opens the
SMS app; Copy puts the number on the clipboard with a brief confirmation.

**Why this priority**: Phone numbers are the most common actionable entity and the
"call it" action is the headline of the request.

**Independent Test**: Send a message containing a phone number; confirm it renders
as a tappable link; tap it and confirm the action menu offers Call / Message /
Copy; confirm Call and Message target the correct `tel:` / `sms:` value and Copy
places the exact number on the clipboard.

**Acceptance Scenarios**:

1. **Given** a message or post whose text contains a phone number, **When** it is
   displayed, **Then** the number is rendered as a distinct tappable element while
   the surrounding text is unchanged.
2. **Given** a tappable phone number, **When** the user taps it, **Then** an action
   menu offers Call, Message, and Copy.
3. **Given** the action menu, **When** the user chooses Call, **Then** the device's
   phone dialer opens targeting that number; **when** Message, the SMS app opens;
   **when** Copy, the number is placed on the clipboard with a confirmation.

---

### User Story 2 - Act on an email address in a message or post (Priority: P1)

A message or post contains "hello@example.com". It appears as a tappable link;
tapping offers **Email** and **Copy**. Email opens the mail app composing to that
address; Copy places it on the clipboard.

**Why this priority**: Email is the second common actionable entity and pairs
naturally with phone in the same detection/menu mechanism.

**Independent Test**: Send a message containing an email address; confirm it renders
tappable; tap it and confirm the menu offers Email / Copy; confirm Email targets the
correct `mailto:` value and Copy places the exact address on the clipboard.

**Acceptance Scenarios**:

1. **Given** a message or post whose text contains an email address, **When** it is
   displayed, **Then** the address is rendered as a distinct tappable element.
2. **Given** a tappable email address, **When** the user taps it, **Then** an action
   menu offers Email and Copy.
3. **Given** the action menu, **When** the user chooses Email, **Then** the mail app
   opens composing to that address; **when** Copy, the address is placed on the
   clipboard with a confirmation.

---

### Edge Cases

- **Multiple entities in one text**: each detected number/email is independently
  tappable; detecting one never swallows another or the text between them.
- **Overlap with existing links**: a URL, an `@mention`, and an email in the same
  message all render correctly without one detector clobbering another (email is
  not mistaken for a URL, an `@mention` handle is not mistaken for an email).
- **Ambiguous digit runs**: only plausible phone numbers are linkified (avoid
  turning order numbers, code snippets, or long id strings into "call" links);
  a conservative match is preferred over a false "Call" affordance.
- **Formatting variety**: numbers with `+`, spaces, dashes, parentheses, or dots are
  detected, and the value handed to the dialer is normalized to what a dialer
  accepts.
- **Email edge forms**: sub-addressing (`a+b@x.com`), dotted local parts, and
  multi-label domains are detected; a trailing period/paren after the address is not
  included in the address.
- **No native handler**: on a platform where `tel:`/`sms:`/`mailto:` has no handler,
  the action fails gracefully (Copy always works as a fallback).
- **Right-to-left / mixed text**: a detected entity inside RTL text stays correctly
  placed and tappable (no direction regression).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST detect phone numbers and email addresses within the
  displayed text of **chat messages** and **Wall posts** and render each as a
  distinct tappable element, leaving the surrounding text and its layout unchanged.
- **FR-002**: Tapping a detected **phone number** MUST present actions: **Call**
  (open the device dialer, `tel:`), **Message** (open the SMS app, `sms:`), and
  **Copy** (place the number on the clipboard).
- **FR-003**: Tapping a detected **email address** MUST present actions: **Email**
  (open the mail app composing to it, `mailto:`) and **Copy**.
- **FR-004**: **Copy** MUST place the exact detected value on the clipboard and show
  a brief confirmation.
- **FR-005**: Detection MUST coexist with the existing inline features (URL links and
  `@mentions`) so that all render correctly in the same text with no detector
  overriding another.
- **FR-006**: Detection MUST be conservative — plausible phone numbers and
  well-formed email addresses only — to avoid false "Call"/"Email" affordances on
  unrelated digit runs or tokens.
- **FR-007**: The value handed to the native app MUST be normalized appropriately
  (a dial-safe phone string for `tel:`/`sms:`, the plain address for `mailto:`), and
  trailing punctuation MUST NOT be included in the entity.
- **FR-008**: All detection, rendering, and hand-off MUST happen on the device; the
  feature MUST add no new client→server data and MUST NOT weaken text-rendering
  safety (detected text stays escaped; nothing user-provided is rendered as raw
  markup).
- **FR-009**: When a native handler is unavailable, the action MUST fail gracefully
  and Copy MUST remain available.

### Key Entities *(include if feature involves data)*

- **Detected entity**: a span within a text body classified as a phone number or an
  email address, with its display text (as written) and its normalized action value
  (dial string or address). Purely derived at render time; nothing is stored.

## Zero-Knowledge Impact *(mandatory — Constitution Principle I)*

- **What crosses the wire**: Nothing. Detection runs entirely on the client over text
  that is already decrypted locally (a message body / post body). No new request,
  field, or payload is introduced; the server never learns that an entity was
  detected or acted on.
- **What is encrypted / protected**: Message and post bodies remain end-to-end
  encrypted exactly as today; this feature only affects how already-decrypted text is
  displayed and what local OS action a tap triggers.
- **What metadata is unavoidably visible**: Unchanged. Tapping Call/Message/Email
  hands off to the operating system (`tel:`/`sms:`/`mailto:`), a purely local action
  the Ring server has no part in and cannot observe.
- **Why this is safe**: It is a client-only presentation + OS hand-off layer over
  content that is already local and encrypted; it introduces nothing for the server
  to know and no new attack surface beyond safe text rendering (which is preserved).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A phone number in a message or post is tappable and offers Call,
  Message, and Copy in 100% of the supported formatting variations tested (plain,
  `+`-prefixed, spaced, dashed, parenthesized).
- **SC-002**: An email address in a message or post is tappable and offers Email and
  Copy in 100% of tested well-formed variations (plain, sub-addressed, dotted local,
  multi-label domain).
- **SC-003**: Call/Message/Email target the exact normalized `tel:`/`sms:`/`mailto:`
  value, and Copy places the exact detected value on the clipboard, in 100% of tests.
- **SC-004**: URLs, `@mentions`, phone numbers, and emails in the same text all render
  correctly together with zero cross-detector corruption across the test corpus.
- **SC-005**: The conservative matcher produces zero false Call/Email affordances on a
  corpus of non-entity digit/text runs (order numbers, hashes, code).
- **SC-006**: No new data crosses the client/server boundary and text rendering stays
  injection-safe (verified by the detector/renderer unit tests and the ZK check).

## Assumptions

- **Native hand-off model** (clarified): Call → `tel:`, Message → `sms:`, Email →
  `mailto:`; the OS owns the actual call/SMS/email. Ring places no PSTN/SMS/email
  itself.
- **Detection surfaces**: chat message bodies and Wall post bodies (the two places
  the user named). Other text surfaces (contact "about", captions) are out of scope.
- **Rendering reuse**: detection plugs into the existing message/post text renderer
  alongside URL/@mention handling rather than introducing a separate renderer.
- **Clipboard + confirmation**: reuse the app's existing clipboard + toast pattern.
- **Conservative matching**: err toward missing an unusual number over falsely
  linkifying a non-number; the goal is no misleading "Call" affordances.

## Out of Scope

- Placing calls, sending SMS, or sending email from within Ring itself (all hand off
  to native apps).
- Detecting entities in surfaces other than chat messages and Wall posts.
- Rich contact actions (add to contacts, detect names/addresses); only phone numbers
  and email addresses are detected.
- A settings toggle to disable detection (can be a later addition if wanted).
- Deep phone-number libphonenumber-grade parsing/validation beyond a conservative,
  dependency-light matcher.
