# Phase 1 Data Model: Smooth Tab Transitions

This feature introduces **no persistent data model change** — no new IndexedDB
object store, no `DB_VERSION` bump, no SQL migration, no wire schema. IndexedDB
(via `src/db/idb.ts`) and the encrypted-at-rest secrets remain the source of
truth, unchanged.

What it does add is an **in-memory, derived state layer**: module-level singleton
reactive views that mirror data already in IndexedDB so it is available
synchronously at a tab's first paint. These are caches, not storage.

## In-memory warm stores (transient, derived)

Each store is a module-level singleton living only for the app session. It is
populated by the existing `getSecret` / list-query paths, stays live via the
`idb` change bus, and is **cleared on lock/teardown**.

### SelfProfileStore (singleton)

| Field      | Type            | Initial (cold) | Warm value                          | Notes |
|------------|-----------------|----------------|-------------------------------------|-------|
| `name`     | `Ref<string>`   | username → "You" | decrypted `profileName`            | falls back to `@username` then "You" only while cold/locked |
| `avatar`   | `Ref<string>`   | initials avatar | decrypted `profileAvatar` (data URL) | falls back to generated initials avatar so a face always shows |
| `warmed`   | `Ref<boolean>`  | `false`        | `true` after first successful decrypt | drives whether first paint is "real" |

- **Source**: `getSecret('profileName')`, `getSecret('profileAvatar')` (existing).
- **Lifecycle**: warmed eagerly when `isUnlocked` becomes `true`; updated live when
  the user edits their profile (the `settings` store change bus); cleared on lock.
- **Consumers**: `SettingsPage.vue` and every existing `useSelfProfile()` caller
  (call tiles, group member lists, reply quotes, media captions).

### List warm stores: Chats / Calls / Contacts (singletons)

| Field      | Type                 | Initial (cold) | Warm value                | Notes |
|------------|----------------------|----------------|---------------------------|-------|
| `items`    | `Ref<T[]>`           | `[]`           | result of the list query  | `T` = Chat / CallGroup / Contact |
| `loaded`   | `Ref<boolean>`       | `false`        | `true` after first resolve | gates empty-state rendering |

- **Source**: existing `listChats` / `listCallGroups` / `listContacts` queries,
  invoked with an **empty search term** (the default/unfiltered list).
- **Search contract**: The warm store holds only the **unfiltered** default list —
  this is what first paint needs (a tab is always entered with an empty search box).
  Search term is page-local UI state. When the search box is **empty**, the page
  renders from the warm store (instant, populated first paint). When the user
  **types a term**, the page falls back to the existing live query path
  (`listChats(term)` / `listContacts(term)` / `listCallGroups(term)`) — this is an
  active-interaction moment where a brief async resolve is acceptable and avoids
  re-implementing data-layer filtering on the client. Net effect: no behavior or
  search-semantics change versus today; only the empty-search first paint becomes
  warm. Pagination (`visible`) stays page-local and resets on term change as today.
- **Lifecycle**: warmed at unlock; kept live via the `idb` change bus
  (`chats`/`messages`/`chatlists`, calls, contacts stores); cleared on lock.

## State transitions (per store)

```text
[locked / pre-unlock]
      │  isUnlocked → true  (warmAll())
      ▼
[warming]  ── first query/getSecret resolves ──►  [warm]  (loaded/warmed = true)
      ▲                                              │
      │                                  idb change bus fires (live edit)
      │                                              ▼
      │                                          [warm, refreshed]
      │  isUnlocked → false (lock / teardown)
      └──────────────────────  [cleared]  ◄─────────┘
```

## Relationship to `useLiveQuery`

`useLiveQuery` keeps its current contract (initial value + async resolve + live
subscription) and gains an **optional warm-source** parameter so a page can supply
the singleton's current value as its `initial`. When a warm value exists, the first
paint is already populated and `loaded` is effectively true; when cold, behavior is
exactly as today. No breaking change to existing callers.

## Validation / invariants

- The warm cache MUST never be serialized to clear storage (Principle I; spec
  FR-ZK-1) — not IndexedDB, `localStorage`, `sessionStorage`, Cache Storage, or any
  serialized form.
- A consumer MUST treat the warm value as authoritative for first paint but still
  reactive to live edits (no stale lock-in).
- Clearing MUST run on **every** session-end transition — keystore lock, sign-out,
  and account removal (spec FR-ZK-2) — and MUST be complete: every ref returns to
  its cold initial value (lists `[]` + `loaded=false`; profile name→username/"You",
  avatar→initials, `warmed=false`). This is the verifiable evidence of "no residue"
  (spec FR-ZK-3 / SC-006).
- `warmAll()` MUST run only when unlocked; a failed/aborted unlock MUST NOT warm
  any store. If a `getSecret`/list query fails mid-warm, that store stays cold (its
  cold fallback) rather than caching a partial/fallback value as real (spec FR-ZK-4).
- The singleton is scoped to one document/JS context; separate PWA tabs/windows do
  not share warm plaintext (spec Assumptions).
