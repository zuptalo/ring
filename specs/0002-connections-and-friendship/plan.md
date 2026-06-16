# Implementation Plan: Connections & Friendship (0002)

**Branch**: `feat/0002-connections-and-friendship` | **Date**: 2026-06-16 | **Spec**: [spec.md](./spec.md)

## Summary

Make the friendship model coherent on top of the EXISTING server `connections`
table (pending/accepted/rejected + `created_at`/`updated_at`): the directory shows
only not-yet-connected people, the single action is **Request Friendship**, one
**Friend Requests** section shows incoming + outgoing with timestamps, accepted
people are **Friends**, outgoing requests can be **withdrawn** server-side
(retracting from the other inbox), and incoming requests **badge** the Contacts tab
+ app icon until answered.

## Clarifications (resolved by judgment — no user prompt)

- **C1 — Source of truth**: the server `connections` store is authoritative for
  friend requests + friendship. The client connections store (GET /v1/connections →
  `incoming`/`outgoing` with `updatedMs`) drives the Friend Requests UI; **Friends**
  = accepted connections. Legacy local `FriendRequest` records are kept ONLY for the
  accept→(create contact + 1:1 chat) mechanics and for **group invites**
  (`kind:'group-invite'`), and are reconciled so a friend request never shows twice.
- **C2 — Cancel = server withdraw**: add `POST /v1/connections/withdraw {target}`.
  The requester's pending `requester→target` row is removed; the target is notified
  via the existing `connect-update` frame with `state:"withdrawn"`. This makes cancel
  authoritative and offline-safe (the target reconciles via GET /v1/connections even
  if it was offline at cancel time) — replacing today's best-effort peer "cancel" card
  (kept only as a fast-path UI hint). No DB migration (delete of an existing row).
- **C3 — Directory stops auto-connecting**: directory **browse** no longer imports
  members as contacts or marks them connected. Browse fetches directory users and
  **filters out** anyone with an accepted OR pending (either-direction) connection,
  using the connections state map. Import/connect happens only on Request Friendship
  / Accept. `refreshContactProfiles` (profile refresh for EXISTING contacts) stays.
- **C4 — Contacts sections consolidated**: replace the overlapping sections
  (Connection requests / Sent / Requests / Requested) with one **Friend Requests**
  (incoming: Accept/Decline; outgoing: Cancel; each with a timestamp) sourced from the
  connections store, plus a **Friends** section (accepted). Group **Invitations**
  (group invites) and **Invited** (invite codes) stay as separate existing sections.
- **C5 — Timestamps**: `ConnItem` carries `updatedMs`; the UI renders a relative time
  via the existing time util.
- **C6 — Badges**: `countPendingRequests` includes incoming **connection** requests
  (deduped against local `FriendRequest` records), so the Contacts-tab + app-icon
  badges (via `useBadges`) reflect incoming friend requests and persist until
  accept/decline (the request row persists until then).

## Technical Context

**Stack**: Go stdlib server (`internal/store`, `internal/api`) + PG `connections`
table; Vue 3 + Ionic client (`services/connections.ts`, `services/directory.ts`,
`db/queries.ts`, `views/detail/DirectoryPage.vue`, `views/tabs/ContactsPage.vue`,
`composables/useBadges.ts`). **No DB migration** (states + timestamps already exist).

**Testing**: server handler tests vs the in-memory fake store (withdraw); client
unit tests for reconciliation/filtering helpers; e2e across two accounts (directory
hides connected/pending, request→accept→Friends, cancel retracts the other side,
badge).

## Constitution Check

- **I. Zero-Knowledge / IX. Privacy** — PASS: the connection graph + request states
  already live server-side (the consent gate). Withdraw deletes a row the server
  already holds; surfaces existing timestamps. No new user content/plaintext or
  server-visible metadata beyond what a consent gate inherently needs.
- **III. TDD** — server withdraw handler test first; client reconciliation/filter
  unit tests; e2e for the flows.
- **V. Offline-First / VI. Stateless+Forward-only** — no object-store/`DB_VERSION`
  change client-side; no SQL migration server-side (reuse `connections`). Handlers
  stay stdlib + fake-store-tested.
- **X / XI. Ionic-first** — Contacts/directory UI uses stock Ionic components +
  existing theme tokens; no bespoke widgets.

Gate: PASS (no migration, no new server-visible metadata, consent model preserved).

## Approach (phased)

1. **Server withdraw** (contained, TDD): `Store.WithdrawConnection(requester,target)`
   (delete pending row), `POST /v1/connections/withdraw`, notify target
   `connect-update{state:"withdrawn"}`; handler test vs fake store.
2. **Client connections store**: add `withdraw(userId)`; carry `updatedMs`; map
   states for directory filtering + Friends/Requests.
3. **Directory**: stop auto-import/auto-connect on browse; filter out
   accepted+pending (either direction); DirectoryPage action = "Request Friendship"
   only (drop "Save to contacts").
4. **Contacts UI**: one Friend Requests section (incoming+outgoing+timestamps) +
   Friends section; reconcile with legacy records; keep group invites + invite codes.
5. **Badges**: `countPendingRequests` counts incoming connection requests (deduped).
6. **Tests**: unit (reconcile/filter/withdraw) + e2e (two-account flows).

## Project Structure

```text
server/internal/store/connections.go        # + WithdrawConnection
server/internal/api/connections_handlers.go  # + POST /v1/connections/withdraw (+ _test.go)
server/internal/api/router.go                # route
src/services/connections.ts                  # + withdraw, updatedMs, state map
src/services/directory.ts                    # browse: no auto-import; filter connected/pending
src/views/detail/DirectoryPage.vue           # action: Request Friendship only
src/views/tabs/ContactsPage.vue              # Friend Requests + Friends sections
src/db/queries.ts                            # countPendingRequests incl. incoming conns; reconcile
src/composables/useBadges.ts                 # (verify) contacts badge reflects incoming conns
e2e/connect.spec.ts / directory.spec.ts      # extend for the new flows
```

## Complexity Tracking

No constitution violations. The one real risk is the consent-gate refactor (dual
request representation); mitigated by keeping the server `connections` store
authoritative, reconciling (not rewriting) the local records, and covering the gate
with two-account e2e before merge.
