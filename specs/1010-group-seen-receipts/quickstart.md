# Quickstart: Group "Seen" Receipts

How to exercise and verify, mapped to the Success Criteria (SC).

## Run locally

```sh
make start          # PostgreSQL + ringd + Vite at http://localhost:5173
```

Register three test accounts (dev invite codes), connect them, and create a group
with all three.

## Manual smoke (per SC)

- **SC-001 (counter climbs)**: Account A sends to the group. As B and C's devices
  receive it, A's bubble shows "Delivered 1/2" → "2/2"; as B and C open the chat,
  it shows "Seen 1/2" → then the plain "Seen" tick. (N = recipients = 2.)
- **SC-002 (durable)**: Take A offline; have B open the message; bring A back
  online → after reconnect the message reflects B as seen (reconciled from the
  server `seen` store, not lost).
- **SC-003 (reciprocity)**: In Settings → Privacy, turn **Seen receipts** off on
  A. Now A opening others' messages never advances A's seen for anyone, AND A's
  own sent messages show no seen tier (cap at delivered). B and C (on) still see
  each other.
- **SC-004 (info lists)**: Open a group message's info → every member appears under
  exactly one of **Seen by / Delivered / Not yet delivered**.
- **SC-005 (rename migration)**: Upgrade from a build that had `read` messages →
  they display as **Seen** with original timestamps, no status regression.
- **SC-006 (1:1 unchanged)**: A 1:1 message shows the plain tick, no fraction.

## Automated checks

- **Server** (`go test ./...`, in-memory fake store):
  - `store/seen.go`: `RecordSeen` idempotent; `SeenFor` returns one row per member.
  - `ws/seen_test.go`: a client `seen` receipt is relayed (from-stamped) AND
    recorded; `read`/`sent`/`delivered` from a client are dropped; `downloaded`
    relays but isn't recorded.
  - `api`: `POST /v1/seen/check` returns per-member entries.
- **Client unit** (`vitest`): the status reducers under the rename; the group
  progress derivation (complete-the-tier, N=recipients, partial-only); the
  `DB_VERSION 5→6` migration transform (read→seen, readAt→seenAt,
  receipts[].readAt→seenAt) preserves data.
- **e2e** (`e2e/group-seen-receipts.spec.ts`, multi-account):
  ```sh
  make db-up && npm run test:e2e
  ```
  Counter climb (SC-001), offline durability (SC-002), toggle reciprocity both
  directions (SC-003), not-yet-delivered list (SC-004).

## Definition of done (gates)

```sh
npm run build                 # vue-tsc + vite
cd server && go build ./... && go vet ./... && go test ./...
npm run test:e2e
```

All green = done (Constitution VII). A `/speckit-checklist` (Principles I, V, VI)
must also be completed clean before `/speckit-implement`.
