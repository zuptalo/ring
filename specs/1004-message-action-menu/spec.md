# Feature Specification: Message Action Menu

**Feature Branch**: `feat/1004-message-action-menu`

**Created**: 2026-06-16

**Status**: in-progress
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "It's very hard to tap the border of a video/album/image to get the menu to show up — maybe make the lower bezel a bit thicker so it's easier. The emoji row above the popup menu should scroll horizontally and have a + at the end to choose another emoji (which then reorders by use/popularity and is shown more); it's now broken and doesn't slide properly, and when it did, it sometimes slid the other sections of the menu too — only the top emoji row should slide, everything else stays put, and the + must be fully visible and selectable. Regardless of how wide/narrow the message is, tapping it (or its borders, for images/videos) should open the menu fully visible and interactable, clearly showing which message it's for. Maybe slightly zoom the focused message (hover feel) and blur the others — thinking out loud, you judge if it's reasonable performance-wise. A single tap (not necessarily long-press) opens the menu — many users prefer that."

## Overview

The per-message action menu (the popup with a quick-reaction emoji row on top and
actions below) is hard to invoke and partly broken. On media bubbles (image,
video, album) the tappable area is finicky — it's hard to hit to open the menu.
The emoji reaction row doesn't scroll horizontally as intended, has no working
"+" to pick a custom emoji, and when it did move it dragged the rest of the menu
with it. The menu can also open in awkward positions on very wide/narrow messages.

This feature makes the menu reliably **single-tap** to open from anywhere on a
message (including the full media bubble area), gives the reaction row a smooth
**horizontal scroll** with a fully-visible **"+" custom-emoji** affordance and
**usage-based reordering**, keeps every section **except** the reaction row
stationary, and positions the menu **fully visible and interactive** while clearly
indicating which message it belongs to.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Easy single-tap to open on any message, including media (Priority: P1)

A single tap anywhere on a message bubble — including the whole image/video/album
area — opens its action menu. No precise border-tapping or long-press required.

**Acceptance Scenarios**:

1. **Given** any message (text, image, video, album), **When** I single-tap it,
   **Then** its action menu opens.
2. **Given** a media bubble, **When** I tap anywhere within it (including near the
   edges), **Then** the menu opens (the hit target covers the bubble; the media's
   own primary action, e.g. open viewer, remains reachable per the chosen gesture
   split).

---

### User Story 2 - Reaction row scrolls horizontally with a working "+" (Priority: P1)

The emoji reaction row at the top of the menu scrolls horizontally and ends with a
"+" to choose a custom emoji; the "+" is always fully visible and tappable.

**Acceptance Scenarios**:

1. **Given** the menu is open, **When** I swipe the emoji row left/right, **Then**
   only the emoji row scrolls; all other menu sections stay stationary.
2. **Given** the emoji row, **When** it renders, **Then** the trailing "+" is fully
   visible and selectable regardless of message width.
3. **Given** I tap "+", **When** the emoji picker opens and I choose an emoji,
   **Then** it is applied as a reaction.

---

### User Story 3 - Reaction row reorders by usage/popularity (Priority: P2)

Emojis I use more often surface earlier in the reaction row over time.

**Acceptance Scenarios**:

1. **Given** I have reacted with some emojis more than others, **When** the reaction
   row renders, **Then** more-used emojis appear earlier (after any always-pinned
   defaults), within a stable, sensible scheme.

---

### User Story 4 - Menu opens fully visible and clearly attached to its message (Priority: P1)

However wide or narrow the message, the menu opens fully on-screen and interactive,
and it's visually clear which message it's acting on.

**Acceptance Scenarios**:

1. **Given** a message near the top/bottom/edge of the screen, **When** I open its
   menu, **Then** the whole menu (reaction row + actions) is within the viewport and
   interactive (no clipping, nothing off-screen).
2. **Given** the menu is open, **When** I look at the screen, **Then** it's clear
   which message it belongs to (the message is visually associated with the menu).

---

### Edge Cases

- Very wide media and very narrow text bubbles both yield a fully-visible menu.
- The emoji row never causes horizontal scrolling of the page or sibling sections.
- A message at the very top or bottom still gets a fully-visible menu (flip/anchor
  as needed).
- RTL layouts: the reaction row scrolls and the "+" sits correctly for RTL.
- The optional focus zoom/blur (US5) must not drop frames or it is omitted.

### Optional / judgment (US5 - Focus emphasis, Priority: P3)

Slightly emphasize the focused message (e.g. a subtle scale) and de-emphasize the
rest (dim/blur) to give a "hovering" feel — **only if** it's smooth on target
devices. This is explicitly optional: if it risks jank, omit it and keep a simple
clear association (the spec does not require the blur).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A single tap anywhere on a message bubble — including the full
  image/video/album area — MUST open that message's action menu.
- **FR-002**: The media bubble's tap target MUST be easy to hit (cover the bubble;
  thicken/extend the hit area as needed) so opening the menu doesn't require precise
  edge tapping.
- **FR-003**: The reaction (emoji) row MUST scroll horizontally independently; no
  other menu section may move when the row is scrolled.
- **FR-004**: The reaction row MUST end with a "+" custom-emoji affordance that is
  fully visible and selectable regardless of message/bubble width.
- **FR-005**: Choosing a custom emoji via "+" MUST apply it as a reaction.
- **FR-006**: The reaction row MUST order emojis by usage/popularity over time
  (after any fixed defaults), persisted on-device.
- **FR-007**: The menu MUST always open fully within the viewport and interactive,
  for any message width and screen position (anchor/flip as needed).
- **FR-008**: The open menu MUST make it visually clear which message it acts on.
- **FR-009**: The interaction MUST be reliable in RTL and LTR and across themes.
- **FR-010**: All UI MUST use stock Ionic components + existing theme tokens; build
  custom only where no Ionic primitive fits, composed from Ionic (Constitution XI).
- **FR-011 (optional)**: A focus emphasis (subtle zoom + dim/blur of others) MAY be
  added only if it stays smooth (no dropped frames) on target devices; otherwise it
  is omitted.

## Zero-Knowledge Impact *(mandatory)*

- Client-only UI/interaction change. No wire, server, or data-model change. Reaction
  emoji-usage ordering is stored on-device only (a local preference), never sent to
  the server; reactions themselves use the existing E2EE reaction path unchanged.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A single tap anywhere on text/image/video/album bubbles opens the menu
  (verified e2e for each kind).
- **SC-002**: Scrolling the reaction row moves only that row; other sections stay
  fixed; the trailing "+" is fully visible (verified visually + by assertion).
- **SC-003**: The "+" opens the emoji picker and the chosen emoji is applied.
- **SC-004**: The menu is fully within the viewport for messages at top/bottom/edge
  and for very wide/narrow bubbles.
- **SC-005**: More-used reaction emojis appear earlier over repeated use.

## Assumptions

- The current menu is a custom component (action sheet / popover-like) with a
  reaction row; the layout bug is the row and its siblings sharing a scroll/overflow
  context — the fix isolates the row's horizontal scroll. (Plan will confirm against
  the actual component, e.g. a reactions/menu component under `src/components/`.)
- "Single tap opens the menu" replaces/augments long-press as the primary gesture;
  the media bubble's existing "open viewer" action is reconciled with the tap-to-menu
  gesture in the plan (e.g. tap = menu, with viewer reachable from the menu or a
  distinct affordance) — to be settled in clarify/plan.
- Usage-ordering is a local, non-secret preference; a small persisted tally suffices.
- Focus zoom/blur is optional and dropped if it can't stay smooth.
