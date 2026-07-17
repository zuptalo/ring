# Quickstart: Messages store on push so the app opens warm (spec 1032)

## Run it locally

```sh
make start                 # Postgres + ringd (:8080) + Vite (:5173)
```

Create two dev accounts (invite codes `RINGDEV1`..`RINGDEV9`), pair them, then on the
receiving account's browser console enable the flag:

```js
await window.__ringTest.setSetting('sw.fullPersist', true)
```

Simulate the closed-app path (the e2e/testhook drives the same code):

```js
await window.__ringTest.disconnect()        // drop the WS (app "closed")
// ...send messages from the other account...
await window.__ringTest.drainPending()      // the SW-drain path: decrypt → commit → ack
```

Verify warm state BEFORE reconnecting: the chat row shows the new preview + unread count,
the messages exist in IndexedDB (DevTools → Application → IndexedDB → messages), and
`GET /v1/relay/pending` returns no frames. Then `window.__ringTest.reconnect()` and confirm
no duplicates and unchanged unread.

## Fast automated checks

```sh
npx vitest run src/services/sw-drain.test.ts src/services/cross-lock.test.ts
npx vitest run src/services/crypto/            # ratchet integrity suites
npm run build                                  # typecheck gate
npm run test:e2e -- sw-persist                 # warm-open / deferral / race / locked
```

## Real-device soak (the true target)

Deploy to the dev deployment (`ring-dev.zuptalo.com`); remember client changes need
`npm run build` to show on the installed PWA. On the phone: enable the flag, close the app
fully, have the other account send messages, watch notifications arrive, then open the app
on airplane mode — the conversation must be fully there. Repeat with PIN lock enabled
(generic notifications, nothing stored while locked) and during a live call (signalling
must not hiccup while a push lands).

## Degrade checklist (each must behave exactly like today)

- Flag off (default) — byte-for-byte current behavior.
- PIN/passkey lock on — generic notification, no decrypt, no storage, frame stays queued.
- Web Locks unsupported — feature silently off.
- Lock timeout (page hung/frozen) — that wake previews only.
- Kill the SW mid-drain (DevTools → stop worker) — no partial state; frames redeliver.
