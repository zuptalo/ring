# Implementation Plan: Unify in-app notifications/toasts + user-friendly "What's new"

**Branch**: `fix/2004-unify-app-notifications` | **Date**: 2026-06-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/2004-unify-app-notifications/spec.md`

## Summary

Render the app-update prompt through the existing shared in-app notification overlay
(`NotificationBanners.vue` + `notify.ts`) as a new persistent **"action"** card instead of
an Ionic toast — fixing the iOS top-pinned/sharp-corner breakage and unifying all
notification-class surfaces in one component. Add a shared `appToast()` helper for the ~two
dozen functional/error toasts (one place for position/rounding/duration). Harden the
release-note `prettify` to strip internal references that carry extra detail, and amend the
constitution + CLAUDE.md so user-facing commit subjects read as plain release-note copy.

## Technical Context

**Language/Version**: TypeScript / Vue 3 + Ionic (client PWA only). No server change.

**Primary Dependencies**: existing Ionic `toastController`, the in-app banner overlay
(`src/services/notify.ts` + `src/components/NotificationBanners.vue`), `useAppUpdate.ts`,
`release-notes.ts`. No new dependencies.

**Storage**: none (no IndexedDB store, no migration).

**Testing**: `vitest` for the pure `prettify` change (failing-first); `vue-tsc` + `vite
build`; drive screenshots for the banner/toast rendering (not unit-testable in the harness).

**Target Platform**: installable PWA (bug reported on iOS; fix is cross-platform).

**Project Type**: client UI fix + governance docs.

**Constraints**: Ionic-First (Principle XI) — reuse stock Ionic components + the theme;
no zero-knowledge impact; forward-only (governance amendment bumps the constitution version).

**Scale/Scope**: ~6 client files changed + ~14 toast call-site migrations + 2 governance docs.

## Constitution Check

*GATE: re-checked after Phase 1 — passing.*

- **I. Zero-Knowledge Boundary** — PASS (N/A). Purely client-side rendering + phrasing +
  docs; no client/server contract, payload, or stored-data change. Spec's Zero-Knowledge
  Impact says none; the crypto/ZK **checklist is not required**.
- **II. Spec-Driven Development** — PASS. Full pipeline; branch/commits/PR trace to spec 2004.
- **III. Test-Driven Development** — PASS with a noted limit. The one unit-testable change
  (`prettify` ref-stripping) gets a FAILING test first. The banner/toast **rendering** isn't
  unit-testable in the harness (no DOM-screenshot in vitest); verified via drive screenshots
  — a justified, recorded deviation from "add an e2e spec." This is a bug fix (2001+); the
  regression test reproduces the jargon-leak defect.
- **IV. Crypto Discipline** — PASS (N/A). No crypto.
- **V. Offline-First** — PASS (N/A). No object-store change.
- **VI. Forward-Only Migrations** — PASS (N/A). No DB migration; the constitution amendment
  bumps its own version metadata.
- **VII. Quality Gates** — PASS. `vue-tsc` + `vite build` + `vitest`. (This spec also
  *amends* VII — see below.)
- **VIII. Traceable Delivery** — PASS. `taskstoissues` → `Closes #N`.
- **IX. Privacy & Data Minimization** — PASS (N/A).
- **X. Accessibility & i18n** — PASS. Banner action buttons use stock Ionic + existing
  theme; text stays bidi-safe.
- **XI. Ionic-First UI** — PASS. The action card reuses the existing banner overlay (stock
  Ionic `ion-button`s + theme tokens); the `appToast` helper wraps stock `ion-toast`.

**Amendment in scope:** this spec *changes* the governing docs (Principle VII +
CLAUDE.md) to require user-facing release-note phrasing, and bumps the constitution version
(1.1.0 → 1.2.0). That is an intentional governance change carried out as part of the fix.

**Gate result: PASS.**

## Design Overview

### 1. Update prompt → shared "action" banner (fixes the bug)
- `src/services/notify.ts`: add `'action'` to `IncomingKind`; extend `NotifyBanner` with
  `actions?: { text: string; role?: 'cancel'; handler: () => void }[]` and a persistent
  flag. Add `showActionBanner({ name, body, icon, actions })` using a fixed `url`
  (`'app-update'`) so dedup-by-url replaces on re-prompt; pin it (exempt from `MAX_BANNERS`)
  and skip the `BANNER_MS` auto-dismiss via the existing `pinnedUrls`/`holdBanner`
  machinery; add `dismissActionBanner(url)` for the action handlers.
- `src/components/NotificationBanners.vue`: when `kind === 'action'`, render the `actions`
  as a stock `ion-button` row under the body (no avatar quick-reply). Same card chrome →
  identical position/rounding to message/system cards.
- `src/composables/useAppUpdate.ts`: replace `toastController.create({cssClass:'app-update-toast', …})`
  with `showActionBanner({ name: 'Update available', body: label, icon: sparklesOutline,
  actions: [ {text:`What's new (N)`, handler: → presentWhatsNew}, {text:'Update', handler: →
  updateServiceWorker(true)}, {text:'Later', role:'cancel', handler: → dismiss} ] })`. Keep
  the `WhatsNewSheet` modal + the foreground re-prompt; the `prompting` guard still applies.
- `src/App.vue`: delete the `ion-toast.app-update-toast` CSS block (dead).

### 2. Shared `appToast()` for functional/error toasts
- `src/services/toast.ts` (new): `appToast({ message, duration?, color?, icon? })` → one
  `toastController.create({ position: 'top', cssClass: 'app-toast', duration: duration ??
  1800, color, icon, message }).present()`.
- `src/App.vue`: add `ion-toast.app-toast` style — rounded corners + below-header offset
  (consistent, tunable in one place).
- Migrate the ~24 functional/error `toastController.create` sites (e.g. `WallPage.vue`,
  `ChatDetailPage.vue`, `ContactsPage.vue`, `DirectoryPage.vue`, `ContactDetailPage.vue`,
  `AddByIdPage.vue`, `ContactQrPage.vue`, `ScanPage.vue`, `SelfTestPage.vue`,
  `ChatListItem.vue`, `useCall.ts`, `useConnect.ts`, `PostDetailPage.vue`, `NotificationBanners.vue`
  error path) to `appToast(...)`. Document exceptions left as-is: App.vue's sticky
  failed-sends toast (has its own buttons) and the now-banner update prompt.

### 3. User-friendly release notes + governance
- `src/services/release-notes.ts`: broaden `TRAILING_REF` from `\(spec\s*\d+\)` to also
  strip refs with trailing detail — `\((?:spec\s*\d+[^)]*|#\d+|gh-\d+)\)\s*$` — plus a
  trailing `\s*\(\+[^)]*\)\s*$` ("(+ flaky test, …)") note. Add `prettify` test cases.
- `.specify/memory/constitution.md`: extend Principle VII so user-facing commit types
  (feat/fix/perf/security) MUST have plain-language, benefit-focused, jargon-free,
  reference-free subjects (they become "What's new"). Bump `1.1.0 → 1.2.0` (Sync Impact
  header + footer).
- `CLAUDE.md`: under "Commit messages", add "Release-note subjects for end users" with a
  good/bad example.

## Project Structure
```text
specs/2004-unify-app-notifications/
├── plan.md  research.md  data-model.md  quickstart.md  contracts/  tasks.md
```
Source touched: `src/services/notify.ts`, `src/components/NotificationBanners.vue`,
`src/composables/useAppUpdate.ts`, `src/services/toast.ts` (new), `src/App.vue`,
`src/services/release-notes.ts` (+ test), ~14 toast call sites, `.specify/memory/constitution.md`, `CLAUDE.md`.

## Phasing
- **Phase 0 — research.md**: the few decisions (banner action-card vs new component; toast
  default duration; ref-stripping regex; constitution version bump). Done.
- **Phase 1 — data-model.md / contracts / quickstart**: no data model (state it); the
  in-app "contract" is the `showActionBanner`/`appToast` surface; quickstart = verification
  recipe. Done.
- **Phase 2 — tasks.md**: `/speckit-tasks` (TDD: prettify test first).

## Complexity Tracking
Only the noted TDD/e2e limitation (banner/toast rendering verified via drive screenshots,
not unit tests) — justified by the harness's lack of DOM-screenshot in vitest.
