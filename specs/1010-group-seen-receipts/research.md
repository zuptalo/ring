# Phase 0 Research: Group "Seen" Receipts

Decisions + rationale + rejected alternatives, grounded in the existing Ring
receipt/delivery machinery. No `NEEDS CLARIFICATION` remain (the spec's
Clarifications resolved the open product choices).

## D1 — Durable seen mirrors the delivered store (don't invent a new shape)

- **Decision**: Add a server `seen` table mirroring `deliveries`:
  `(sender, recipient, msg_id, seen_at)`, PK `(sender, recipient, msg_id)`,
  upsert idempotently (`ON CONFLICT DO NOTHING`). Record on the relay of a
  client-originated `seen` receipt (in `hub.go`'s `receipt` case, alongside the
  existing live relay), the way `ack` already calls `RecordDelivery`. Expose via
  `POST /v1/seen/check` (mirror `deliveriesCheck`) returning one entry per member;
  client reconciles on reconnect (mirror `reconcileDeliveries`, replaying
  synthetic `{t:'receipt', status:'seen', from:recipient}`).
- **Rationale**: Delivered is already durable + reconciled this exact way; seen
  is the symmetric gap. Reusing the pattern means **no new metadata class** (same
  `(sender, recipient, msg_id, when)` shape) and minimal new surface.
- **Alternatives rejected**: Keep seen live-only (status quo — lossy when the
  sender is offline); a generic "receipts" table replacing deliveries (needless
  churn to a shipped, working store).

## D2 — Retention mirrors `deliveries`

- **Decision**: The `seen` table uses the **same retention/cleanup** policy as
  `deliveries` (clarified). No bespoke retention.
- **Rationale**: Consistency, an already-accepted ZK posture, least new policy.
- **Alternatives rejected**: Prune on first sender fetch (breaks a second sender
  device reconciling); keep indefinitely (weakest minimization).

## D3 — Rename `read → seen`: hard cutover

- **Decision**: Rename end-to-end (UI label, `MessageStatus` value, `ReceiptStatus`,
  `STATUS_ORDER`, scalar `readAt→seenAt`, `Receipt.readAt→seenAt`, reducers,
  send/apply paths, the `.tick.read` class, message-info copy, and the wire status
  string). The server `receipt` case accepts `'seen'|'downloaded'` (was
  `'read'|'downloaded'`). `'downloaded'` is unchanged (separate media-cleanup
  signal).
- **Rationale**: "Seen" generalizes to voice/video/photo; one consistent term
  avoids future confusion (the user's explicit reason).
- **Accepted tradeoff (skew)**: a stale (un-refreshed) PWA still emitting/expecting
  `'read'` has its seen receipts dropped by the updated server until it refreshes —
  transient, seen-tier-only; delivered + messaging unaffected; self-heals on PWA
  update. Hard cutover chosen over an accept-both shim for code clarity.

## D4 — Client migration: forward-only, in `onupgradeneeded`

- **Decision**: `DB_VERSION 5 → 6`. The v6 step opens a cursor over the `messages`
  store and rewrites each row: `status 'read'→'seen'`, `readAt→seenAt`, and each
  `receipts[].readAt→seenAt`. Preserve all other fields and timestamps; never
  regress status.
- **Rationale**: Principle V — upgrades must not lose data. `receipts[]` is an
  embedded array on the row, so this is a pure document transform (no new store).
- **Alternatives rejected**: Lazy per-read migration (leaves mixed `read`/`seen`
  in storage — confusing, and the counter/reducers would need to handle both);
  dropping old status (data loss).

## D5 — No server data migration for the rename

- **Decision**: The server needs **no data migration** for the rename — `read`
  was never persisted (the `deliveries` table stores timestamps, not a status
  string; receipt frames are relay-only). Only the `hub.go` check string flips,
  and the new `seen` table is greenfield (`seen` from the start).
- **Rationale**: Confirmed in the investigation — there is no stored `read` value
  server-side to migrate.

## D6 — Privacy gate: client-side suppression + reciprocity (mirror 1009)

- **Decision**: Repurpose the inert `privacy.readReceipts` → `privacy.seenReceipts`
  ("Seen receipts", default on, uniform 1:1 + groups; drop the always-for-groups
  footer). Two client gates, mirroring 1009's `applyActivityPref` /
  `setActivityIndicatorsEnabled`: (a) **emit gate** — `sendSeenReceipts` is a
  no-op when off (so nothing is sent → the durable store never holds it →
  recipient stays counted as delivered); (b) **reciprocity display gate** — when
  off, the client does not render/aggregate the seen tier on the user's own sent
  messages. Read the pref on start + on settings change.
- **Rationale**: ZK minimization — the server never learns the preference; you
  can't leak what you don't send; the store gate is upstream. Symmetric with read
  receipts' intended semantics and with 1009.
- **Alternatives rejected**: Server-side withhold (server must learn + act on the
  preference = new metadata + policy — violates Principle I); one-directional gate
  (asymmetric, surprising).
- **Note**: renaming the key `privacy.readReceipts → privacy.seenReceipts` has no
  behavioral regression because the old key was **never consulted** (inert);
  unset → default on.

## D7 — Counter semantics: complete-the-tier over recipients, derived

- **Decision**: N = recipient members (sender excluded). Derive from `receipts[]`:
  `delivered = count(deliveredAt)`, `seen = count(seenAt)`. Display: 0 delivered →
  Sent; `1 ≤ delivered < N` → "Delivered X/N"; all delivered, `1 ≤ seen < N` →
  "Seen X/N"; all seen → plain "Seen". Show the fraction **only while a tier is
  partial** — so an N=1 group never shows a fraction (renders like 1:1), with no
  special-casing and no minimum group size. A message may rest permanently at
  "Seen X/N" (X<N) — intended (privacy: not-opened vs opted-out are
  indistinguishable).
- **Rationale**: Matches the clarified product decision and reads as live
  progress; derivation is free from the existing roster.
- **Alternatives rejected**: Leading-edge (advance on the furthest any member
  reached — can look further along than reality); all-or-nothing (current — hides
  progress).

## D8 — Counter render: compact on the bubble, detail in message info

- **Decision**: Render the state icon + "X/N" inline in the bubble's existing
  status slot (`ChatDetailPage.vue`, group-only, partial-only); 1:1 unchanged.
  The per-member avatar detail (Seen by / Delivered / **Not yet delivered**) lives
  in `MessageInfoPage.vue` (avatar stack cap ~5 + "+N"). Not-yet-delivered =
  `chat.participantIds` minus members with `deliveredAt`, reusing the existing
  `contactMap` / `nameFor` / `avatarFor` / `initialsAvatar`.
- **Rationale**: The bubble bottom row is tiny; a compact fraction fits, the rich
  view reuses the already-built info page.
- **Alternatives rejected**: Avatar stack on the bubble (space/RTL/perf fragile on
  narrow bubbles — kept to the info page).

## Resolved unknowns

None outstanding. The crypto core is untouched (seen is plaintext status metadata,
like delivered). The only durable additions are the `seen` table (server) and the
`DB_VERSION 5→6` transform (client), both forward-only.
