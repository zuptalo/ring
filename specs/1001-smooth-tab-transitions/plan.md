# Implementation Plan: Smooth Tab Transitions

**Branch**: `feat/1001-smooth-tab-transitions` | **Date**: 2026-06-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/1001-smooth-tab-transitions/spec.md`

## Summary

Tab switching shows the destination screen rendering in pieces — title first, then
search bar / action buttons / filter chips, then list data, and on Settings a
placeholder "You"/initials profile that swaps to the real photo and name. The
root causes are: (1) the four tab pages are **lazy-loaded** (`() => import()`), so
the first switch pays a chunk fetch + fresh mount; (2) every tab reads its data
through `useLiveQuery`, which starts at an **empty `initial` value** and resolves
asynchronously, so the first paint is empty/placeholder; (3) own-profile is read
through a **per-call factory** (`useSelfProfile`) that always starts at the
`'You'`/initials fallback and decrypts async; (4) Calls and Contacts show their
"No … found" empty state with **no `loaded` gate**, so they can flash empty before
data arrives.

The approach is entirely client-side presentation/navigation work, no wire or
data-model changes:

1. **Warm, shared in-memory stores.** Promote own-profile (and the per-tab list
   queries) from cold per-mount factories to **module-level singletons** that are
   **eagerly warmed right after keystore unlock**, so by the time the user
   navigates, the reactive values are already populated. A tab then mounts with
   real data in its first paint instead of an empty/placeholder state. The warm
   cache lives only in memory (decrypted client-side); nothing plaintext is
   persisted in the clear — this preserves the zero-knowledge boundary.
2. **Eager-load the four tab page components** (static imports for the `/tabs`
   children) so the first switch has no chunk-fetch/parse delay.
3. **Rely on and lock in `IonRouterOutlet` keep-alive** for return visits
   (instant restore of content + scroll), with an e2e test that proves a
   previously-visited tab restores without re-showing empty states.
4. **Gate every empty state behind `loaded`** (Calls, Contacts — Chats already
   does this) as defense-in-depth against the empty-flash, and **reserve layout
   space** for late elements to remove post-paint layout shift.

## Technical Context

**Language/Version**: TypeScript (ES modules, `@/` → `src/`), Vue 3 `<script setup>`, Ionic Vue 8

**Primary Dependencies**: `@ionic/vue` + `@ionic/vue-router` (IonTabs / IonRouterOutlet / iosTransitionAnimation), Vue 3 reactivity, libsodium-backed `getSecret` (read-only here), IndexedDB via `src/db/idb.ts` + `useLiveQuery`

**Storage**: IndexedDB is the source of truth (unchanged). This feature adds an **in-memory** warm cache only — no new object store, no `DB_VERSION` bump, no cleartext-at-rest.

**Testing**: `vue-tsc --noEmit` typecheck (`npm run build`), vitest unit (`npm run test:unit`), Playwright e2e (`npm run test:e2e`, driven via `window.__ringTest`)

**Target Platform**: Installable PWA; primary risk surface is iOS WebKit (large-title transition, no WS headers), plus Android/desktop browsers

**Project Type**: Single project — Vue 3 + Ionic PWA client (no server changes)

**Performance Goals**: 60 fps tab transition; destination screen visually complete in its first painted frame on return visits and (with warm caches) on first visit; zero layout shift after first paint

**Constraints**: Must not persist profile/list plaintext in the clear (zero-knowledge); must not regress RTL/bidi or a11y; must keep `swipeBackEnabled: false` / `scrollAssist: false` and the existing `switchTab('root','replace')` navigation semantics that fixed prior tab-highlight desync; must not silently reload the PWA (`registerType: 'prompt'`)

**Scale/Scope**: 4 bottom-tab pages (Calls, Chats, Contacts, Settings), 1 router config, 1 shared-profile composable, `useLiveQuery` (optional warm-source support), the existing in-memory warm stores; no backend

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Zero-Knowledge Boundary (NON-NEGOTIABLE)** — PASS. Nothing new crosses the
  wire; the server is untouched. The one sensitive design choice — how to make
  the profile appear instantly — is resolved **in memory only**: decrypt via the
  existing `getSecret` once at unlock and hold the result in a module-level
  reactive cache. We explicitly **reject** any cleartext-at-rest profile/list
  cache. The spec's *Zero-Knowledge Impact* section records this.
- **II. Spec-Driven Development** — PASS. Spec → (clarify skipped: unambiguous) →
  this plan → tasks → analyze → implement, all under `1001-` with traceable branch.
- **III. Test-Driven Development** — PASS (planned). New user-facing behavior adds
  e2e specs under `e2e/` (no empty-flash, instant return with preserved scroll,
  real identity on first Settings paint). Shared warm-store composable gets vitest
  unit tests. Tests are authored before implementation in `tasks.md` ordering.
- **IV. Crypto Discipline** — PASS. No crypto is added or changed; we only *read*
  existing secrets through the existing `getSecret` path. The crypto core stays
  pure; the warm cache lives in the service/composable layer.
- **V. Offline-First Data Integrity** — PASS. IndexedDB stays the source of truth;
  no store added, no `DB_VERSION` bump. Warm caches are derived in-memory views
  that still subscribe to the `idb` change bus (live edits propagate).
- **VI. Stateless Server & Forward-Only Migrations** — PASS. No server/DB change.
- **VII. Quality Gates** — PASS (planned). `npm run build`, vitest + floors, e2e
  where behavior changed; `registerType: 'prompt'` preserved.
- **IX. Privacy & Data Minimization** — PASS. No new data collected/transmitted.
- **X. Accessibility & Internationalization** — PASS. Ionic-native components kept;
  RTL/bidi and a11y explicitly covered by FR-009 and a regression check.

**Checklist requirement**: This spec makes an explicit decision bearing on
**Principle I** (in-memory vs at-rest profile cache), so `/speckit-checklist` is
REQUIRED before `/speckit-implement` (see Domain Constraints in the constitution).

**Gate result**: PASS — no violations; Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/1001-smooth-tab-transitions/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output (in-memory warm-cache state shapes)
├── quickstart.md        # Phase 1 output (how to verify smoothness)
├── contracts/           # Phase 1 output
│   ├── rendering-invariants.md   # UI contract: what every tab-switch frame guarantees
│   └── warm-stores.md            # internal module API for the shared warm stores
└── checklists/
    └── requirements.md  # spec quality checklist (from /speckit-specify)
```

### Source Code (repository root)

```text
src/
├── router/
│   └── index.ts                 # /tabs children: lazy import() → static import (eager-load)
├── views/
│   ├── TabsPage.vue             # IonTabs/IonRouterOutlet host; confirm keep-alive holds with switchTab('root','replace')
│   └── tabs/
│       ├── ChatsPage.vue        # consume shared warm chat store; keep loaded-gate
│       ├── CallsPage.vue        # consume shared warm calls store; ADD loaded-gate to empty state
│       ├── ContactsPage.vue     # consume shared warm contacts store; ADD loaded-gate to empty state
│       └── SettingsPage.vue     # adopt shared singleton self-profile (drop inlined cold copy)
├── composables/
│   ├── useSelfProfile.ts        # factory → module-level singleton; warm eagerly at unlock
│   ├── useLiveQuery.ts          # optional: accept a warm-source so `initial` can be a populated cached value
│   └── (new) warmStores.ts      # module-level shared chats/calls/contacts/profile refs + warmAll() on unlock
└── (wiring) app entry / useKeyGuard.ts  # call warmAll() when isUnlocked flips true

e2e/
├── tab-transitions.spec.ts      # NEW: no empty-flash, instant return + scroll, real identity on first Settings paint
└── (existing specs unchanged)

src/composables/__tests__/ (or sibling *.test.ts)
└── warmStores / useSelfProfile singleton unit tests   # NEW
```

**Structure Decision**: Single-project Vue 3 + Ionic PWA. All changes are
client-side under `src/` (router, four tab views, profile/live-query composables,
one new warm-stores module) plus tests under `e2e/` and vitest unit files. No
`server/`, no migrations, no `DB_VERSION` change.

## Complexity Tracking

*No constitution violations — section intentionally empty.*
