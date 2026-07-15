# Feature Specification: Recovered Devices Rebuild Their Friends Ledger

**Feature Branch**: `fix/2040-recovered-devices-rebuild`

**Created**: 2026-07-15

**Status**: in-progress
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped. -->

**Input**: User bug report (2026-07-15): after removing the app and logging back
in with the recovery key, contacts and chat placeholders restore — but the
Close Friends screen is empty and offers no contacts to pick.

## Diagnosis

`listFriends()` (the source for Close Friends AND every Wall-post audience)
filters contacts through the local `connectedPeers` settings ledger, which is
written ONLY by live accept/connect events and is neither own-synced nor
rehydrated. A recovered install therefore has restored contacts but an empty
friends ledger: the Close Friends picker is blank, and — silently worse —
Wall posts from that device fan out to an EMPTY audience. The server has the
authoritative accepted-connection graph but exposes no way to list it.

## Requirements

- **FR-001**: The connections API MUST let a client list its ACCEPTED peer ids
  (`GET /v1/connections?include=friends` adds a `friends: [userId]` field —
  metadata the server already owns; no new knowledge).
- **FR-002**: The client MUST reconcile the local ledger from that list inside
  the existing `refreshConnections()` flow (boot + reconnect + connect events):
  additive marking of every accepted peer — idempotent, heals EVERY previously
  recovered install, not just fresh recoveries.
- **FR-003**: Restored contact rows keep their `closeFriend` flags (already the
  case via own-sync) so the close list reappears once the ledger heals.

## Zero-Knowledge Impact

None — the accepted-connection graph is metadata the server already stores and
enforces (post audience checks); returning it to its own account adds nothing.

## Success Criteria

- **SC-001**: Go handler/store tests pin `include=friends` returning accepted
  peers (both directions) and nothing else.
- **SC-002**: Client unit test: reconcile marks all listed peers connected.
- **SC-003**: The reporter's recovered phone shows friends + close friends
  after one app start on the fixed build.
