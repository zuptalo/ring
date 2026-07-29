# Zero-Knowledge Checklist: spec 2058

**Purpose**: Constitution Principle I is non-negotiable and gate sequencing requires this checklist
for any spec touching it. Run before `/speckit-implement` and re-confirm before merge.
**Created**: 2026-07-29
**Feature**: [spec.md](../spec.md) · [Zero-Knowledge Impact section](../spec.md)

## What crosses the wire

- [x] The change adds **no** new field to any sealed payload — verified: no edit to
      `src/services/crypto/message.ts` or the `MediaRef` shape is planned.
- [x] The change adds **no** new endpoint, and no new parameter on an existing one — the fetch
      reuses `receiveIncomingMedia` unmodified.
- [x] The change adds **no** new identifier visible to the server. The blob id used was already
      inside the sealed message and already fetched on the success path.
- [x] Nothing that was previously encrypted becomes plaintext.

## What the server can observe

- [x] **No new observable is introduced.** The server already sees that some authenticated device
      fetched some blob id at some time — inherent to relaying the bytes at all.
- [x] **Timing delta acknowledged and bounded.** A fetch that previously never happened (the
      stranded case) now happens. This reveals nothing the ordinary success path would not have
      revealed moments earlier, and the FR-006 attempt cap (3 per message per session) stops a
      permanently-failing message from emitting an unbounded repeating fetch pattern at the relay.
- [x] No log line, metric, error payload, or debug aid added by this change carries user content.

## New state

- [x] `dlFailedAt` is written to the **device's** IndexedDB only.
- [x] It is **not** included in own-data sync — **verified by citation, not assumption**:
      `src/services/ownsync.ts:28` declares `const SYNCED: StoreName[] = ['contacts', 'chats',
      'chatlists']`, and `pushSyncRecords` has a single caller (`:153`) that never touches the
      `messages` store. No `Message` field can ride own-data sync under any implementation.
- [x] The auto-retry counter never persists at all (in-memory, session-scoped).
- [x] Neither is derived from, or reported to, anything server-side.

## Crypto surface

- [x] No change to X3DH, the Double Ratchet, sender keys, or libsodium usage.
- [x] No new key material, no change to at-rest wrapping (Argon2id/PIN).
- [x] No hand-rolled primitive introduced.

## Server surface

- [x] No Go change, no handler change, no SQL migration.
- [x] No change to `SECRETS_KEY` handling or anything encrypted at rest server-side.

## Sign-off

- [x] All boxes above checked, each against source rather than assumption.
- [x] No open items. The one item originally flagged for investigation (whether own-data sync could
      pick up a new `Message` field implicitly) was closed by reading `ownsync.ts`: the `messages`
      store is not in the synced set at all, so the risk does not exist.

**Verdict**: Principle I is preserved. This change is receive-side rendering plus a local recovery
trigger; the only behavioral delta the server could observe is that a fetch which previously never
happened now happens, over the existing path with the existing capability id, bounded by the
FR-006 attempt cap.
