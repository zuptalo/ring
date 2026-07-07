# Quickstart: Armada — Fullscreen Naval Duel (spec 1038)

## See the design reference

Open `specs/1038-armada-fullscreen-naval/design/Armada.dc.html` in a browser
(or just read it — all logic/styles are inline). The README in the same
directory is the annotated handoff; `shipTopSVG`, `aiFire` (ignored — PvP),
`cellsFor`/`canPlace`, and the animation table are the parts worth reading
before touching `ArmadaBoard.vue`.

## Run it locally

```sh
make start                 # postgres + ringd (:8080) + vite (:5173)
```

1:1 flow: register two accounts (dev invite codes `RINGDEV1`…), pair them,
open the chat → attach menu → games → **Armada** → the challenge card appears
for both; tap "Play in fullscreen ▸". Deploy (drag/rotate/auto-deploy) →
Engage → alternate fire. Leave with the header chevron or back gesture and
watch the floating pill (badge when it's your turn); message the account from
a third account to see banners over the game.

Wall flow: compose a post → challenge → Armada; accept from another account.

Multi-user driving without hand-clicking: `node drive/scenarios/armada.mjs`
(screenshots land in `.tmp/drive/`).

## Test gates (the definition of done)

```sh
npx vitest run src/games/armada src/games/duty.test.ts   # red-first protocol + duty suites
npm run test:unit                                        # full client unit + coverage floors
npm run build                                            # vue-tsc typecheck + vite build
cd server && go build ./... && go vet ./... && go test ./...   # must be a ZERO-diff pass
npm run test:e2e -- games-armada                         # fullscreen duel, toasts, pill
npm run test:e2e -- games                                # retirement + legacy battleship
```

## Verifying the headline behaviors by hand

- **Stall fix (FR-009)**: as the defender, close the app the instant the
  opponent fires (before the answer sends). Reopen the app WITHOUT opening
  the chat — the answer must go out anyway (duty officer), and the attacker's
  board updates.
- **Secrecy (FR-002)**: while a game is mid-battle, inspect IndexedDB on the
  attacker's device — the defender's layout must appear nowhere; only
  `armada.secret.<own commitment>` exists, on each player's own device.
- **Fullscreen fallback (FR-006)**: on iPhone Safari (no element fullscreen)
  the overlay must behave identically minus the OS chrome hiding.
- **Suppression (FR-007)**: with the overlay open, a move in THIS game shows
  no banner (cue only); a message from another chat shows a banner ABOVE the
  game; tapping it minimizes and navigates.
- **Smoke budget (SC-006)**: sink a ship, wait ~7 s, confirm in devtools that
  no smoke nodes remain animating.
