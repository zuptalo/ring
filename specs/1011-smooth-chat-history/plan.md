# Implementation Plan: Smooth Chat-History Scroll-Up (verified by a multi-user end-to-end exercise)

**Branch**: `feat/1011-smooth-chat-history` | **Date**: 2026-06-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/1011-smooth-chat-history/spec.md`

## Summary

Make scrolling up through chat history smooth at any length (target ~5,000+ messages)
with bounded DOM and memory, while keeping the message under the user's view stationary
(≤2px) as older pages load. The approach (adversarially judged against `@tanstack/vue-virtual`
and CSS `content-visibility`) is to **extend the existing hand-rolled window** in
`ChatDetailPage.vue` into a true **bidirectional virtual window** (`{start,end}` slice
with eviction both directions + look-ahead prefetch), feed it from **bounded batch reads**
(`listMessagesOlder/Newer/countChatMessages`) via a new **`useChatHistory` composable**
that applies **incremental** updates (no full-array replace), and route every window
mutation through one **`withScrollAnchor`** helper (measured-rect anchor + the momentum/echo
guards `loadOlder` lacks today). Plus jump-to-older seek (US3) and group-row edge-correctness.
It's proven by a **multi-user end-to-end exercise** on the new `drive/` harness and e2e
assertions (anchor ≤2px, page-before-top, bounded row count on a 5,000-msg seeded chat),
with a fast `__ringTest.seedMessages` bulk-seed. Full rationale: [research.md](./research.md).

**Client-only.** No server, wire, stored-ciphertext, or DB-schema change.

## Technical Context

**Language/Version**: TypeScript (Vue 3 `<script setup>` + Ionic 8, Vite) client only.

**Primary Dependencies**: No new runtime dependency — hand-rolled windowing (Ionic 8 has
no variable-height virtual-scroll primitive; `ion-virtual-scroll` was removed). Reuses the
existing `ion-content` scroll element, `ion-infinite-scroll` (as a backstop), IndexedDB
wrapper + change bus, and the media LRU.

**Storage**: IndexedDB `messages` store via the existing `chatId` index. **No new index,
no `DB_VERSION` bump** (stays at 6) — bounded reads slice in memory (research D2). A
compound `[chatId,timestamp]` index is a documented, forward-only, out-of-scope future
step (Complexity Tracking).

**Testing**: `vitest` for pure helpers (window math, pagination/cursor math, anchor-delta
math, group-run/day across the window edge); Playwright `e2e` (extend
`e2e/chat-media-scroll.spec.ts`) for ≤2px anchor, page-before-top, bounded row/media count
on a 5,000-msg seeded chat, and no-yank; the `drive/` harness for the multi-user exercise
(5 users → connect → 1:1 + group → all message kinds → lengthy chat → scroll-up shots).

**Target Platform**: Installable PWA + `ringd` single container (server unchanged).

**Project Type**: Web — Vue 3 PWA client; this feature is entirely client-side.

**Performance Goals**: 60fps scroll; smooth scroll-up to ~5,000+ messages; rendered rows
bounded to a cap (~80-120 ≈ a few screens + buffer) regardless of scroll distance; ≤2px
anchor drift on prepend/eviction; next older page present before the top edge is reached.

**Constraints**: Client-only (zero-knowledge untouched); offline-first (reads only, no
data loss); stock Ionic + theme tokens; LTR/RTL + light/dark; modest batch/cap sizes for
sub-frame mounts; all existing chat behaviors preserved.

**Scale/Scope**: Chats up to 5,000+ messages; one primary view (`ChatDetailPage.vue`) +
a new composable + a few `queries.ts` reads + a dev testhook + the verification harness/e2e.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Zero-Knowledge Boundary (NON-NEGOTIABLE) | ✅ PASS | Client-only. Reads existing on-device plaintext for rendering only; nothing new crosses the wire or is stored. No `/speckit-checklist` required (applies to client↔server boundary changes). |
| II. Spec-Driven Development | ✅ PASS | specify → clarify → plan → … ; spec id 1011. |
| III. Test-Driven Development | ✅ PASS | tasks.md will order failing tests first: vitest pure helpers (window/pagination/anchor/group-edge) + e2e (anchor ≤2px, page-before-top, bounded count, no-yank, jump-to-older) before implementation. |
| IV. Crypto Discipline | ✅ PASS (untouched) | No crypto/messaging change; `messaging.ts` and the ratchet are not touched. |
| V. Offline-First Data Integrity | ✅ PASS | IndexedDB is read-only here; **no schema change, no `DB_VERSION` bump** (research D2). Bounded reads slice existing rows; no data dropped or migrated. |
| VI. Stateless Server & Forward-Only Migrations | ✅ PASS | No server change; **no migration** (the optional future compound index is documented as additive/forward-only and out of scope). |
| VII. Quality Gates | ✅ PASS | `npm run build`, `go build/vet/test` (unchanged, runs clean), `vitest`, `npm run test:e2e` are the definition of done. |
| VIII. Traceable, Auto-Closing Delivery | ✅ PASS | `/speckit-taskstoissues` → `Closes #N` on the PR. |
| IX. Privacy & Data Minimization | ✅ PASS | No new data; bounded reads/eviction reduce in-memory/DOM footprint. The `seedMessages` testhook is dev-only (stripped from prod, like the rest of `__ringTest`). |
| X. Accessibility & Internationalization | ✅ PASS | Natural top→bottom order preserved (no `column-reverse`); LTR/RTL + light/dark unaffected; virtualization keeps semantic order and existing labels. |
| XI. Ionic-First UI | ✅ PASS (custom justified) | Hand-rolled windowing because **no Ionic primitive fits** variable-height chat virtual scroll (`ion-virtual-scroll` removed in Ionic 7+). XI permits custom where no primitive fits. Still uses `ion-content`/`ion-infinite-scroll` + theme tokens; no bespoke design system. |

**Result**: No violations. `/speckit-checklist` not required (client-only). See Complexity
Tracking for the one justified custom choice + the deferred index.

## Project Structure

### Documentation (this feature)

```text
specs/1011-smooth-chat-history/
├── plan.md            # this file
├── spec.md            # /speckit-specify + /speckit-clarify
├── research.md        # Phase 0 (D1–D9 + recommendation/fallback/risks)
├── data-model.md      # Phase 1
├── quickstart.md      # Phase 1
├── contracts/
│   └── chat-history.md # bounded-read API + useChatHistory + seedMessages + scroll invariants
├── checklists/
│   └── requirements.md # passing
└── tasks.md           # /speckit-tasks (later)
```

### Source Code (repository root)

Client-only edits + one new composable + verification harness/tests; **no new object
store, no server change**.

```text
src/
├── views/detail/
│   └── ChatDetailPage.vue   # EDIT: {start,end} bidirectional window + eviction (replaces visible/slice(-visible));
│                            #       withScrollAnchor() (prepend+evict, momentum/echo guards); look-ahead sentinel;
│                            #       seekToMessage() for jump-to-older; group-run/day edge correctness; source window
│                            #       from useChatHistory instead of useLiveQuery(listMessages)
├── composables/
│   └── useChatHistory.ts    # NEW: bounded windowed history + incremental change-bus updates (append/patch/remove)
├── db/
│   └── queries.ts           # EDIT: listMessagesOlder / listMessagesNewer / countChatMessages (bounded batches);
│                            #       keep listMessages for search/other callers
├── services/
│   └── testhook.ts          # EDIT: __ringTest.seedMessages(chatId, n, opts) — bulkPut N rows (dev-only)
└── (utils for pure helpers: window math / anchor-delta math, unit-tested)

drive/
├── driver.mjs               # EDIT: add a bulk-seed convenience + scroll helpers if needed
└── scenarios/
    └── lengthy-chat-scroll.mjs  # NEW: 5-user exercise (connect → 1:1+group → all kinds → lengthy chat → scroll-up shots)

e2e/
└── chat-media-scroll.spec.ts    # EDIT/EXTEND: ≤2px anchor, page-before-top, bounded row/media count on a 5k seeded chat, no-yank, jump-to-older

src/**/*.test.ts                  # NEW: vitest for window/pagination/anchor/group-edge pure helpers
```

**Structure Decision**: Reuse the existing client layout. The change is concentrated in
`ChatDetailPage.vue` (the window + anchor + prefetch + seek) plus a new `useChatHistory`
composable and three bounded reads in `queries.ts`; verification reuses the `drive/`
harness + the existing e2e scroll spec. No new subsystem, no new object store, no server.

## Complexity Tracking

| Choice | Why needed | Simpler alternative rejected because |
|---|---|---|
| Hand-rolled bidirectional virtual window (vs an Ionic primitive or a library) | Ionic 8 has no variable-height virtual scroll; the ≤2px bar under async media decode/avatar/album reflow needs a measured-rect anchor, which `@tanstack/vue-virtual`'s index/estimate model fails (judged: anchor-unstable, not Ionic-safe, swipe rewrite required). | A library (`@tanstack/vue-virtual`) was evaluated and scored 5/8.5 — high risk, "spike required", forces a swipe-gesture + ion-content bridge rewrite. CSS `content-visibility` (1.5) doesn't bound DOM/memory at all. |
| New `useChatHistory` composable (vs adapting `useLiveQuery`) | Incremental updates (append/patch/remove) avoid the full-array replace that re-allocates the whole list on every reaction/seen/tick — the churn that lands layout work around a load. | `useLiveQuery` is intentionally stateless/atomic-replace; pagination + incremental diff don't fit its callback model and changing it would risk every other caller. |
| Deferred (OUT of scope): compound `[chatId,timestamp]` index + `DB_VERSION 6→7` | Not needed at ≤5-10k (in-memory sort is sub-10ms); would be a forward-only additive index migration only if a chat reaches ~50k+. | Adding it now is migration cost with no real-world payoff; documented so the future path is clear and stays within forward-only rules. |
