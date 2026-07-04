# Implementation Plan: Notification tap opens the chat (spec 2018, hotfix)

**Branch**: `fix/2018-notification-tap-opens` | **Date**: 2026-07-04 | **Spec**: [spec.md](spec.md)

## Root cause

`src/App.vue`: the `isUnlocked` watcher (`immediate: true`) consumes the pending nav —
potentially during component SETUP, before first paint — and `routeRelevant`'s cold-start
branch runs `await router.replace('/tabs/chats')` + `await router.push(target)` back to
back. vue-router's awaits do not cover Ionic's animated outlet transition, so the push can
land while the outlet is mid-(first)-transition; Ionic drops the view swap and the URL/state
diverge from the rendered view. Introduced by `ecdf5f3` (2026-07-02); made near-
deterministic by spec 1032's faster cold open.

## Fix (App.vue only)

1. **First-paint gate**: a `firstPaint` promise resolved in `onMounted` + double
   `requestAnimationFrame`. The cold-start branch awaits `router.isReady()` and
   `firstPaint` before any navigation (FR-002).
2. **No same-route churn**: skip the `replace('/tabs/chats')` when the current route is
   already `/tabs/chats` (the iOS case — the auth gate has already landed there pre-mount);
   otherwise (platform honored the deep link) do the replace, then wait a double-rAF settle
   before the push so the two Ionic transitions never overlap (FR-001, FR-003).
3. Live path (`ring:navigate` with `coldStart=false`) untouched (FR-004).

## Constitution check

- III (TDD): failing regression e2e first (`e2e/notification-nav.spec.ts`): stash
  pending-nav via the settings store, reload (cold start), assert rendered chat content AND
  URL, then back → Chats list. Note: the device race may not reproduce headless — the test
  pins the invariant either way; device verification by the reporter precedes merge.
- I (zero-knowledge): no wire impact. IV: no crypto. XI: no UI change.

## Verification

- `npx playwright test e2e/notification-nav.spec.ts` (new) + `e2e/sw-persist.spec.ts` +
  `e2e/sw-decrypt.spec.ts` regression.
- `npm run build`, `npx vitest run`.
- Real-device verification on ring-dev by the reporter BEFORE anything is committed/pushed
  (explicitly requested).
