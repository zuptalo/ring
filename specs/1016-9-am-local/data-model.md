# Phase 1 — Data Model

Only the existing `push_subscriptions` table changes (additive). No client IndexedDB
change, no new tables.

## `push_subscriptions` (existing — migration 0006) + this feature's additions

| Column | Type | Origin | Purpose |
|---|---|---|---|
| `user_id` | uuid | existing | owner (PK part) |
| `endpoint` | text | existing | unique device push endpoint (PK part) |
| `p256dh` | text | existing | Web Push key |
| `auth` | text | existing | Web Push key |
| `created_at` | timestamptz | existing | — |
| **`installed_version`** | **text NULL** | **new** | the client version this device currently runs (reported on subscribe). NULL = not yet reported → device is not a 9-AM candidate (FR-012). |
| **`tz_offset_minutes`** | **int NULL** | **new** | device local UTC offset in minutes (`getTimezoneOffset()`; `local = UTC − offset`). NULL = not yet reported → not a candidate. |
| **`last_announced_version`** | **text NULL** | **new** | the latest version this device was last *sent* an announcement for. Drives once-per-release dedup. Written only by the scheduler. |

### Validation / rules
- `installed_version`, `tz_offset_minutes` are written via `SaveSubscription` only when the
  request provides them; a request that omits them preserves prior values
  (`COALESCE(EXCLUDED.x, push_subscriptions.x)`).
- `last_announced_version` is written only by `MarkAnnounced` (the scheduler), never by
  subscribe.
- A device is a **9-AM candidate** iff `installed_version IS NOT NULL AND tz_offset_minutes
  IS NOT NULL`.
- A candidate is **behind** iff `installed_version <> <server current version>`.
- A behind candidate is **due** iff `(last_announced_version IS NULL OR <> current)` AND its
  local hour (`UTC − tz_offset_minutes`) == 9.

### State transitions (per subscription, w.r.t. announcements)
```
        subscribe(version V, tz)                scheduler @ local 9AM, behind, not-announced
[no version] ───────────────► [reporting V, tz] ───────────────────────────────────────► [announced=current]
        ▲                              │                                                          │
        │ resubscribe (omit version)   │ user updates → subscribe(version=current)                │ newer release deploys
        └──────────────────────────────┘ ───────────────► [reporting=current → not behind]        └──► [behind again → eligible once for the new version]
```

## Derived / in-memory (not stored)
- **Latest deployed version**: the running server's `version` (ldflags-stamped
  `main.version` → `Handlers.Version`); the comparison reference, not persisted per device.
- **`dueAtNine` result**: the per-tick set of subscriptions whose local hour == 9 — computed,
  not stored.
