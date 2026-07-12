# Research: Incoming call & friend-request notifications (spec 1040)

All unknowns were resolvable from the codebase. The load-bearing decisions:

## R1 — Identity transport: a sealed `callEvent` marker over the existing pairwise ratchet

- **Decision**: the caller (or group-call initiator) sends a small sealed system
  frame — a new optional `callEvent` field on `MessagePayload`
  (`src/services/crypto/message.ts:268`) — through the existing 1:1 Double
  Ratchet channel to the callee, alongside the live call signalling. Two phases:
  `ring` (sent at dial time: `callId`, `kind`, optional `roomId`) and `ended`
  (sent at outcome time: `outcome: 'missed' | 'cancelled' | 'answered'`). For a
  group call the initiator sends the same pairwise marker to each invitee
  (bounded by group size — the server already sends per-member invites).
- **Rationale**: the 1:1 call offer itself is never queued on the relay ("the
  tickle is the signal", `src/sw.ts:717`), so the SW cannot fetch it. But
  `callEvent` markers land in `GET /v1/relay/pending`, which the SW already
  fetches and decrypts read-only (`previewPending` → `previewPacket`,
  `sw-inbox.ts:722-868`) — the exact machinery rich message previews use. The
  push payload stays a content-free tickle; identity crosses only E2EE.
- **Alternatives considered**: putting a caller id in the push tickle (leaks
  social graph to APNs/FCC — violates FR-003, rejected); server-buffered
  offer exposed over HTTP for the SW (new server surface, still undecryptable
  while locked, and duplicates relay retention); sender-key group markers
  (SW preview only walks the pairwise ratchet — pairwise markers keep the SW
  path uniform).

## R2 — Ring notification: preview the marker, fall back generic, upgrade on re-ring

- **Decision**: on a `{"t":"call"}` wake, the SW (after the existing
  nudge/ack) runs a bounded pending-preview looking for a fresh (`ring`-phase,
  < ring-window old) `callEvent`; if decryptable it shows
  "📹/🎙️ <Name> is calling you" (group: "… is calling in <Group>") under the
  existing `tag: 'ring-call'`; otherwise today's generic ring. Reminder pushes
  (1:1 re-pushes up to 6× every 10s — `hub.go:210-211,346-364`; group
  `hub.go:556-572`) re-run the preview, so a marker that raced behind the first
  tickle upgrades the same notification in place (`renotify` behavior kept).
- **Rationale**: FR-004 (never delay the first alert) plus the reminder cadence
  gives a free upgrade path. PIN-locked devices (`attemptDeviceUnlock` fails →
  `reason: 'locked'`, `sw-inbox.ts:776-786`) simply stay generic.
- **Alternatives considered**: blocking the ring on decrypt (violates FR-004);
  a separate identity endpoint (new plaintext surface, rejected).

## R3 — Missed-call trace: outcome markers are primary, stale-ring reconciliation is the net

- **Decision**: `receiveIncomingInner` (`src/db/queries.ts:5566-5728`) gains a
  `callEvent` branch following the established silent-side-effect pattern
  (reaction/gameMove/etc.): `ring` records a pending call event; `ended` with
  `outcome: 'missed'` creates the missed `calls` row (`createCall`-shaped,
  keyed by `callId` → natural dedup, FR-018) and the in-chat `kind: 'call'`
  row via `logCallToChat`; `cancelled` does the same (caller hung up before
  answer = missed per clarification); `answered` (answered on another device
  or this one) just clears the pending event. A pending `ring` older than the
  ring window with no outcome marker and no existing `calls` row for that
  `callId` reconciles to missed on next processing (caller crashed mid-ring).
  Existing live-ring logging is untouched; the marker branch never overwrites
  an existing record for the same `callId`.
- **Rationale**: the caller is online at dial time by definition, so the
  dial-time `ring` marker is durably queued even if the caller dies later —
  that makes SC-004's "100% trace" reachable. The outcome marker settles
  accuracy (answered-elsewhere never logs missed, FR-016).
- **Alternatives considered**: SW-side tickle ledger only (no identity → no
  chat placement, breaks FR-014); server-recorded missed calls (server must
  not know outcomes' meaning — rejected on Principle I).

## R4 — Missed-call notification: the outcome marker's own push is the wake

- **Decision**: no new push type. The caller's `ended` marker arrives as a
  normal `{"t":"msg"}` tickle; the SW preview recognizes `callEvent` in
  `noteForPayload` (`sw-inbox.ts:341-349` pattern) and, for `missed`/
  `cancelled`, shows "☎️ Missed call from <Name>" reusing the `ring-call` tag
  (which REPLACES the stale incoming-call alert — FR-012/FR-012a), deep-linking
  to the 1:1/group chat (or `/tabs/calls`). For `answered` it closes the
  `ring-call` notification and ends the wake with the established quiet
  terminal (`showQuietUnlessVisible`, `sw.ts:232-241`) so the iOS
  visible-ending rule (three-strike zombie revocation, `sw-inbox.ts:495-506`)
  is never violated.
- **Rationale**: the marker is both the data and the wake — one mechanism, no
  server change for calls at all. Message-tickle debounce delays it by at most
  the debounce window, well inside SC-006's ring-window bound.
- **Alternatives considered**: a server `call-end` push (the server does know
  ring end — `hub.go:1484-1510` — but a new tickle type is more surface for
  zero gain); leaving the stale ring until user interaction (rejected in
  clarification).

## R5 — Badge: per-call units in SW-shared storage, cleared by the page on open

- **Decision**: a `sw.callBadge` entry in the idb `settings` store (already
  the SW↔page shared channel: `badge.lastCount`, `swShownSummary`) holds a
  small list of `{callId?, ts, state: 'ringing' | 'missed'}` units. The SW
  badge total (`updateAppBadge`, `sw.ts:326-342`) adds `units.length`. First
  call tickle for an unknown call appends one `ringing` unit (identified by
  marker `callId` when decryptable, else a ring-window heuristic — a call
  tickle while a `ringing` unit is fresh joins it, FR-007/FR-008); the
  missed outcome flips the SAME unit to `missed` (FR-010, no double count).
  On page open/foreground, the page clears all units (`useAppBadge`'s existing
  foreground hook) — ringing units simply vanish (FR-009); missed ones are by
  then represented in the `calls` store, which the page badge already counts
  (`countMissedUnseen`, `useBadges.ts:39`).
- **Rationale**: reuses the existing split (SW approximates while closed, page
  is authoritative on open — `sw.ts:321-334`) and the existing foreground
  clearing hooks (`useAppBadge.ts:16-28`). The heuristic degrades exactly to
  the spec's stated platform-degradation assumption.
- **Alternatives considered**: teaching the SW to read/write the `calls`
  store (write path belongs to `queries.ts`/drain — spec 1032's single-writer
  invariants say don't); server-counted badges (server can't know, Principle I).

## R6 — Stop-on-open: existing server foreground suppression + page notification sweep

- **Decision**: no new suppression mechanism. The server already skips pushes
  once the device is foregrounded and socket-fresh (`isActiveFresh` gates in
  both ring loops, `hub.go:353`, `hub.go:568`) and stops ringing on
  answer/decline (`stopCallRing`, `hub.go:1484-1487`). The page already closes
  ALL notifications on foreground (`useAppBadge.ts:16-17`), which sweeps
  `ring-call`. The only addition: the foreground hook also clears
  `sw.callBadge` ringing units (R5) so the badge drops with the notification.
- **Rationale**: FR-011's behavior is 90% shipped; discovering that avoided a
  redundant client-suppression layer.
- **Alternatives considered**: SW-side "page is open" gating (already exists
  as `pageWillNotify`/`ring:drain` hand-off, `sw.ts:690-704` — nothing to add).

## R7 — Friend-request accepted: return recent accepted rows; ledger stays the dedup

- **Decision**: `Store.OutgoingRequests`
  (`server/internal/store/connections.go:149-153`) adds
  `OR (state = 'accepted' AND updated_at > now() - interval '24 hours')`. The
  SW already renders accepted outgoing rows ("accepted your friend request",
  `sw-inbox.ts:1020`) and dedups via the 48h `swNotifiedIds`-style conn ledger
  (`CONN_SHOWN`, TTL 48h) — a 24h server visibility window inside the 48h
  ledger TTL guarantees at-most-once announcement (FR-022) with zero client
  reconcile changes.
- **Rationale**: the accept branch on the client is dead code today only
  because the server never returns accepted rows; the minimal, windowed server
  change revives it without unbounded response growth and without re-announce
  loops after ledger expiry. `ContactsPage.vue:289` filters
  `state === 'pending'`, so the UI list is unaffected.
- **Alternatives considered**: unwindowed `IN ('pending','rejected','accepted')`
  (response grows with every friendship forever, and rows re-announce every
  ledger-TTL); a new push payload type for accepts (more surface; the conn
  tickle + reconcile pattern already exists).

## R8 — Neutral fallback copy + hidden-chat guard

- **Decision**: the unconditional placeholder at `sw.ts:476` changes from
  "New friend request / Tap to review" to neutral copy ("Contact updates" /
  "Tap to review" — matching the warm plain UI voice, no em-dashes), keeping
  tag/url. For calls, every named note (ring and missed) passes the same
  hidden-chat gate the message previews use: a hidden peer/group renders the
  generic variant, and missed-call rows stay excluded from Calls tab and badges
  by the existing `hiddenCallKeys` consumers (`queries.ts:2606`, `4851`).
- **Rationale**: FR-021 (the fallback must not misstate the event) and
  FR-005/FR-017 (hidden chats leak nothing, exclusions still hold).
- **Alternatives considered**: guessing the event type in the fallback
  (exactly the reported bug); skipping the placeholder (violates the iOS
  visible-ending contract).
