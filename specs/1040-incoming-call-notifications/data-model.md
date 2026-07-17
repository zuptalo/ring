# Data Model: Incoming call & friend-request notifications (spec 1040)

No new object store and no `DB_VERSION` bump. One new sealed payload field,
two namespaced `settings`-store keys (the established SW↔page channel), and
integrity rules over the existing `calls` store.

## Sealed payload: `callEvent` (new optional field on `MessagePayload`)

Rides the existing pairwise Double Ratchet envelope exactly like
`reaction`/`gameMove`; never rendered as a chat bubble.

| Field | Type | Notes |
|---|---|---|
| `phase` | `'ring' \| 'ended'` | dial-time vs outcome-time marker |
| `callId` | string | the live call's id — dedup key across markers, live logging, and re-sends |
| `kind` | `'audio' \| 'video'` | drives the emoji/cue and the log's `video` flag |
| `outcome` | `'missed' \| 'cancelled' \| 'answered'` | `ended` only. `cancelled` = caller hung up before answer (logs as missed per clarification); `answered` = answered on some device (clears pending, logs nothing) |
| `roomId?` | string | group calls: the room; used to resolve the group chat + name locally |
| `at` | number (ms) | sender clock; staleness/ordering hint only, never trusted for identity |

Sender duties (`useCall.ts`):

- 1:1 dial → `ring` to the callee; group dial → `ring` pairwise to each invitee.
- Caller no-answer timeout → `ended/missed`; caller cancel → `ended/cancelled`;
  answer (any callee device) → caller sends `ended/answered`.
- Markers are fire-and-forget; loss degrades per the reconcile rules below.

## Pending call events (receiver side, `settings` store key)

`callEvents.pending`: `{ [callId]: { from, kind, roomId?, receivedAt } }` —
written by the `receiveIncomingInner` `callEvent` branch on `ring`, consumed
by `ended` or by reconciliation.

| Transition | Effect |
|---|---|
| `ring` arrives | record pending (idempotent; never duplicates) |
| `ended/missed` or `ended/cancelled` | if no `calls` row for `callId`: `createCall`-shaped missed row (`missed: true, seen: false`) + `logCallToChat` into the 1:1 chat (or group chat via `roomId`; Calls tab only when no chat resolves) — then clear pending |
| `ended/answered` | clear pending, write nothing (answered-elsewhere is not missed — FR-016) |
| pending older than ring window + no outcome + no `calls` row for `callId` | reconcile to missed (caller crashed mid-ring) |
| pending but a `calls` row for `callId` exists | clear pending, write nothing (live path already logged — FR-018) |

## SW call-badge units (`settings` store key `sw.callBadge`)

`Array<{ callId?: string; ts: number; state: 'ringing' | 'missed' }>` — the
transient badge contribution while the app is closed.

| Event | Rule |
|---|---|
| call tickle, no fresh `ringing` unit (and marker `callId` unknown) | append `ringing` unit → badge +1 (FR-007) |
| call tickle while a `ringing` unit is fresh (ring window) or `callId` matches | no change (FR-008); distinct decryptable `callId`s each get a unit |
| missed/cancelled marker previewed by SW | flip that unit `ringing → missed` (same unit — FR-010) |
| answered marker previewed by SW | remove the unit |
| page foreground/open | page clears ALL units (`useAppBadge` sweep): ringing increments vanish (FR-009); missed calls are represented in the `calls` store by then and counted by `countMissedUnseen` |
| unit older than a stale bound (e.g. 24h) | dropped on next SW pass (hygiene) |

Badge totals: SW total (`updateAppBadge`) = existing `unreadCount() + newCount`
**+ units.length**; page total (`useBadges`) unchanged (already includes
missed-unseen calls).

## Existing entities touched (rules only, no shape change)

- **`calls` store row** (`Call`, keyed `callId`): marker-created rows use
  `direction: 'incoming'`, `missed: true`, `seen: false`, `video` from `kind`,
  `isGroup`/`roomId` when group. Never overwrite an existing row for the same
  `callId`.
- **Chat `kind: 'call'` message row** (`logCallToChat`): same local-only shape
  as live logging; hidden-chat exclusions (`hiddenCallKeys`) apply unchanged.
- **`GET /v1/connections` outgoing DTO**: unchanged shape; the set now
  includes `state: 'accepted'` rows with `updated_at` within 24h. UI consumers
  filter `state === 'pending'` (`ContactsPage.vue:289`) and are unaffected;
  the SW's existing accepted/rejected note builder becomes live.

## Notification surfaces (composed on-device, not persisted)

| Surface | Copy shape | Tag / target |
|---|---|---|
| Named ring | "📹/🎙️ \<Name\> is calling you" · group "\<Name\> is calling in \<Group\>" | `ring-call`, `/tabs/chats` |
| Generic ring (fallback: locked, unresolvable, hidden chat) | today's "Incoming call / Tap to answer" | `ring-call` |
| Missed replacement | "☎️ Missed call from \<Name\>" (generic "Missed call" when unresolvable/hidden) | `ring-call` (replaces), deep-link chat else `/tabs/calls` |
| Friend-request accepted | "\<Name\> · accepted your friend request" (existing builder) | `ring:conn:acc:<id>` |
| Conn fallback placeholder | neutral "Contact updates / Tap to review" (was "New friend request") | `ring:conn:req`, `/tabs/contacts` |
