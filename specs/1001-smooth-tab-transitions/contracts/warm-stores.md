# Internal Contract: Shared Warm Stores

Internal module API (not a network/public interface) for the in-memory warm cache
layer. Names are indicative; the implementation may refine them.

## Module `src/composables/warmStores.ts` (new)

```ts
// Eagerly populate all warm stores. Idempotent. Called when the keystore unlocks.
export function warmAll(): void;

// Clear all warm stores (drop decrypted values from memory). Called on lock/teardown.
export function clearWarm(): void;
```

### Contract

- `warmAll()` MUST be safe to call multiple times; a second call while warm is a
  no-op (or a cheap refresh), never a reset to cold.
- `warmAll()` MUST only run its decrypt/query work when `isUnlocked` is true.
- `clearWarm()` MUST leave no decrypted profile/list values reachable in memory
  (Principle I). It MUST be wired to the same lock transition the rest of the app
  uses (`isUnlocked` → false).
- Warm stores MUST stay live: they subscribe to the relevant `idb` change-bus
  stores so user edits propagate without a reload.

## `useSelfProfile()` (converted to singleton-backed)

```ts
export function useSelfProfile(): { name: Ref<string>; avatar: Ref<string> };
```

- Returns refs backed by the **shared** SelfProfileStore singleton (same identity
  across all callers), not freshly-created per-call `useLiveQuery` refs.
- Fallback semantics unchanged: `@username` → "You" for name while cold/locked; a
  generated initials avatar when no photo is set. A face/name is always shown.
- Existing call sites keep working with no API change.

## `useLiveQuery(...)` (optional warm-source)

```ts
export function useLiveQuery<T>(
  querier: () => Promise<T>,
  stores: StoreName[],
  initial: T,
  deps?: () => unknown,
  warmSource?: () => T | undefined,   // NEW (optional)
): LiveRef<T>;
```

- When `warmSource` returns a defined value, it is used as the first paint value
  (and `loaded` is treated as already true) instead of `initial`.
- When `warmSource` is absent or returns `undefined`, behavior is **identical to
  today** (no breaking change to existing callers).

## Wiring contract

- `warmAll()` is invoked when `isUnlocked` transitions to `true` (e.g. from the
  app-entry / `useKeyGuard` unlock path) — before the user can navigate tabs.
- `clearWarm()` is invoked on the lock transition.
- Tab pages (Chats/Calls/Contacts) read their list from the corresponding warm
  store for first paint and derive search/pagination as page-local `computed`s.
- `SettingsPage.vue` drops its inlined cold profile reads and uses
  `useSelfProfile()`.
