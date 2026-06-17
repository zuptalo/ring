---
name: "drive-ui"
description: "Drive the running Ring dev UI with Playwright to reproduce/investigate an issue: spin up several throwaway test users, pair them, create groups, send + react to messages, and screenshot the real app — all via window.__ringTest against the live `make start` stack (Vite :5173 → ringd :8080). Use whenever you need to SEE the UI behave, reproduce a multi-user bug, or capture a screenshot to inspect. For hermetic/CI-style runs use `npm run test:e2e` instead."
argument-hint: "what to investigate (e.g. 'group seen counter doesn't update for the third member')"
user-invocable: true
disable-model-invocation: false
---

## User Input

```text
$ARGUMENTS
```

## When to use this

Reach for this the moment investigating an issue means actually *driving the UI* — a
messaging/group/reaction/seen/presence/call behavior, a layout question, or "show me what
happens when…". Don't hand-roll a one-off Playwright script; use the `drive/` harness, which
already encodes the setup and the gotchas. (For deterministic test assertions or CI, write/run
an `e2e/*.spec.ts` via `npm run test:e2e` instead — that boots its own isolated backend.)

## Steps

1. **Preflight.** The harness attaches to the running dev stack. Check it's up:
   `curl -fsS http://localhost:5173 >/dev/null && curl -fsS http://localhost:8080/healthz`.
   If not, ask the user to run `make start` (and `npx playwright install chromium` once), then stop.
2. **Learn the API.** Read `drive/driver.mjs` (exports + the GOTCHAS header) and one example in
   `drive/scenarios/` to match conventions.
3. **Write a focused scenario** at `drive/scenarios/<slug>.mjs` reproducing `$ARGUMENTS`. Keep it
   ~10–20 lines using the driver helpers: `createAccount({name, mobile})`, `pair`, `group`, `say`,
   `waitForMessage`, `messageId`, `react`, `chatWith`, `shot`. End with `sweep([...])` then `done()`.
4. **Run it:** `node drive/scenarios/<slug>.mjs` (add `HEADED=1` to watch, `SLOWMO=400` to slow it,
   `VERBOSE=1` for all page console).
5. **Inspect.** Read the `.tmp/drive/*.png` screenshots (the Read tool renders PNGs) and the
   stdout (ids, group id, `[shot] <path>`, forwarded page console). Iterate on the scenario and
   re-run until the issue is reproduced/understood.
6. **Report** findings, referencing the screenshots. Commit the scenario if it's a useful
   reference (everything under `drive/` is tracked); only `.tmp/drive/` artifacts are gitignored.
7. **Clean up.** `sweep([...])` self-deletes the throwaway accounts. If the dev directory gets
   noisy, suggest `make db-reset` (stop ringd first).

## Rules / gotchas (the driver encodes these — keep them)

- Use the driver's `poll()` / `waitForMessage()`, **never** `page.waitForFunction(() =>
  somePromise.then(...))` — an async predicate resolves early/spuriously in a standalone node
  script. A *sync* predicate (`() => !!window.__ringTest`) is fine.
- 1:1 chat ids differ **per device** → resolve with `chatWith(client, peerId)` on each side
  (`say`/`waitForMessage` do this when you pass a peer id). **Group ids are shared.**
- Accounts use minted dev codes (`/v1/dev/invite`), never the seeded `INVITE01..10`.
- `mobile: true` = iPhone 13 under chromium (webkit isn't installed): UA + viewport + touch.
- Screenshots go to `.tmp/drive/` (gitignored). This shares the **dev DB** — it's the fast,
  interactive path, not a hermetic one.
