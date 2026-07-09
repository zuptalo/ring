# Implementation Plan: Push Wakes Always End Visibly Where Silence Is Unsafe

**Branch**: `fix/2023-push-wakes-always` | **Date**: 2026-07-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/2023-push-wakes-always/spec.md`

## Summary

Apple's push daemon counts every service-worker push wake that ends without a
`showNotification` call as a silent push — cumulatively, three strikes for the
life of the subscription, no reset, no "user is looking at the app" exemption
(all verified in WebKit source). Ring's SW still has two *licensed* silent
endings (the spec-1034 visible-client skip and the page-claim handshake,
including one claim arm that renders nothing at all) plus three latent
error-path silences. The fix: a pure, user-agent-keyed **platform gate** —
silence may only ever be licensed on Chromium-engine browsers (whose push
service documents the focused-page exemption); on WebKit/Firefox/unknown
engines every wake ends with a show call, at worst the existing content-free
quiet note. The page-claim handshake keeps its dedupe role, but on
silence-unsafe platforms the SW follows the ack with the quiet note. Error
paths are hardened so a failed show can never be recorded as a successful one.
Client-only change; no wire, storage, or page-protocol changes.

## Technical Context

**Language/Version**: TypeScript 5.x (ES modules), Vue 3 PWA; custom service
worker built by vite-plugin-pwa `injectManifest` (`src/sw.ts`)

**Primary Dependencies**: none new. Touches `src/sw.ts` (wiring) and
`src/services/sw-inbox.ts` (pure halves); libsodium/workbox untouched

**Storage**: none. No IndexedDB schema change, no `DB_VERSION` bump

**Testing**: vitest for the pure decisions (`src/services/sw-quiet.test.ts`);
`npm run build` (vue-tsc) as the typecheck gate; wake-path inventory documented
in the PR per SC-001; real-device validation recipe in quickstart.md

**Target Platform**: service-worker context across WebKit (iOS 16.4+ PWA,
macOS Safari), Chromium (desktop incl. macOS, Android), Firefox; the gate must
be correct from `navigator.userAgent` alone inside the SW

**Project Type**: web (PWA client); server untouched

**Performance Goals**: negligible — one regex classification per push wake

**Constraints**: SW context (no DOM, no `document`); notification content must
stay exactly as content-free as the push tickle (zero-knowledge class);
page↔SW message protocol must not change (no new message types)

**Scale/Scope**: ~6 files: `src/services/sw-inbox.ts`,
`src/services/sw-quiet.test.ts`, `src/sw.ts`, amendment pointers in
`specs/1034-every-push-wake/spec.md` and
`specs/1027-harden-hidden-chats/spec.md` (FR-012), plus the SC-001 inventory
artifact `specs/2023-push-wakes-always/inventory.md`

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Zero-Knowledge Boundary** — PASS. Nothing new crosses the wire; the
  server is untouched. The quiet note's content is unchanged and carries no
  sender/chat/content. The hidden-chat trade on Apple discloses only the
  generic "New message" any message produces (spec's Zero-Knowledge Impact
  section covers this). Because the change touches Principle-I-adjacent
  surface (notification behavior around hidden chats), `/speckit-checklist`
  is REQUIRED and will run after `/speckit-tasks`.
- **II. Spec-Driven Development** — PASS. Spec 2023 (hotfix band), pipeline
  specify → clarify → plan (this) → tasks → checklist → analyze →
  taskstoissues → implement.
- **III. Test-Driven Development** — PASS with explicit ordering: this is a
  `2001+` fix, so tasks.md MUST begin with failing regression tests that
  reproduce the bug class in the pure halves — BOTH bug classes: (a) the
  licensed-silence class (platform gate absent → silence licensed on a WebKit
  UA with a focused+visible client), and (b) the error-path class via two new
  pure injectable helpers in `sw-inbox.ts` (`stampedShow`: a show is recorded
  only on fulfillment; `countAccepted`: a batch's outcome is its accepted
  count) so a rejecting show can be simulated under vitest. The remaining
  wiring in `sw.ts` is not directly unit-testable (workbox imports, SW
  globals) — the established pattern (specs 1034/2016/2017/2020) is
  pure-decision tests plus a reviewed wake-path inventory; this plan keeps
  that pattern and the inventory is SC-001. **e2e clause deviation
  (documented)**: no NEW e2e spec is added or extended because the Playwright
  harness cannot deliver Web Push events to the service worker (no push
  service in the loop); behavioral coverage is the pure-decision unit suite,
  the SC-001 inventory, SC-004's real-device validation, and the existing
  notification e2e suites staying green in the gates task — the same
  documented pattern as the predecessor SW hotfixes (1034/2016/2017/2020).
- **IV. Crypto Discipline** — PASS (not touched).
- **V. Offline-First Data Integrity** — PASS (no idb change).
- **VI. Stateless Server & Forward-Only Migrations** — PASS (no server change).
- **VII. Quality Gates** — PASS. `npm run build` + full vitest suite are the
  gates; e2e notification suites must stay green. Commit subject will be
  plain-language release-note copy (this is a user-facing `fix`).
- **VIII. Traceable Delivery** — PASS. `taskstoissues` will open issues; the
  PR lists `Closes #N`.
- **IX–XI** — PASS (no new data collection; no UI change).

No violations → Complexity Tracking stays empty.

## Project Structure

### Documentation (this feature)

```text
specs/2023-push-wakes-always/
├── spec.md              # Feature specification (done)
├── plan.md              # This file
├── research.md          # Phase 0: decisions + rejected alternatives
├── data-model.md        # Phase 1: pure-decision shapes (no persistent data)
├── quickstart.md        # Phase 1: verification recipe (unit + device)
├── contracts/
│   └── wake-outcomes.md # Phase 1: per-kind × per-platform terminal-outcome table
├── checklists/
│   └── requirements.md  # Spec quality checklist (done)
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
src/
├── sw.ts                          # wiring: quiet-note split, post-claim show,
│                                  # stamp-on-fulfillment, show counts, comments
└── services/
    ├── sw-inbox.ts                # pure halves: platform gate, silence license,
    │                              # predicate comment/style
    └── sw-quiet.test.ts           # regression tests FIRST, then new coverage

specs/1034-every-push-wake/spec.md       # amendment pointer (FR-008a)
specs/1027-harden-hidden-chats/spec.md   # amendment pointer at FR-012 (FR-008b)
```

**Structure Decision**: single-project client change following the existing
pure-core / thin-wiring split: every decision that can be a pure function
lives in `sw-inbox.ts` beside `anyClientVisible`/`quietNote` (unit-tested),
and `sw.ts` only wires them (covered by the reviewed inventory). No page-side
(`notify.ts`, `App.vue`) changes: the ack contract keeps meaning "the page
owns the *rich* alert", and the SW alone owns the webpushd contract.

## Design (what changes, precisely)

1. **Platform gate** (`sw-inbox.ts`, pure): `platformTrustsSilence(ua)` —
   true only for confident Chromium-engine UAs (`Chrome/`, `Chromium/`,
   `HeadlessChrome/`, or `Edg/` token) that are NOT iOS skins
   (`CriOS|EdgiOS|FxiOS|iPhone|iPad|iPod`). Safari (any OS), Firefox, and
   unknowns → false. iPadOS "desktop mode" masquerades as macOS Safari →
   false, the safe direction.
2. **Silence license** (`sw-inbox.ts`, pure): `mayEndWakeSilently(ua,
   clients)` = `platformTrustsSilence(ua) && anyClientVisible(clients)`.
   `anyClientVisible` keeps the focused+visible predicate, gains its
   why-comment back (both halves: frozen-snapshot distrust AND Chromium's
   "open and focused" wording), switches to house-style `=== true`, and pins
   the missing test case.
3. **Quiet-note split** (`sw.ts`): extract `showQuietNote(kind)` (the bare
   show, no catch) from `showQuietUnlessVisible(kind)` (matchAll + license
   check + `showQuietNote`). The swallowing try/catch is removed so failures
   propagate to `guardedPush` (FR-005). Two carve-outs contain the failure
   locally per FR-005: the settle-window downgrade call site keeps its outer
   catch (a loud generic is already accepted and showing there), and the
   authoritative-drain call site keeps the drain's own catch (a failure there
   degrades to the preview flow, whose own quiet terminal propagates).
4. **Post-claim show** (`sw.ts` dispatch): after a successful page claim,
   `if (!platformTrustsSilence(ua)) await showQuietNote('msg')` — platform-
   gated only, NOT visibility-gated, so Chromium keeps today's fully-silent
   claim and WebKit always ends visibly (FR-003).
5. **Stamp on fulfillment** (`sw-inbox.ts` + `sw.ts`): a pure injectable
   helper `stampedShow(raw, stamp)` (unit-tested with resolving/rejecting
   fakes) wraps the platform show so `stamp` runs only on fulfillment and a
   rejection still surfaces to the caller; `sw.ts` uses it to record
   `lastNotificationAt` (FR-006).
6. **Show counts** (`sw-inbox.ts` + `sw.ts`): a pure helper
   `countAccepted(shows)` (unit-tested) runs show thunks, tolerates
   individual rejections, and returns the accepted count;
   `showNotes`/`showConnNotes` are rebuilt on it and return that count.
   Callers treat 0 as "not visibly ended" and fall through to their
   quiet/fallback terminal (FR-007). Ordering guard in the settle upgrade
   arm: the already-accepted generic is closed only AFTER the upgrade shows
   report accepted > 0 — never destroy the wake's accepted visible ending for
   a failed upgrade. The authoritative drain still acks its committed frames
   but ends the wake visibly when the count is 0.
7. **Docs**: update the stale spec-1034 comment block in `sw-inbox.ts` and
   the `showQuietUnlessVisible` docs in `sw.ts`; add the amendment pointer to
   spec 1034 (FR-008).
