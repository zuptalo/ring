# Implementation Plan: Navigation & notification robustness

**Spec**: [spec.md](./spec.md) · **Branch**: `fix/2010-nav-notification-robustness` · **Date**: 2026-06-25

## Summary

Two independent robustness fixes in the client only (no server change, zero-knowledge boundary
intact):

1. **Navigation** — stop the iOS-PWA edge back-swipe from underflowing past the app's single history
   entry into a blank browser view. Keep a shell entry beneath the tab roots and add a catch-all
   route, using stock vue-router/Ionic routing (no popstate hacks).
2. **Notifications** — make the foreground-page ↔ service-worker hand-off deterministic so the same
   chat reliably shows content (per `notifyContent`) when unlocked, with exactly one notification per
   message, and fix the SW generic-vs-content timeout ordering + cold-start latency.

## Technical Context

- **Client**: Vue 3 + Ionic + vue-router (`createWebHistory`), custom service worker (`src/sw.ts`),
  Web Push (content-free tickle → SW fetches `/relay/pending` + decrypts + shows). Per-chat
  notification prefs already exist (`Chat.notifyContent | notifyWebPush | notifyInApp | mutedUntil`).
- **Server**: unchanged.
- **Testing**: Playwright e2e (`e2e/`), incl. `navigation.spec.ts` and notification specs; the SW
  notification logic is exercised via the page↔SW message protocol and the dev `__ringTest` hooks.
- **Constraints**: zero-knowledge (no content in push payload; decrypt on-device over the sealed
  relay); iOS/Safari installed PWA must keep showing a notification per push.

## Root causes (from investigation)

### Navigation (US1)
- The app runs at browser-history **depth 1** at the tab roots: `/` → redirect to `/tabs/chats`
  (`router/index.ts:17`), tab switches use Ionic `navigate(path,'root','replace')`
  (`TabsPage.vue:92-95`), `swipeBackEnabled:false` (`main.ts`), and the OS edge-swipe **cannot** be
  disabled. With one entry, the OS swipe pops past `start_url` → the pre-PWA blank document inside the
  app shell. There is also **no catch-all route**, so any unmatched path renders nothing. (The old
  `fix(nav)` flattening commits `b16b095`/`3dc18e1` are intact — this is an always-present gap, not a
  regression.)

### Notifications (US2/US3)
- **(a) Ambiguous hand-off (primary):** the page posts `ring:handled` to the SW the instant it sees
  it's unlocked (`App.vue:173-183`), *not* when it actually shows something. The SW then stays silent
  (`sw.ts:459-462`) while the page legitimately drops the alert via the 2.5s post-unlock settle window
  (`notify.ts:318`, `useSync.ts:496`), a `document.visibilityState` race in `notifyLocal`
  (`push.ts:106-109`), or an idle/connected transport where `nudgeReconnect` is a no-op
  (`useSync.ts:210-214`) so the message isn't drained in the push window. Result: content (page) vs
  nothing vs SW-generic, at random.
- **(b) SW timeout ordering:** `GENERIC_AFTER_MS=6000` shows generic if fetch+decrypt is slow, but the
  upgrade window `SETTLE_MAX_MS=9000` is too tight vs `PENDING_FETCH_TIMEOUT_MS=8000`
  (`sw.ts:82-83`, `sw-inbox.ts:99`), so a slow fetch shows generic and never upgrades.
- **(c) SW cold start:** the SW re-derives the unlocked key bundle on every fresh wake (separate
  in-memory state from the page, `identity.ts:445-460`), and does so *after* the fetch
  (`sw-inbox.ts:298`), so the first push after eviction pays libsodium-init + unwrap latency and
  misses the 6s timeout → generic.

## Design

### US1 — Navigation (stock routing, no hacks)
1. **Catch-all route** at the end of the route table (`router/index.ts`):
   `{ path: '/:pathMatch(.*)*', redirect: '/tabs/chats' }` → no path ever renders blank (FR-002).
2. **Anchor a shell entry beneath the tab roots** so history depth ≥ 2 at a tab root. Keep `/` as a
   real entry rather than collapsing onto it: on first landing (the `/`→tabs redirect and the auth
   entry in `AuthPage.vue`), ensure a base `/` entry remains, so the OS back-swipe from a tab root
   pops to `/`, whose redirect immediately bounces back into `/tabs/chats` — the user stays in the app
   (FR-001). The terminal-tab `switchTab` flattening (`TabsPage.vue`) and `swipeBackEnabled:false`
   stay exactly as they are; detail-page back is unchanged (FR-003/FR-004).
3. Decision: a tab-root back-swipe is a **benign no-op / re-anchor** (stay in app), not an attempted
   app exit (which the platform can't do cleanly and is what surfaces the blank view).

### US2/US3 — Deterministic notification hand-off + SW timing
1. **Single source of truth for who alerts (FR-006/FR-007):**
   - The **page acks `ring:handled` only when it actually presents a visible in-app banner** (app
     visible + not suppressed). When the page is hidden, or would suppress (settle window / muted /
     active chat / content=none), it does **not** ack → the SW deterministically owns the OS
     notification. Remove the page's "ack-on-unlocked" behavior and the page-side `notifyLocal`
     OS-notification path from the hand-off (the SW owns OS notifications).
   - Exclude push-woken items from the `settledUntil` suppression so a freshly-woken message is never
     swallowed-and-acked.
2. **SW timeout ordering (FR-008):** widen `SETTLE_MAX_MS` above `PENDING_FETCH_TIMEOUT_MS` (e.g.
   8000 fetch → 12000 settle) so a decrypt that lands within the fetch budget always upgrades the
   generic; keep the per-chat tag replace (`closeByTag(GENERIC_TAG)` → show content).
3. **Cold-start (edge case):** kick libsodium `ready()` + `attemptDeviceUnlock()` **in parallel** with
   the `/relay/pending` fetch (instead of after it) so cold-wake decrypt latency overlaps the fetch.
4. **iOS-safe (FR-013):** the SW still calls `showNotification()` for every push (generic placeholder
   first if needed, upgraded after); badge-only (`notifyContent='none'`) updates the badge — verify on
   iOS the push handler still presents *something* per push or the badge-only path is acceptable to
   the platform (document the on-device check).
5. **No new settings (FR-010):** all per-chat prefs unchanged; this only makes them deterministic.

## Constitution / zero-knowledge check

- **Principle I (Zero-Knowledge):** unchanged — no content in the push payload; the SW still fetches
  the sealed message over the existing relay and decrypts on-device. No new server route/metadata.
- **No server change** (FR-012). **TDD:** notification hand-off decision logic is factored into a
  pure/testable predicate where feasible (who-owns-the-alert given app-state/lock/visibility/prefs)
  with unit tests; the e2e harness covers the cross-context behavior; navigation gets an e2e for the
  history-depth invariant.

## Files (anticipated)

- Navigation: `src/router/index.ts` (catch-all + entry anchoring), possibly `src/views/tabs/AuthPage.vue`
  / `src/main.ts` (entry), `e2e/navigation.spec.ts` (depth ≥ 2 + back-at-root stays in-app).
- Notifications: `src/App.vue` (ack-only-when-shown), `src/services/notify.ts` (return whether it
  presented; exclude push items from settle suppression), `src/sw.ts` (hand-off + timeouts),
  `src/services/sw-inbox.ts` (parallel unlock + timeouts), small pure helper + unit test for the
  ownership predicate, plus an e2e for consistent-content / single-notification.

## Phasing

US1 (navigation) is independent and the smallest, shippable on its own. US2 then US3 (same hand-off
mechanism). Polish: full gate (build, unit, server, e2e) + on-device iOS notification check + roadmap.
