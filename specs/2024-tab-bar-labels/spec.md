# Feature Specification: Tab Bar Labels Stay Visible After Switching Tabs

**Feature Branch**: `fix/2024-tab-bar-labels`

**Created**: 2026-07-10

**Status**: in-progress
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped. -->

**Input**: User report: "when opened on desktop as installed chrome app, on
first run the name of the main view tabs are shown, but when I click one then
the name goes away and if I click on another one that name also goes away and
it is true from all of them!" Reproduced and root-caused with the drive
harness before this spec was written.

## Why (the bug)

On first load the bottom tab bar shows all five names — Calls, Chats, Wall,
Contacts, Settings. Switching tabs makes names vanish one by one: every tab
switch destroys the label of the tab being activated AND the tab being left,
so after visiting all tabs only bare icons remain, plus stray visual
artifacts near the bar. It happens on every platform; the reporter noticed it
in the installed desktop Chrome PWA. Reproduced in plain desktop Chromium
(`drive/scenarios/tab-labels-vanish.mjs`, before/after screenshots captured).

Root cause, proven with DOM dumps: the tab page binds a dynamic Vue class to
each tab-button web component to drive the circular active-icon highlight
(introduced 2026-06-28, PR #552). The tab button manages its **own** classes
on that same element (`md`, `tab-has-label`, `tab-has-icon`,
`tab-layout-icon-top`, `hydrated`, …). When the bound class value changes —
exactly the two buttons involved in each switch — Vue rewrites the element's
entire class list to only what the template declares, erasing every
component-managed class, and the component never restores them (its renderer
believes they are still present). Without its layout classes the component's
internal styling stops sizing the label, which collapses from 12px to 0px
height (still technically "visible", just zero-tall). The measured wipe:
`class="md tab-has-label tab-has-icon tab-layout-icon-top … hydrated"` →
`class="tab-on tab-selected"` (or `class=""` on the tab being left).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Tab names never disappear (Priority: P1)

A user opens Ring (any platform, notably the installed desktop app) and
switches between the main tabs freely. Every tab keeps its name below its
icon at all times; the active tab shows the same circular brand-tint
highlight and filled icon it does today. No amount of tab switching degrades
the bar.

**Why this priority**: This is the reported bug. Missing labels make the app
look broken and hurt navigation for anyone who doesn't know the icons.

**Independent Test**: A browser-driven regression test clicks through every
tab (twice around) and asserts each tab button still renders its label text
with a non-zero height. Must FAIL against the current code (red-first,
constitution III for the hotfix band) and pass with the fix.

**Acceptance Scenarios**:

1. **Given** a fresh load on the Chats tab, **When** the user clicks Calls,
   **Then** all five tab names remain visible, and the highlight moves from
   Chats to Calls.
2. **Given** the user has visited every tab in sequence, **When** they look
   at the tab bar, **Then** all five names are still visible at their normal
   size, with no leftover visual artifacts.
3. **Given** any theme (light/dark) and either component display mode,
   **When** tabs are switched repeatedly, **Then** labels and highlight
   render identically to the design intent throughout.

---

### User Story 2 - Selection is truthful to assistive tech (Priority: P3)

A screen-reader user focuses the tab bar on a fresh load. The currently
active tab reports itself as selected immediately — not only after the first
manual tab switch.

**Why this priority**: Correctness for assistive tech, discovered during
diagnosis: the framework machinery overwrites the app's selection state at
load, so every tab reads "not selected" until the first click. Small, real,
and adjacent — but it must not risk the P1 fix, so it is investigated during
planning and implemented only if a mechanism exists that cannot reintroduce
the class-erasure bug; otherwise documented and deferred.

**Independent Test**: On a fresh load, the active tab button exposes a
truthful selected state (and the others expose not-selected) before any user
interaction; the state follows subsequent tab switches.

**Acceptance Scenarios**:

1. **Given** a fresh load on the Chats tab, **When** selection state is
   inspected before any click, **Then** Chats reports selected and the other
   four report not selected — OR the spec's deferral note documents why this
   remains unfixed.

> **Deferral note (FR-004, resolved during planning)**: deferred. The UI
> framework's tab-bar wrapper imperatively resets the bar's selection to
> empty on mount and on every route change, because its active-tab matching
> is link-based and this app's tab buttons deliberately carry no links (the
> flat-history navigation model). Every candidate fix either re-enables the
> framework's own tab routing alongside the app's (regression risk this spec
> excludes) or races a second framework writer with no ordering guarantee.
> Full evidence and the rejected mechanisms: research.md D2. Consequence
> (pre-existing, unchanged): assistive tech reads no tab as selected between
> load and the first tab switch. A future spec may revisit by adopting
> link-based tabs wholesale.

---

### Edge Cases

- **Rapid tab switching**: hammering different tabs quickly must never leave
  a label collapsed or a highlight on the wrong tab once navigation settles.
- **Badges**: unread badges on tab buttons keep rendering correctly alongside
  the label and highlight (they are siblings on the same buttons).
- **Re-tapping the active tab**: remains a no-op (no navigation, no visual
  change), as today.
- **Known issue, explicitly out of scope**: every tab tap logs
  `[ion-tabs] - Tab with id: "undefined" does not exist` to the console —
  pre-existing (predates PR #552), cosmetic, caused by the UI framework's
  built-in tab-click routing running alongside the app's own tab switching.
  Touching the navigation path risks regressing the deliberately tuned
  flat-history tab transitions, so it is recorded here and not fixed.
- **Logout/login transition**: the tab bar unmounts and remounts around auth
  changes; a remount must restore a fully intact bar (fresh components with
  fresh labels).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every main tab MUST show its name below its icon at all times
  while the tab bar is visible, regardless of how many tab switches have
  occurred, in both light and dark themes and in both component display
  modes. *(Theme/mode verification is by mechanism-independence plus
  Chromium coverage — the recorded waiver in Assumptions; the fix carries no
  theme- or mode-conditional behavior.)*
- **FR-002**: The active tab MUST show the existing design's highlight —
  circular brand-tint behind a filled icon, smooth fade, no icon shift — on
  exactly one tab (the active one); inactive tabs show outline icons with no
  tint.
- **FR-003**: The mechanism driving the active-tab visual MUST NOT be a
  dynamic class binding on the tab-button web components (or any other
  mechanism that can erase component-managed classes). Property and
  attribute bindings that never touch the element's class list are the
  permitted alternatives.
- **FR-004**: Selection state exposed to assistive technology SHOULD be
  truthful from first load (User Story 2). If no mechanism exists that is
  safe with the current framework wrapper, the deferral MUST be documented
  in this spec with the reason, and the current behavior noted as a known
  limitation.
- **FR-005**: Tab navigation semantics MUST be unchanged: switches replace
  history (no back-stack pileup), transitions stay instant, re-tapping the
  active tab is a no-op.
- **FR-006**: A browser-driven end-to-end regression test MUST exist that
  clicks through all tabs and asserts every tab label is rendered with
  non-zero height; it MUST be demonstrated failing before the fix (red) and
  passing after (green).
- **FR-007**: The console-noise wart (`[ion-tabs] … "undefined"`) is OUT of
  scope; this spec records it as a known issue (Edge Cases) so it is not
  re-diagnosed from scratch next time.

### Key Entities

- **Tab bar**: the five main-view tab buttons (Calls, Chats, Wall, Contacts,
  Settings), each an icon + name + optional unread badge, with a single
  active-tab highlight.
- **Active-tab marker**: the app-owned signal saying which tab is active
  (derived from the current route), rendered as the highlight; its DOM
  representation must be class-clobber-safe (FR-003).

## Zero-Knowledge Impact

None. This is a purely visual, on-device UI fix: nothing crosses the wire,
no data is stored, read, or transmitted, and the server is untouched.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The e2e regression (FR-006) fails on the pre-fix code and
  passes on the fixed code; it keeps passing in CI.
- **SC-002**: The interactive reproduction (`drive/scenarios/
  tab-labels-vanish.mjs`) shows all five labels at full height after a
  complete walk of all tabs — with screenshots demonstrating before/after
  parity of the highlight design.
- **SC-003**: `npm run build` (typecheck + build), the full unit suite, and
  the e2e suite pass.
- **SC-004**: User Story 2 either verifies (truthful selection at load) or
  carries a documented deferral in this spec.

## Assumptions

- The visual design of the highlight (PR #552's circular tint + filled icon)
  is correct as shipped; this fix restores its implementation safety without
  changing its look.
- The reproduction and regression assertions run under desktop Chromium
  (the project's e2e browser); the fix mechanism is platform-independent, so
  Chromium coverage plus the mode-agnostic mechanism is accepted as covering
  iOS/Android rendering.
- The pre-existing console error (Edge Cases) has no user-visible effect
  beyond console noise.
