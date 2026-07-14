# Contract: push routing (spec 1050)

## Wire shapes

WS `msg` frame (client → server), new OPTIONAL fields:
```json
{ "t": "msg", "to": "...", "id": "...", "ciphertext": {...},
  "class": "message|mention|reaction|activity|game|post|housekeeping",  // absent = message
  "prid": "b64url-16-bytes" }                                            // absent = no route id
```

`PUT /v1/push/prefs` (bearer auth; full-state replace; 204):
```json
{ "classesOff": ["reaction","game"],
  "mutedPrids": ["...", "..."],
  "postSenders": { "muted": ["userId"], "always": ["userId"] } }
```
Empty body/object = push everything (old behavior). Prefs live and die with the
subscription row (migration 0028 JSONB column).

Sealed payload (inside E2EE, server-invisible): `MessagePayload.prid` for adopt-on-receive.

## Server push decision (per frame, at enqueue; per subscription, at send)

| # | Condition (in order) | Push? |
|---|---|---|
| 1 | recipient blocked sender | no (unchanged, before everything) |
| 2 | recipient active-fresh AND live send succeeded | no (unchanged) |
| 3 | class = housekeeping | no |
| 4 | class = mention | **yes** (pierces 5–7) |
| 5 | class ∈ subscription.classesOff | no |
| 6 | frame.prid ∈ subscription.mutedPrids | no |
| 7 | class = post AND sender ∈ postSenders.muted | no |
| 7b | class = post AND global post opt-out BUT sender ∈ postSenders.always | **yes** |
| 8 | otherwise | yes (existing debounced tickle) |

Conn tickles: presence-gated like messages (fixes push-while-in-app). Call path: untouched,
never filtered. Held ≠ dropped: rows 3/5/6/7 frames deliver via the normal drain unchanged.

## Client class assignment (send site, per recipient)

| Event | author/target recipient | prior co-reactor | mentioned/replied-to recipient | everyone else |
|---|---|---|---|---|
| reaction add | reaction | reaction | — | housekeeping |
| reaction remove | housekeeping | housekeeping | — | housekeeping |
| plain message | message | — | mention | message |
| group create card | — | — | — | housekeeping |
| group invite card | message (unchanged) | — | — | — |
| edits/votes/erase/rekey/ttl/receipts | housekeeping | — | — | housekeeping |
| wall post (server-side kind) | class post + author for overrides | — | — | — |
| wall engagement → author | activity | — | — | n/a |

## Prefs derivation (pure, client)

`classesOff`: reaction ⇔ BOTH reaction toggles off · game ⇔ ALL four game alert toggles
off · post ⇔ wall.show off · activity ⇔ wall.activity off · message+mention ⇔ global
message.show off. `mutedPrids`: chats with active mute OR notifyWebPush=false, MINUS the
hidden set (structural, SC-011 guard). `postSenders`: wall per-person mutes + the new
per-friend always-alert flags. Full-state replace, debounced, re-sent on subscription
upsert and every relevant change.
