# Data Model: Wall notifications go to the owner only (spec 1031)

No new entities, no IndexedDB store changes (no `DB_VERSION` bump), no SQL migration.
This feature changes *routing and decisions* over existing data. What it reads/writes:

## Existing entities (read-only for this feature)

### Post (`src/db/types.ts`, IDB `posts` store)

| Field used | Purpose here |
|------------|--------------|
| `id` | push payload target; deep-link `/wall/post/<id>` |
| `author` / `outgoing` | **ownership check** — the page and SW alert only when `outgoing === true` (it's our post); the server routes the push via `PostAuthor` |
| `postKey` | SW opens sealed reaction payloads to drop removals |

### PostEngagement (`src/db/types.ts`, IDB `postEngagement` store)

| Field used | Purpose here |
|------------|--------------|
| `type` (`reaction`\|`comment`\|`view`) | views never alert (FR-011) |
| `actor` | self-action exclusion (FR-004); actor named in the alert |
| `emoji` | banner copy "reacted 〈emoji〉 to your post" |
| `deleted` | removals/tombstones never alert (FR-002/FR-011) |
| `at` | freshness windows (5 min page / 10 min SW) |

Server rows (`post_engagement` table): `kind` is **cleartext** (reaction/comment/
tombstone), `payload` is sealed under K_post (carries the reaction `remove` flag and
comment text). Unchanged.

## New/changed values

### Settings (existing `settings` IDB store — data only, no schema)

| Key | Type | Default | Notes |
|-----|------|---------|-------|
| `notifications.wall.activity` | boolean | `true` | NEW — gates all engagement alerts (page banner + SW notification). Added to `SYNCED_PREF_KEYS`. |
| `sw.wallActShown` | `{id, ts}[]` | `[]` | NEW — SW shown-ledger for engagement ids (mirrors `CONN_SHOWN_KEY`: capped, pruned). Device-local, never synced. |
| `notifications.wall.show` | boolean | `true` | unchanged — new-post alerts only |
| `wall.muteUntil` | number | `0` | unchanged — temp mute now also gates engagement alerts |
| `wall.mutedUsers` / `wall.hiddenUsers` | map | `{}` | unchanged — deliberately NOT consulted for engagement on own posts (clarification) |

### Push payloads (Web Push, encrypted per-subscription)

| Payload | Sent to | When |
|---------|---------|------|
| `{"t":"post"}` | each recipient | new post (unchanged); **no longer sent for engagement** |
| `{"t":"post-activity","post":"<uuid>"}` | **post author only** | NEW — reaction or comment by someone else (never tombstone, never self) |

Push topic for `post-activity`: derived from the post id (base64url SHA-256 prefix,
≤32 chars) so bursts on one post collapse at the push service.

### WS frames (unchanged)

`{t:'post-engagement', post}` — still fanned to the whole audience except the actor
(live data sync). The *alert* decision moved entirely to the recipient device.

## Decision predicate (pure, new module `wall-activity-policy.ts`)

Input → `'alert' | 'skip'`:

```
isOwnPost && actor !== self
  && (type === 'reaction' || type === 'comment') && !deleted
  && now - at <= FRESH_MS
  && activityEnabled && !tempMuted
  && !alreadyNotified
```

State transitions: none (notifications are transient; nothing persisted beyond the SW
shown-ledger and the session dedupe set).
