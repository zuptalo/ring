# Quickstart: In-Chat Turn-Based Games

**Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

## Dev loop

```sh
make start                      # Postgres + ringd (hot reload) + Vite on :5173
```

Register two dev accounts (invite codes `RINGDEV1`..`RINGDEV9`), pair them, open a 1:1
chat → attach (+) → Game → Tic-tac-toe. Play both sides in two browser profiles.

Fast multi-user reproduction without hand-clicking — the drive harness:

```sh
node drive/scenarios/tictactoe.mjs          # (added by this feature; screenshots in .tmp/drive/)
HEADED=1 node drive/scenarios/tictactoe.mjs # watch it live
```

## Where things live

| Concern | Location |
|---------|----------|
| Rules + registry (pure, no Vue) | `src/games/` (`registry.ts` is the catalog; `boards.ts` maps id → component) |
| Wire payload | `game` / `gameMove` fields in `src/services/crypto/message.ts` |
| Send/receive/apply orchestration | `src/db/queries.ts` (`sendGame`, `playGameMove`, `resignGame`, `handleGameMove`) |
| Session storage | `Message.game` on the bubble's row (no new object store) |
| Bubble + picker UI | `src/components/GameBubble.vue`, `GamePicker.vue`; attach entry in `ChatDetailPage.vue` |
| Previews / notifications | `message-preview.ts`, `notify-preview.ts`, `sw-inbox.ts`, `sw-drain.ts` |

## Tests

```sh
npm run test:unit -- src/games          # rules engine + session replay (pure, fast)
npm run test:e2e -- games.spec.ts       # two-account start/move/win/resign (needs make db-up)
npm run build                           # vue-tsc typecheck — the client gate
```

**Zero-knowledge proof point**: `git diff --stat develop -- server/` must print nothing
for this whole feature.

## Adding the next game (the FR-016 promise)

1. `src/games/<id>/logic.ts` — pure `createInitialState/applyMove/turn/status` + tests.
2. `src/games/<id>/index.ts` — the `GameModule` (id, name, icon).
3. `src/games/<id>/<Name>Board.vue` — board UI (stock Ionic + `--ring-*` tokens).
4. Register: one line in `registry.ts`, one line in `boards.ts`.

No changes to transport, storage, previews, notifications, or server. The wire `id` and
the game's `move` shape are frozen once shipped — evolve rules under a new id.
