# Tasks: Tab Bar Labels Stay Visible After Switching Tabs

**Input**: Design documents from `/specs/2024-tab-bar-labels/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md,
contracts/tab-bar.md, quickstart.md

**Tests**: REQUIRED and red-first — this is a `2001+` hotfix; the regression
test is a new Playwright e2e spec (the defect is fully e2e-drivable; no unit
surface exists per plan Constitution Check III / research D3). It MUST be
observed failing before the fix lands.

**Organization**: US1 (labels never disappear) is the whole fix; US2
(truthful selection at load) was resolved to a documented deferral during
planning.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [X] T001 Mark spec 2024 `**Status**: in-progress` in
      specs/2024-tab-bar-labels/spec.md and run `make roadmap` (CI guard)

---

## Phase 2: Foundational

*(none — single-component fix on existing files)*

---

## Phase 3: User Story 1 — Tab names never disappear (P1) 🎯 MVP

**Goal**: Labels survive unlimited tab switching; the circular highlight
follows the active tab; contract rows 1–3 hold.

**Independent Test**: `npx playwright test e2e/tab-labels.spec.ts` — RED on
the un-fixed tree, GREEN after; drive scenario screenshots show all five
labels after a full tab walk.

- [X] T002 [US1] RED: create e2e/tab-labels.spec.ts following the existing
      e2e conventions (e2e/helpers.ts account setup): register one account,
      walk the five tabs twice around (Calls → Wall → Contacts → Settings →
      Chats, ×2) clicking the real ion-tab-button elements; after EACH click
      assert — in this order, so the red run demonstrably fails on the BUG,
      not on the not-yet-added mechanism — (a) all five tab buttons render
      their label text with bounding height > 0, then (b) exactly one button
      carries the `data-on` attribute matching the current route (contract
      rows 1–3); finish with a re-tap of the active tab asserting the URL is
      unchanged and labels intact (FR-005 / contract row 6). Run it and
      OBSERVE it fail on the collapsed-label assertion (a); record the red
      output for the PR description
- [X] T003 [US1] Fix src/views/TabsPage.vue: replace each
      `:class="{ 'tab-on': activeTab === '<tab>' }"` with
      `:data-on="activeTab === '<tab>' || undefined"` on all five
      ion-tab-buttons; change the scoped CSS selector
      `ion-tab-button.tab-on ion-icon` → `ion-tab-button[data-on] ion-icon`
      (declarations unchanged); update the selector's why-comment to state
      the FR-003 rule (Vue class patching rewrites className wholesale and
      erases Stencil-managed host classes — attribute bindings are the safe
      channel; cite spec 2024), fold in the US2 deferral pointer
      (research.md D2) where the old comment discussed `.tab-selected`
      unreliability, and note the known `[ion-tabs] "undefined"` console
      wart (FR-007) at the switchTab comment; ALSO correct the tab-bar
      template comment (~lines 9-12) claiming the `:selected` binding makes
      "the active tab still report correctly for assistive tech" — research
      D2 disproved that at load; reword to best-effort-after-first-switch
      with a pointer to the spec 2024 US2 deferral
- [X] T004 [US1] GREEN + visual parity: extend the `dump()` in
      drive/scenarios/tab-labels-vanish.mjs with
      `dataOn: b.hasAttribute('data-on')` so the stdout check in
      quickstart.md is observable; `npx playwright test
      e2e/tab-labels.spec.ts` passes; run
      `node drive/scenarios/tab-labels-vanish.mjs` against the dev stack and
      verify per quickstart.md — every screenshot shows five full-size
      labels, the highlight matches the pre-fix design on the initial shot,
      DOM dumps show Ionic classes intact after every click and `data-on` on
      exactly the active tab (SC-002)

**Checkpoint**: the reported bug is fixed and pinned by CI.

---

## Phase 4: User Story 2 — Selection truthful to assistive tech (P3)

**Goal**: Dispositioned per FR-004: deferred with documentation (no safe
mechanism exists; see research.md D2 and the spec's deferral note).

- [X] T005 [US2] Confirm the deferral documentation is complete and
      cross-linked: spec.md deferral note under US2 ↔ research.md D2 ↔ the
      TabsPage.vue comment from T003; no code change (FR-004, SC-004)

---

## Phase 5: Polish & Gates

- [X] T006 [P] Track the repro scenario and drop the one-off probe: both
      files are currently UNTRACKED — `git add
      drive/scenarios/tab-labels-vanish.mjs` (the interactive
      repro/verification per SC-002; drive/ scenarios are tracked by
      convention) and delete drive/scenarios/tab-props-probe.mjs
- [X] T007 Run the full gates: `npm run build` (vue-tsc + vite) and
      `npx vitest run` (full unit suite, must be untouched-green), plus the
      new e2e spec (SC-003; the full e2e suite runs in CI)

## Dependencies

- T001 → everything (roadmap guard)
- T002 (RED) → T003 (fix) → T004 (GREEN) — strict order, red observed first
- T005 after T003 (the comment it cross-checks lands there)
- T006 [P] anytime; T007 last

## Issue Mapping

T001 #923 · T002 #924 · T003 #925 · T004 #926 · T005 #927 · T006 #928 ·
T007 #929 — the feature → `develop` PR must list `Closes #N` for each
(constitution VIII).

## Implementation Strategy

US1 is the MVP and the entire code change (one template/CSS edit + one e2e
spec). US2 is a documentation-only disposition. Single PR;
red test → fix → green as ordered commits or one commit with the red run
recorded in the PR description.
