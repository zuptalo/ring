# Phase 0 Research: Smooth Tab Transitions

This document records the investigation of the current rendering pipeline and the
decisions that resolve each cause of visible pop-in on tab switch. No open
`NEEDS CLARIFICATION` items remain.

## Current behavior (as found in code)

- **Tabs host** (`src/views/TabsPage.vue`): bare `<ion-router-outlet>` inside
  `<ion-tabs>`; tab taps call `switchTab()` →
  `ionRouter.navigate(path, 'root', 'replace', emptyAnimation)`. The `'root'`
  direction + empty animation were deliberate fixes for a prior tab-highlight /
  page desync bug — must be preserved.
- **Routing** (`src/router/index.ts`): all four `/tabs` children are
  `() => import()` (lazy chunks). Auth guard redirects unauthenticated users to
  `/auth`.
- **Ionic init** (`src/main.ts`): `IonicVue` configured with
  `swipeBackEnabled: false`, `scrollAssist: false`, and a custom `navAnimation`
  (empty for `'back'`, `iosTransitionAnimation` forward). Relies on
  `IonRouterOutlet`'s default page caching (pages stay mounted, hidden off-screen).
- **Data loading** (`src/composables/useLiveQuery.ts`): every query starts at a
  caller-supplied `initial` value with `loaded=false`, calls `run()` on mount, and
  resolves the real value in a later microtask; `loaded` flips true after the first
  resolve. So the **first paint of a freshly-mounted page is always the empty/
  placeholder state.**
- **Per-tab specifics**:
  - Chats: header (search + filter chips) renders unconditionally; empty state is
    correctly gated `v-if="loaded && chats.length === 0"`.
  - Calls: empty state `v-if="calls.length === 0"` — **no `loaded` gate** → can
    flash "No calls found".
  - Contacts: empty state `v-if="contacts.length === 0"` — **no `loaded` gate** →
    can flash "No contacts found".
  - Settings: own-profile read via cold `useLiveQuery` (`name='You'`,
    `avatar=''→initials`), resolves after keystore unlock → visible "You"/"Y" →
    real "Kamran"/photo swap. `useSelfProfile` is a **factory**, not a singleton,
    so every mount restarts cold.

## Decisions

### D1 — Eager-load the four tab page components

- **Decision**: Change the `/tabs` child routes from `() => import()` to **static
  imports** so the tab components are in the entry graph and incur no chunk fetch /
  parse delay on first switch.
- **Rationale**: The four tabs are the app's core surface, reachable within
  seconds of launch and already precached by the service worker. Lazy-splitting
  them saves negligible initial bytes while guaranteeing a first-switch stall.
- **Alternatives considered**:
  - *Idle prefetch of the other three chunks after the first tab paints* — keeps a
    smaller entry chunk but leaves a race if the user switches before prefetch
    completes; more moving parts. Rejected in favor of deterministic static import.
  - *Status quo (lazy)* — rejected; it is a direct cause of the pop-in.

### D2 — Shared, warm in-memory stores (the core fix)

- **Decision**: Introduce module-level **singleton** reactive stores for
  own-profile and the per-tab lists (chats, calls, contacts), and **warm them
  eagerly when the keystore unlocks** (`isUnlocked` flips true, e.g. via
  `useKeyGuard`/app entry). Tab pages and `useSelfProfile` consume these shared
  refs instead of creating cold per-mount queries. `useLiveQuery` gains an optional
  warm-source so a page's first `initial` value can be the already-populated cached
  value rather than `[]`/`'You'`.
- **Rationale**: This makes the destination screen's data present in its **first
  painted frame** on both first and return visits, which is what "appears fully
  formed" (FR-001, FR-002, SC-001) and "real identity immediately" (FR-005, SC-003)
  require. Sharing the refs also means edits propagate everywhere (the stores still
  subscribe to the `idb` change bus), and avoids redundant re-decryption per mount.
- **Zero-knowledge**: the warm cache holds decrypted values **in memory only**,
  produced by the existing `getSecret` path. No plaintext is written to clear
  storage; on lock/teardown the in-memory refs are cleared. This is the explicit
  Principle-I decision (see plan Constitution Check and spec Zero-Knowledge Impact).
- **Alternatives considered**:
  - *Cleartext-at-rest cache of last-known profile/lists for instant first paint* —
    **rejected**: violates the zero-knowledge boundary (profile/contacts/chat
    metadata are user content and must be AEAD-wrapped at rest).
  - *Skeleton placeholders instead of real data* — acceptable only as a fallback
    when caches are genuinely cold (see D4); not a substitute for warm data because
    the spec asks for the *real* screen, not a shimmer.

### D3 — Lock in `IonRouterOutlet` keep-alive for return visits

- **Decision**: Keep relying on Ionic's page caching so a previously-visited tab is
  restored instantly with its content and scroll position; add an e2e test that
  fails if a return visit re-shows an empty/placeholder state or loses scroll, and
  verify `switchTab('root','replace')` does not tear pages down.
- **Rationale**: Satisfies FR-003 / SC-004 with the framework's built-in mechanism;
  the test prevents future regressions (e.g. someone adding `v-if` on the outlet).
- **Risk + fallback**: `switchTab` uses the `'root'` direction + `'replace'` action
  (a deliberate fix for a prior tab-highlight desync) — these MUST be preserved. If
  that combination turns out to **not** retain the cached page (so scroll/content is
  lost on return), the warm stores already restore *content* on the next mount, but
  **scroll position** would still be lost. Fallback for that case only: persist each
  tab's `scrollTop` on `onIonViewWillLeave` and restore it on `onIonViewDidEnter`
  (in-memory, page-local). This fallback is conditional — implemented only if the
  keep-alive verification fails.
- **Alternatives considered**: *Explicit `<keep-alive>`* — redundant with
  `IonRouterOutlet` and can conflict with Ionic's lifecycle; rejected. *Changing
  `'root'`/`'replace'` to restore caching* — rejected; would reopen the desync bug.

### D4 — Gate empty states behind `loaded`; reserve layout space

- **Decision**: Add a `loaded` gate to the Calls and Contacts empty states (mirror
  Chats), and reserve vertical space for late-arriving header/list regions so
  nothing reflows after first paint.
- **Rationale**: Defense-in-depth against the empty-flash (FR-006) even if a cache
  is momentarily cold, and removes post-paint layout shift (FR-004 / SC-002).
- **Alternatives considered**: *Rely solely on warm caches* — rejected; the gate is
  cheap insurance for genuinely cold first-run and slow-decrypt edge cases.

### D5 — First-run / cold-cache presentation (FR-010 edge case)

- **Decision**: When a cache is genuinely not yet warm (very first launch before
  unlock completes), show a **single stable intentional state** (the gated empty
  region with reserved space, or a brief skeleton) that does **not** shift layout
  when real content arrives — never an empty→placeholder→populated sequence.
- **Rationale**: Directly satisfies FR-010 and the "first visit" / "slow load"
  edge cases without re-introducing flicker.

## Open questions

None. The spec carried no `NEEDS CLARIFICATION` markers and the investigation
resolved the mechanism behind every observed frame.
