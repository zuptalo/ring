# Feature Specification: Mentions show the name you know someone by, and stay readable

**Feature Branch**: `feat/1064-mention-names`

**Created**: 2026-07-28

**Status**: shipped
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User request (with screenshots): "When tagging someone in a message, let's use their defined name in a hyperlinked manner which opens their contact info, if a user has customized the name for them let's use their defined customized name as well, let's make the tags bold and green as the logo color if possible in the chat bubbles as long as it doesn't collide with background color and become hard to read in bright or dark themes, do the same for in app notifications as well."

## Context: why this exists

Spec 1020 already built most of what was asked: a mention resolves to the member's **current display name**, renders as a tappable chip that opens their contact page, and is styled in the brand green. The request landed because in practice it didn't look like that — the reporter's screenshot shows a bare `@parham.hoseini`. Three gaps explain it.

**1. The handle charset excluded dots — and this is not cosmetic.** A username may legally contain interior dots (`^[A-Za-z0-9_](?:[A-Za-z0-9_.]{1,28}[A-Za-z0-9_])$`, enforced identically on client and server). But all four places that read a handle used `[a-zA-Z0-9_]+`, so `@parham.hoseini` matched only as `@parham`, which resolves to nobody. The visible symptom was raw text. The invisible one was worse: the same narrow charset is used by the **send-time resolve**, so the message stored an **empty mentions array** — and that array is what marks the frame as a mention. A person whose handle contains a dot was therefore never notified, never pierced a mute, and never lit the "@" badge. Every handle built from letters, digits and underscores worked; only dotted ones silently failed. Verified by A/B: pre-fix a message mentioning one dotted and one underscore handle registered **1 of 2**; post-fix, **2 of 2**.

**2. The brand green is unreadable on the light bubbles.** The reporter's proviso — "as long as it doesn't collide with background colour" — was already being violated. The brand green `#10b981` is a *light* green; measured against the bubbles:

| bubble | contrast | |
|---|---|---|
| dark incoming `#232d33` | 5.54:1 | fine |
| dark outgoing `#103a2c` | 4.98:1 | fine |
| light incoming `#e7e8ec` | **2.07:1** | unreadable |
| light outgoing `#d6f3cc` | **2.12:1** | unreadable |

Separately, the "mentions me" pill painted white text on the brand green — **2.54:1**, also failing, in the theme where it is most used.

**3. Notifications showed the raw handle.** The chat bubble resolved names; the notification body was the message text verbatim, so a mention read as a directory handle in exactly the surface where you have least context.

Nothing here needs new data: `Contact.name` already holds the local rename, so "use their customized name" falls out of resolving at display time on each device.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Mentioning someone actually notifies them (Priority: P1)

I @mention a group member and they are alerted, whatever their handle looks like.

**Why this priority**: Silent failure of the core purpose of a mention. The sender believes they got someone's attention; the recipient never hears about it.

**Independent Test**: In a group, mention one member whose handle contains a dot and one whose doesn't; confirm both are recorded as mentioned on the sender's and recipients' copies.

**Acceptance Scenarios**:

1. **Given** a member whose handle contains a dot, **When** I mention them, **Then** the message records them as mentioned and they are alerted.
2. **Given** a member with a plain handle, **When** I mention them, **Then** behaviour is unchanged.
3. **Given** I type a dotted handle, **When** the autocomplete is open, **Then** it stays open across the dot and completes the whole handle.

---

### User Story 2 - A mention reads as the person, not a handle (Priority: P1)

A mention displays the name I know that person by — including a name I set myself — and tapping it opens their contact info.

**Why this priority**: The stated request, and the visible half of the same defect.

**Independent Test**: Rename a contact locally, mention them, and confirm the bubble shows the local name and no raw handle.

**Acceptance Scenarios**:

1. **Given** a mentioned contact, **When** the message renders, **Then** it shows their display name, not the handle.
2. **Given** I renamed that contact locally, **Then** my name for them is used.
3. **Given** a rendered mention, **When** I tap it, **Then** their contact page opens.
4. **Given** an "@word" that matches nobody, **Then** it stays ordinary text.
5. **Given** an email address in a message, **Then** it is never treated as a mention (it remains its own tappable entity).

---

### User Story 3 - Mentions stay readable in both themes (Priority: P2)

Mentions are bold and brand-coloured, and legible on every bubble in light and dark.

**Why this priority**: Explicitly asked for, and today's colour fails in light mode.

**Independent Test**: View a mention on incoming and outgoing bubbles in both themes and check contrast.

**Acceptance Scenarios**:

1. **Given** either theme, **When** a mention renders, **Then** its contrast against the bubble meets at least 4.5:1.
2. **Given** a mention of me, **When** it renders as a filled pill, **Then** the pill's text also meets 4.5:1.
3. **Given** either theme, **Then** the mention still reads as the brand accent, bold.

---

### User Story 4 - Notifications name the person too (Priority: P3)

A notification mentioning someone shows their name rather than a handle.

**Why this priority**: Requested, and the surface with least surrounding context — but it follows the same resolution as the bubble.

**Independent Test**: Trigger a notification for a message containing a mention and confirm the body shows the name.

**Acceptance Scenarios**:

1. **Given** a message containing a mention, **When** it surfaces as an in-app banner, **Then** the mention shows the display name.
2. **Given** the same message arriving via push, **Then** the system notification also shows the name.
3. **Given** an unresolvable handle, **Then** the notification text is left untouched.

---

### Edge Cases

- **A trailing sentence period** after a handle must not be absorbed into it.
- **An email address** must never be parsed as a mention — a live hazard now that dots are legal.
- **A handle must not begin or end with a dot**, matching the username rule.
- **Consecutive mentions** separated by one space must all resolve.
- **A handle that resolves to nobody** must render and read as plain text everywhere.
- **Mentions remain a group concept** (unchanged from spec 1020); 1:1 chats are not in scope.

## Zero-Knowledge Impact *(mandatory)*

- **What crosses the wire**: unchanged. The message body still carries the handle the sender typed, alongside the existing list of mentioned ids. No new field.
- **Where processing happens**: entirely on-device. Each device resolves handles against its OWN contacts, which is also why a local rename shows only to the person who set it.
- **Unavoidably-visible metadata**: unchanged. No new lookup leaves the device; the mentioned ids were already part of the sealed payload.
- **Why it stays zero-knowledge**: display-time naming from data already held locally.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Handle parsing MUST accept the full username charset, including interior dots, and MUST be defined once and shared by rendering, autocomplete, insertion and send-time resolution so they cannot diverge.
- **FR-002**: A mention of a dotted handle MUST be recorded in the message's mentions, so the mention alert, mute-piercing and "@" badge behave as for any other handle.
- **FR-003**: A handle MUST require a start-or-whitespace boundary, so an email address is never parsed as a mention.
- **FR-004**: A rendered mention MUST show the mentioned person's display name, preferring a locally set name.
- **FR-005**: A rendered mention MUST open that person's contact page when tapped.
- **FR-006**: A mention MUST be bold and brand-accented, with at least 4.5:1 contrast against every bubble background in both themes.
- **FR-007**: The "mentions me" pill MUST meet the same contrast bar for its own text.
- **FR-008**: Notification bodies (in-app and system) MUST show mention display names, leaving unresolvable handles untouched.
- **FR-009**: Text that resolves to nobody MUST remain plain text.

### Key Entities *(include if feature involves data)*

- **Handle**: the directory username, unchanged. This spec only fixes what counts as one when reading text.
- **Contact.name**: already the locally-renamed name; reused as the mention's display name. No schema change.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A mention of a dotted handle registers as a mention (A/B: 1-of-2 before, 2-of-2 after).
- **SC-002**: A rendered mention shows the display name, with a local rename winning, and no raw handle remains on screen.
- **SC-003**: Tapping a mention opens that contact.
- **SC-004**: Mention contrast is at least 4.5:1 on all four bubble backgrounds, and for the pill's text.
- **SC-005**: Notification bodies show mention names.
- **SC-006**: Email addresses and unmatched "@word" text are unaffected.

## Assumptions

- Resolving names per device is correct: a local rename is personal, so the sender and recipient may legitimately see different names for the same mention.
- A still-unresolvable handle is better left verbatim than guessed at.
- Matching the username charset exactly is safer than a looser pattern, which would start eating punctuation.

## Out of Scope

- Mentions in 1:1 chats (a deliberate spec 1020 decision).
- Rewriting the stored message body to contain names — the handle stays the durable reference so each device can resolve it independently.
- Restyling other accented inline text (links, phone/email entities), which share the brand colour and the same light-theme weakness.
- Mention autocomplete ranking or an @everyone redesign.
