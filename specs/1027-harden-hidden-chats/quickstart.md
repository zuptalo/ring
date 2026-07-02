# Quickstart: 1027 Harden Hidden Chats — implementation slices

**Plan**: [plan.md](./plan.md) | Ordered so each slice is independently landable
and tests come first inside every slice (Red → Green).

## Slice 0 — Hygiene (tiny, unblocks tooling)

Replace the raw NUL byte in `src/db/queries.ts` L3703 with the `\u0000` escape
(same runtime string → SHA-256 contact-card hashes unchanged; add a unit test
pinning the hash of a known input before flipping). After this, `grep`/`rg` treat
the file as text again.

## Slice 1 — The invariant core (`hidden-pair.ts`)

1. Write `src/services/hidden-pair.test.ts` first: `chatsWithPeer`, `canHide`,
   `canUnhide`, `resolveInboundDirectChat` across: no chats, only visible, only
   hidden, both (pair combinations), multi-member groups excluded, the legacy
   hidden+visible plain-1:1 state.
2. Implement the pure module. No idb imports.

## Slice 2 — Inbound routing rule R (fixes B1) — the heart

1. Failing vitest: fake-idb harness where the sole 1:1 is hidden; an inbound
   frame must land in the hidden chat, create no new row, and request no rekey.
2. Failing e2e (`e2e/hidden-coexist.spec.ts`): A hides the chat with B; B sends;
   A's chat list stays empty, reveal shows the message in the hidden thread.
3. Implement: `receiveIncomingInner` uses `resolveInboundDirectChat` (+ peer
   block check + fail-closed requeue) instead of blind `startDirectChat`.
4. `startDirectChat`: hidden plain 1:1 exists → create the visible **pair
   conversation** (reuse the `createGroup('', [peer])` path from
   `hidden-chats-start.ts`); also `clearTombstone('hiddenPeer:…')`.
5. e2e continues: A starts a new chat with B from Contacts → fresh visible
   thread; both threads exchange messages with zero cross-contamination; Hide on
   the visible thread is blocked with the reason; delete visible → Unhide works.

## Slice 3 — Hide/Unhide gating in the UI (fixes B2)

1. Failing e2e: Hide blocked when hidden exists; Unhide blocked when visible
   exists (reason copy asserted).
2. `ChatActionsSheet.vue` consults `canHide`/`canUnhide` (disabled + reason).

## Slice 4 — Reset block on the relay path (fixes B3)

1. Failing e2e (`e2e/hidden-reset.spec.ts`): hide → reset → B sends live → no
   chat appears, no notification, no rekey; A explicitly starts a chat with B →
   works (block lifted).
2. `resetHiddenChats` writes `hiddenPeer:` localOnly tombstones (before deletes);
   rule R step 4 acks + drops; `ensureGroupChat`/`handleGroupCard` consult
   group-id tombstones.

## Slice 5 — Badge correctness (fixes B4)

1. Failing vitest: `countUnread` across all three modes × (set known / unknown),
   asserting visible counts survive the unknown window; SW `unreadCount` same
   matrix + unclassifiable pending frames not counted; `'revealed'` ≡ `'never'`
   in the SW.
2. Implement `badge.lastCount` (page persist + both fallbacks + own-sync
   exclusion).
3. e2e: badge assertions folded into `hidden-privacy.spec.ts` (modes `always` /
   `never`), cold-open badge correct from first frame.

## Slice 6 — Relock kick-out + route guard (fixes B5)

1. Failing e2e: reveal → open hidden chat → force relock (test hook / grace
   `immediately` + background-foreground) → app is on `/tabs/chats`; deep-link
   `/chat/<hiddenId>` while relocked → redirected.
2. `registerRelockHook` in `hidden-state.ts`; router registers the hook + the
   `beforeEach` guard.

## Slice 7 — Notification silence + SW generic pinning (fixes B6, pins FR-012)

1. Failing vitest: notify path backgrounded-but-connected hidden message →
   no local notification; SW `noteForPayload` hidden note byte-equals the
   previews-off generic and precedes mention/mute/content branches.
2. Remove the `notify.ts` L389 bridge.
3. drive scenario `hidden-notify.mjs` updated for the new silent expectation.

## Slice 8 — Knock-knock call e2e (pins FR-013/FR-014)

New `e2e/hidden-call.spec.ts` (2-person call per CI constraints): B calls A whose
chat with B is hidden → incoming overlay shows B's name/avatar, answerable; after
hangup, Calls tab shows no entry for B while relocked; reveal shows it.

## Slice 9 — Cold-open no-flash (pins FR-017)

e2e: seed hidden chats, cold-start, assert no hidden row ever paints (poll from
first frame) while visible chats + badge are correct immediately (regression net
over the existing `hidden-flash.mjs` drive scenario).

## Slice 10 — Cleanups + docs

Biometric dangling references neutralized (R9); doc comments updated
(`hidden-chats.ts`, 1019 cross-reference note); `make roadmap`; drive scenarios
`hidden-coexist.mjs`, `hidden-reset-relay.mjs`, `hidden-kickout.mjs`.

## Gates before PR

```sh
npm run build            # vue-tsc + vite
npx vitest run           # unit + coverage floors
npm run test:e2e         # Playwright (needs make db-up)
cd server && go build ./... && go vet ./... && go test ./...   # untouched but verified
```

`/speckit-checklist` (crypto/ZK — required) must be generated and satisfied;
security review requested on the PR (constitution IV).
