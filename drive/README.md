# `drive/` — drive the dev UI with Playwright

A zero-friction way to **spin up several test users, generate conversations, drive the real
UI, and screenshot it** — to reproduce or investigate an issue. It attaches to the dev app
you're already running with `make start` and drives everything through the dev-only
`window.__ringTest` hook (the same surface the e2e suite uses), so it exercises real client
code paths.

This is the *fast, attach-to-what's-running* complement to the hermetic harnesses
(`npm run test:e2e`, `npm run showcase`), which boot their own isolated backend.

## Prerequisites

- `make start` running (Vite `:5173` → ringd `:8080` → dev Postgres).
- `npx playwright install chromium` (once).

## Run

```sh
node drive/scenarios/group-conversation.mjs      # or: npm run drive drive/scenarios/<name>.mjs
HEADED=1 node drive/scenarios/dm-and-react.mjs    # watch it in a real window
node drive/scenarios/lengthy-chat-scroll.mjs      # spec 1011: 5 users, all kinds, 5k-msg scroll-up
SLOWMO=400 HEADED=1 node drive/scenarios/...      # slow each action down
VERBOSE=1 node drive/scenarios/...                # forward ALL page console logs
```

`lengthy-chat-scroll.mjs` (spec 1011) connects 5 users, exchanges every message kind in a
1:1 + a group, bulk-seeds a 5,000-message chat (`seedHistory`/`__ringTest.seedMessages`),
then flicks up through it capturing each look-ahead page to `.tmp/drive/lengthy-chat-*.png` —
Read those back to confirm continuous, bounded, non-snapping content (smooth scroll-up).

Screenshots are written to `.tmp/drive/*.png` (gitignored). Read them back to see the UI;
account ids, the group id, and each `[shot] <path>` stream to stdout.

## Write your own (a scenario is ~10 lines)

```js
import { createAccount, pair, say, waitForMessage, chatWith, shot, sweep, done } from '../driver.mjs';

const a = await createAccount({ name: 'Alice' });
const b = await createAccount({ name: 'Bob', mobile: true });   // iPhone emulation
await pair(a, b);
await say(a, b.id, 'hey');                  // 1:1 → pass the PEER id
await waitForMessage(b, a.id, /hey/);
await shot(b, 'bob-chat', { route: `/chat/${await chatWith(b, a.id)}` });
await sweep([a, b]); await done();          // self-delete the throwaway accounts
```

Driver exports (`drive/driver.mjs`): `createAccount`, `pair`, `group`, `say`, `waitForMessage`,
`messageId`, `react`, `chatWith`, `shot`, `poll`, `sweep`, `done`, plus `newClient`/`browser`
and `BASE_URL`/`SHOT_DIR`. For long-chat work (spec 1011): `sendAudio`, `sendVideoNote`,
`sendImage`, `sendVideo`, `seedHistory` (bulk-seed N messages), `scrollUpPass` (flick up +
screenshot each page), and `bubbleCount` (assert the DOM stays bounded).

## Gotchas (already handled by the driver — don't re-hit them)

- **Polling:** use the driver's `poll()` / `waitForMessage()`, **not**
  `page.waitForFunction(() => somePromise.then(...))` — an async predicate resolves
  early/spuriously in a standalone node script. A *sync* predicate is fine.
- **1:1 chat ids differ per device** — resolve with `chatWith(client, peerId)` on each side
  (`say`/`waitForMessage` do this when you pass a peer id). **Group ids are shared.**
- **Accounts** use freshly-minted dev codes (`/v1/dev/invite`), never the seeded `INVITE01..10`,
  so reruns never hit consumed-code / username-taken.
- **Mobile** (`mobile: true`) = iPhone 13 under chromium (webkit isn't installed): UA + viewport
  + touch. Calls work (fake media flags are set).

## Cleaning up throwaway accounts

End scenarios with `sweep([...])` (calls `deleteAccount()` per user — leaves no trace). For a
full wipe of the dev DB when the directory gets noisy: stop ringd (Ctrl-C `make start`), then
`make db-reset`, then `make start` (ringd re-migrates + re-seeds `INVITE01..10`).
