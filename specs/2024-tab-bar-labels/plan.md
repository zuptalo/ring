# Implementation Plan: Tab Bar Labels Stay Visible After Switching Tabs

**Branch**: `fix/2024-tab-bar-labels` | **Date**: 2026-07-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/2024-tab-bar-labels/spec.md`

## Summary

Vue's class patching rewrites a custom element's whole `className`, so the
dynamic `:class="{ 'tab-on': … }"` binding on each `ion-tab-button`
(PR #552's circular highlight) erases the Stencil-managed host classes
(`md`, `tab-has-label`, `tab-has-icon`, `tab-layout-icon-top`, `hydrated`)
whenever the binding's value changes — the two buttons involved in every tab
switch — and Ionic never restores them, collapsing the slotted label to 0px.
Fix: replace the class binding with a `data-on` **attribute** binding (Vue
patches `data-*` via `setAttribute`/`removeAttribute`, never touching
`className`) and key the scoped CSS off `ion-tab-button[data-on]`. Red-first
e2e regression clicks through all tabs asserting label heights. US2 (truthful
`aria-selected` at load) is investigated and **deferred with documentation**
(research D2): the @ionic/vue wrapper imperatively resets the bar's
`selectedTab` to `""` on mount and every history change, so any value we set
races a second framework writer unless we adopt `href`-based tab routing —
which would run the wrapper's navigation alongside `switchTab` and risk the
deliberately tuned flat-history transitions (out of scope per FR-005/FR-007).

## Technical Context

**Language/Version**: TypeScript 5.x, Vue 3 `<script setup>` + Ionic 8.8.8
(`@ionic/vue` wrappers over Stencil web components)

**Primary Dependencies**: none new; touches one component
(`src/views/TabsPage.vue`, template + scoped CSS only)

**Storage**: none

**Testing**: new Playwright e2e spec (`e2e/tab-labels.spec.ts`, red-first);
interactive verification via `drive/scenarios/tab-labels-vanish.mjs`
(already written during diagnosis); `npm run build` typecheck

**Target Platform**: the PWA everywhere (desktop Chromium PWA where reported;
mechanism is mode- and platform-independent)

**Project Type**: web client; server untouched

**Performance Goals**: n/a (attribute toggle replaces class toggle)

**Constraints**: no dynamic class bindings on Ionic custom elements (FR-003);
visual parity with the shipped highlight design; tab navigation semantics
unchanged (FR-005)

**Scale/Scope**: 2 files of product surface: `src/views/TabsPage.vue`,
`e2e/tab-labels.spec.ts` (new); plus the tracked drive scenario

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Zero-Knowledge Boundary** — PASS (nothing crosses the wire; spec's
  Zero-Knowledge Impact: none). `/speckit-checklist` is optional for this
  spec (no Principle I/IV surface) and is skipped; the spec-quality
  checklist (`checklists/requirements.md`) passed.
- **II. Spec-Driven Development** — PASS: spec 2024 (hotfix band), pipeline
  specify → clarify (no critical ambiguities) → plan (this) → tasks →
  analyze → taskstoissues → implement.
- **III. Test-Driven Development** — PASS: `2001+` fix ⇒ the regression test
  comes first and this bug IS e2e-drivable (unlike the SW push work): a new
  Playwright spec clicks all tabs and asserts every tab-bar label has
  non-zero rendered height; it must be observed FAILING against current code
  before the class → attribute fix lands. No unit-test surface exists (the
  defect is a framework-interaction behavior of a Vue template; there is no
  pure function to extract), so e2e is the required coverage — which also
  satisfies the "changed user-facing behavior MUST add or extend an e2e
  spec" clause directly.
- **IV. Crypto Discipline** — PASS (untouched).
- **V. Offline-First Data Integrity** — PASS (no data).
- **VI. Stateless Server** — PASS (untouched).
- **VII. Quality Gates** — PASS: build + unit + e2e; user-facing `fix`
  commit subject in release-note voice.
- **VIII. Traceable Delivery** — PASS: taskstoissues; PR lists `Closes #N`.
- **IX. Privacy** — PASS (no data collection).
- **X/XI. A11y & Ionic-First** — PASS with one documented deferral: the fix
  keeps stock Ionic components and existing theme tokens (the CSS moves from
  a class selector to an attribute selector, values unchanged). The
  `aria-selected`-at-load gap (US2) is deferred with rationale (research D2);
  it is a pre-existing limitation, not a regression introduced here.

No violations → Complexity Tracking stays empty.

## Project Structure

### Documentation (this feature)

```text
specs/2024-tab-bar-labels/
├── spec.md              # (done; gains the US2 deferral note in Phase 1)
├── plan.md              # This file
├── research.md          # Phase 0: mechanism + alternatives + US2 verdict
├── data-model.md        # Phase 1: no persistent data; the one UI state
├── quickstart.md        # Phase 1: red/green + drive verification recipe
├── contracts/
│   └── tab-bar.md       # Phase 1: observable tab-bar behavior contract
├── checklists/
│   └── requirements.md  # Spec quality checklist (done)
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
src/views/TabsPage.vue           # :class="{tab-on}" → :data-on attribute;
                                 # scoped CSS .tab-on → [data-on]; comment
                                 # block documenting WHY (clobber mechanism,
                                 # US2 deferral, known console-noise wart)
e2e/tab-labels.spec.ts           # NEW red-first regression (FR-006)
drive/scenarios/tab-labels-vanish.mjs  # diagnosis repro — currently
                                       # untracked; ADDED to git in T006
drive/scenarios/tab-props-probe.mjs    # one-off diagnosis probe — DELETED
```

**Structure Decision**: single-component client fix. The active-tab marker
stays derived from the route in `TabsPage.vue` (unchanged computed); only its
DOM projection changes from a class to a `data-on` attribute. No composable,
no new component, no theme-token changes (Principle XI).

## Design (what changes, precisely)

1. **Template** (`TabsPage.vue`): on each of the five `ion-tab-button`s,
   replace `:class="{ 'tab-on': activeTab === 'x' }"` with
   `:data-on="activeTab === 'x' || undefined"` — `undefined` removes the
   attribute entirely, so the CSS selector is a clean presence test. The
   existing `:selected`, `:icon`, `@click`, `tab` bindings stay exactly as
   they are (property/listener bindings never touch `className`).
2. **Scoped CSS**: `ion-tab-button.tab-on ion-icon` →
   `ion-tab-button[data-on] ion-icon`; everything else (sizes, tint,
   transition) byte-identical.
3. **Why-comment** in the template/CSS explaining the FR-003 rule (Vue class
   patching clobbers Stencil-managed host classes; attribute bindings are
   the safe channel), the US2 deferral pointer, and the known
   `[ion-tabs] "undefined"` console wart (FR-007) so neither is
   re-investigated from scratch.
4. **e2e regression** (`e2e/tab-labels.spec.ts`): register an account, walk
   Calls → Wall → Contacts → Settings → Chats (twice around per US1), after
   each click assert all five tab buttons contain their label text with a
   rendered height > 0, and assert exactly one button carries the active
   marker. Observed RED before steps 1-2 land, GREEN after.
5. **Spec deferral note** (FR-004/SC-004): one paragraph added to spec.md
   recording the US2 verdict with the wrapper-source evidence (research D2).
