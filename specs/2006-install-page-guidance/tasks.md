# Tasks: Install-page guidance for a Play Protect "older Android" block

**Branch**: `fix/2006-install-page-guidance` | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

**Tests**: Copy-only change with no logic seam; the install gate isn't exercisable in the
unit/drive harness (bypassed there). Verified by `vue-tsc` + `vite build` and the conditional
render reasoning. (See plan.md Constitution Check — recorded TDD limitation.)

---

## Phase 1: Setup

- [X] T001 Confirm baseline gates: `npm run build` (vue-tsc + vite) green before the change.

## Phase 2: Implementation

- [X] T002 [US1] In `src/components/InstallGuard.vue`, add a muted help note rendered when `platform === 'android' && !installUnavailable`, near the "How to install" list / "Already added it?" note. Copy: name the Play Protect "unsafe / built for an older version of Android" symptom, state it's a Chrome/Play-Protect quirk with installed web apps (not a Ring problem), and give the remedy — update Chrome + Google Play services and retry, or "More details → Install anyway." (FR-001, FR-002, FR-004)
- [X] T003 [US1] Add a `.install-help` muted style (neutral background + `ion-color-medium` text), distinct from the warning-styled `.cant-install`. (FR-003)

## Phase 3: Verify

- [X] T004 Confirm the note's render condition excludes iOS, desktop, and the Android WebView-unavailable state (no duplication of the WebView callout); confirm no manifest/build/WebAPK change in the diff. (SC-002, SC-003, FR-005)
- [X] T005 Run `npm run build` (vue-tsc + vite) — green; set spec `**Status**` appropriately and run `make roadmap`.

---

## Dependencies
- T002 → T003 (markup then style). T004/T005 after.

## MVP
T002 + T003 — the note itself.
