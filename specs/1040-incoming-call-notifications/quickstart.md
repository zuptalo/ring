# Quickstart: Incoming call & friend-request notifications (spec 1040)

## Where the logic lives

- `src/services/call-events.ts` — NEW pure module: marker shapes, reconcile
  decisions, badge-unit transitions. Start here; it is vitest-covered and has
  no IndexedDB/SW dependency.
- `src/composables/useCall.ts` — marker send sites (dial, no-answer timeout,
  cancel, answer). Search `callEvent`.
- `src/db/queries.ts` — `receiveIncomingInner`'s `callEvent` branch (silent
  side-effect pattern, like `reaction`) + stale-ring reconciliation.
- `src/services/sw-inbox.ts` / `src/sw.ts` — SW side: named ring preview,
  missed replacement (tag `ring-call`), `sw.callBadge` units, neutral conn
  placeholder.
- `server/internal/store/connections.go` — the one server change
  (accepted-within-24h in `OutgoingRequests`).

## Fast verification loop

```sh
npx vitest run src/services/call-events.test.ts src/services/sw-inbox.calls.test.ts
cd server && go test ./internal/api/ ./internal/store/...   # connections change
npm run build                                               # typecheck gate
```

## Seeing it on a device (dev stack)

1. `make start`, install the PWA from a phone pointed at the dev host, allow
   notifications, then CLOSE the app.
2. From a second account (browser profile), call the phone's account —
   lock screen should show "📹 <Name> is calling you", badge +1, re-rings do
   not increase it.
3. Let it ring out — notification becomes "☎️ Missed call from <Name>";
   opening it lands in the 1:1 chat with the missed-call row; Calls tab shows
   the entry; badge unit persists until the calls list is viewed.
4. Open the app mid-ring instead — notification and the +1 vanish, in-app
   ring takes over.
5. Friend accept: send a request from the phone account to a third account,
   close the app, accept on the third account → phone shows
   "<Name> · accepted your friend request" (never "New friend request").

Multi-user drive scenarios (`drive/`) cover the data-layer effects (missed
rows, dedup against live logging); SW push visuals need the real device pass
above.

## Gotchas

- SW preview is READ-ONLY (spec 1032): never persist or ack from the preview
  path; the page/drain owns writes.
- Every SW wake must end visibly on iOS (three-strike revocation): the
  `answered` marker path closes the ring notification and must still end via
  the quiet terminal.
- Marker processing is idempotent by `callId`; an existing `calls` row always
  wins.
- Hidden chats: gate BEFORE naming anything; fail closed to generic copy.
- Copy voice: warm, plain, "you"; no em-dashes or semicolons in user copy.
