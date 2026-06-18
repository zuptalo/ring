# Implementation Plan: Hovering "Scroll to Latest" Button in Chat

**Branch**: `feat/1012-scroll-to-bottom-button` | **Date**: 2026-06-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/1012-scroll-to-bottom-button/spec.md`

## Summary

Add a small floating "scroll to latest" control to the chat view. It is hidden while the
view rests at/near the newest message and **fades in** once the user scrolls up; tapping it
goes to the **first unread** message (the earliest incoming message received since the user
left the bottom) when there is unread, otherwise to the **newest** message — fading out as the
bottom is reached (WhatsApp/Telegram pattern). A **count badge** of unread (incoming-only)
messages shows on the control while scrolled up.

This adds **no new scroll mechanics**. It surfaces state the chat view already maintains from
spec 1011 — the pinned/near-bottom flag (`stickBottom`/`nearBottom`), the smooth jump-to-newest
(`scrollToNewest`), and the seek-and-center (`scrollToMessage`, which loads a target that's been
trimmed out of the window) — and reuses the existing `messages` change bus to track the unread
boundary. **Client-only.** No server, wire, stored-ciphertext, or DB-schema change.

## Technical Context

**Language/Version**: TypeScript (Vue 3 `<script setup>` + Ionic 8, Vite) — client only.

**Primary Dependencies**: No new runtime dependency. Reuses Ionic's `ion-fab`/`ion-fab-button`
(+ `ion-icon`, `ion-badge`), the `ion-content` scroll element, the existing chat scroll state
(`stickBottom`/`nearBottom`/`onContentScroll`/`scrollToNewest`/`scrollToMessage`), `useChatHistory`,
and the `idb` change bus. Theme tokens for styling.

**Storage**: None. The unread boundary/count/visibility are **transient view-local state** for
the session — no IndexedDB, no `DB_VERSION` change, nothing persisted or synced.

**Testing**: `vitest` for the pure helpers (unread count + first-unread from a message list and
a boundary; the show/hide threshold predicate); Playwright `e2e` for appear/hide/fade, tap →
first-unread vs newest, badge count + reset, and composer-clearance; the `drive/` harness
optionally for a visual pass.

**Target Platform**: Installable PWA + `ringd` single container (server unchanged).

**Project Type**: Web — Vue 3 PWA client; this feature is entirely client-side, one view.

**Performance Goals**: control appears/disappears within ≈200ms of crossing the threshold; no
added work on the scroll hot path beyond the existing `onContentScroll`; no extra layout/reflow.

**Constraints**: client-only (zero-knowledge untouched); reuse spec-1011 scroll primitives (no
new windowing/anchoring); stock Ionic + theme tokens (Principle XI); LTR/RTL + light/dark;
accessible labeled control; must never overlap the composer/input across keyboard + reply/edit
states.

**Scale/Scope**: one view (`ChatDetailPage.vue`) + a small pure helper module + e2e. 1:1 and
group chats behave identically.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Zero-Knowledge Boundary (NON-NEGOTIABLE) | ✅ PASS | Client-only, view-local UI state. Reads already-decrypted on-device messages to count/locate; nothing new crosses the wire or is stored. No new ZK surface → `/speckit-checklist` not required (unlike a crypto/relay spec). |
| II. Spec-Driven Development | ✅ PASS | specify → clarify → plan → … ; spec id 1012 (ad-hoc band). |
| III. Test-Driven Development | ✅ PASS | tasks.md will order failing tests first: vitest pure helpers (unread count/first-id, threshold predicate) + e2e (appear/hide/fade, tap target, badge) before implementation. |
| IV. Crypto Discipline | ✅ PASS (untouched) | No crypto/messaging change. |
| V. Offline-First Data Integrity | ✅ PASS | No storage/schema change; state is ephemeral session view-state derived from existing on-device data. |
| VI. Stateless Server & Forward-Only Migrations | ✅ PASS | No server change; no migration. |
| VII. Quality Gates | ✅ PASS | `npm run build`, `go build/vet/test` (untouched, stays green), `vitest`, `npm run test:e2e` are the definition of done; new pure helper added to the `vitest.config.ts` gated-coverage floor. |
| VIII. Traceable, Auto-Closing Delivery | ✅ PASS | `/speckit-taskstoissues` → `Closes #N` on the PR. |
| IX. Privacy & Data Minimization | ✅ PASS | No new data; the unread boundary is ephemeral, never persisted/transmitted, and never modifies seen/receipt state. |
| X. Accessibility & Internationalization | ✅ PASS | Labeled control (accessible name incl. count), adequate touch target; trailing-side placement via logical properties (RTL); light/dark via tokens. |
| XI. Ionic-First UI | ✅ PASS | Built from `ion-fab-button` + `ion-icon` + `ion-badge` + theme tokens — no bespoke design system. `ion-fab` inside `ion-content` auto-anchors above the footer and tracks the keyboard, so no custom positioning. |

**Result**: No violations. Client-only UI enhancement; no Complexity Tracking entries required.

## Project Structure

### Documentation (this feature)

```text
specs/1012-scroll-to-bottom-button/
├── plan.md            # this file
├── spec.md            # /speckit-specify + /speckit-clarify
├── research.md        # Phase 0 (D1–D6)
├── data-model.md      # Phase 1 (transient view state + helper shapes)
├── quickstart.md      # Phase 1
├── contracts/
│   └── scroll-to-latest.md  # control behavior/invariants + pure-helper signatures
├── checklists/
│   └── requirements.md      # passing
└── tasks.md           # /speckit-tasks (later)
```

### Source Code (repository root)

Client-only edits, concentrated in one view + one small pure helper module + e2e.

```text
src/
├── views/detail/
│   └── ChatDetailPage.vue   # EDIT: floating control (ion-fab-button + badge); visibility from
│                            #       stickBottom/nearBottom + an appear threshold (hysteresis,
│                            #       CSS fade); track unread boundary/count off the change bus;
│                            #       tap → scrollToMessage(firstUnread) | scrollToNewest()
└── utils/
    └── chat-unread.ts       # NEW: pure helpers — unread count + first-unread id since a
                             #      boundary (incoming-only); show/hide threshold predicate

e2e/
└── scroll-to-latest.spec.ts # NEW: appear/hide/fade, tap → first-unread vs newest, badge count
                             #      + reset, composer-clearance (or extend an existing chat spec)

src/**/*.test.ts             # NEW: vitest for chat-unread helpers
```

**Structure Decision**: Reuse the existing client layout. The behavior is a thin layer on
`ChatDetailPage.vue` (which already owns the scroll state from spec 1011) plus a pure,
unit-tested helper for the unread/threshold math. No new subsystem, no component framework
change, no server. A dedicated presentational component is unnecessary — the control is a few
Ionic elements bound to view state — but the testable logic is extracted to `chat-unread.ts`.

## Complexity Tracking

No deviations. The one UI primitive choice (Ionic `ion-fab-button` vs a hand-rolled
absolutely-positioned button) resolves in favor of the Ionic primitive (Principle XI), which
also removes the need for manual keyboard/footer-height tracking — so there is nothing to
justify here.
