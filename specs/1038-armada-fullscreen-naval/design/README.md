# Handoff: Armada — Battleship Game (Ring-themed)

## Overview
**Armada** is a single-player Battleship (naval grid) game designed to live inside the **Ring** messenger app. A player deploys a 5-ship fleet on a 10×10 grid, then trades salvos with an AI opponent until one fleet is destroyed. It is launched as a **fullscreen overlay** from a 1:1 chat, a group chat, or a social "Wall" post, and returns to the exact surface it was launched from on exit.

This package replaces an existing battleship implementation. Treat it as the **new target design + behavior spec**.

## About the Design Files
The file in this bundle — `Armada.dc.html` — is a **design reference created in HTML** (a working prototype demonstrating the intended look, layout, animations, and game logic). It is **not** production code to copy directly. It is written as a "Design Component" using a small custom runtime (`React.createElement` + an `x-dc` template), which is **not** part of your app.

Your task is to **recreate this design and its behavior in your existing codebase** using its established framework and patterns (the Ring app is **React 19 + Ionic Framework v8**, per the design system). The prototype's *game logic is plain, portable JavaScript* — you can lift the algorithms (placement, AI targeting, hit/sink detection) almost verbatim into a React component or a plain module. The *rendering* should be rebuilt with your components, not ported from the prototype's `createElement` calls.

If you want to see the prototype run to read values/behavior, open `Armada.dc.html` in a browser (it self-loads its runtime from a relative `support.js` — if that file isn't present, just read the source; all logic and styles are inline and human-readable).

## Fidelity
**High-fidelity (hifi).** Colors, typography, spacing, animations, and interactions are final. Recreate the UI faithfully using Ring's existing Ionic components and CSS tokens. All exact values are listed in **Design Tokens** below.

---

## Screens / Views

The experience has two layers: the **Ring app shell** (context surfaces that launch the game) and the **game overlay** (the game itself, fullscreen). In your app, the shell already exists — you only need the **launch entry points** (challenge cards + a play button) and the **game overlay**. The shell in the prototype is only there to demonstrate context and can be ignored except for the challenge-card pattern.

### 1. Challenge Card (launch entry point)
- **Purpose**: A rich message/post embed that invites the user to play. Appears in a 1:1 chat, group chat, and Wall post.
- **Layout**: A rounded card, max-width **320px**. Top row: a **46×46** app-glyph SVG + a title block (`ARMADA` + a context subtitle). Below: a full-width primary button.
- **Card**: background `linear-gradient(160deg, #1b2440, #141a2b)` (a subtle navy gradient over Ring surface), border `1px solid rgba(143,174,255,0.25)`, border-radius **16px**, padding **14px**.
- **Title**: `ARMADA`, 15px / 700 / letter-spacing 1px, color `#f5f7ff`. Subtitle: 12px, `rgba(220,226,245,0.6)` — e.g. "Naval duel · Maya challenged you", "Group duel · 4 players in lobby", "Open challenge · 6 friends playing".
- **Button**: full-width, padding 11px, radius 10px, `linear-gradient(135deg,#41537e,#2c3e70)`, border `1px solid rgba(143,174,255,0.5)`, white text 14px/600. Labels: "Play in fullscreen ▸" (1:1), "Join & play ▸" (group), "Accept challenge ▸" (wall).
- **Behavior**: Tapping the button launches the game overlay and calls the Fullscreen API on the game container (see Interactions).

### 2. Game Overlay — Deployment phase (`phase: 'place'`)
- **Purpose**: Player positions all 5 ships before battle.
- **Layout**: A vertical flex that fills the overlay. **Header bar** (fixed) → **scrolling body**. Body contains, top-to-bottom: status block → board(s) → control buttons → fleet roster(s) → battle log. On phones (< 760px container) everything **stacks single-column**; on tablets (≥ 760px) boards and rosters sit **side-by-side** (two columns).
- **Header**: left = round exit button (40×40, radius 12px, chevron-down icon `#e6ebff`) that closes the overlay. Center = `ARMADA` (15px/700/letter-spacing 2px) + context subtitle (12px, `rgba(220,226,245,0.55)`). Right = a mono context pill ("1:1" / "GROUP" / "WALL"), 11px, border `1px solid rgba(143,174,255,0.2)`, radius 8px.
- **Status block**: centered. Title "DEPLOY YOUR FLEET" (18px/700/letter-spacing 2px, `#f5f7ff`). Subtitle guides the current action, e.g. "Position your Carrier · tap grid to place · drag to move · tap ship to rotate".
- **Board (Your Fleet)**: a labeled 10×10 grid. Column numbers `1–10` (top), row letters `A–J` (left), both in mono at `rgba(205,214,255,0.35)`. Cells are CSS-grid squares (see cell sizing in Design Tokens). Empty cell: background `rgba(123,156,255,0.055)`, border `1px solid rgba(123,156,255,0.09)`, radius 7px.
- **Placement preview**: while hovering/dragging a ship not-yet-placed, the target cells highlight **green** (`rgba(45,211,111,0.2)` fill, `rgba(45,211,111,0.65)` border) if valid, **red** (`rgba(235,68,90,0.18)` / `rgba(235,68,90,0.65)`) if invalid/off-board.
- **Ship item (placed)**: rendered as a **top-down warship silhouette** (see Ship Silhouettes below), spanning its cells via CSS grid. Hover shows an accent glow + a small rotate icon badge; a valid drag shows a green glow, invalid shows red.
- **Panel wrapper**: each board/roster sits in a panel: background `#1c2030`, border `1px solid rgba(255,255,255,0.08)`, radius 16px, padding 16px (tablet) / 12px (phone). Panel header = a mono label (11px/letter-spacing 2px/600) + optional count on the right.
- **Controls**: "Auto-deploy" and "Clear" (secondary style), plus "Engage ▸" (primary) once all 5 ships are placed.
- **Fleet roster**: 5 rows, one per ship. Each row: small ship silhouette icon (52×14 SVG) + name (13px/600) + size pips (one 8×8 rounded square per hull cell) + a status chip on the right. Chip states during placement: `Ready` (green), `Placing` (amber, current ship, highlighted row), `Standby` (dim).

### 3. Game Overlay — Battle phase (`phase: 'battle'`)
- **Purpose**: Player and AI alternate firing salvos.
- **Layout**: Now shows **two boards** — "ENEMY WATERS" (top / left) and "YOUR FLEET" (bottom / right) — plus two rosters and the battle log.
- **Status**: Title alternates "YOUR MOVE" (accent color) / "ENEMY FIRING" (amber `#ffc409`). Subtitle echoes the latest event.
- **Enemy board**: enemy ships are hidden. Tapping an un-fired cell (only on your turn) fires a salvo. A **sonar/radar** ambient layer sits *behind* the cells (see Radar).
- **Aim reticle**: on your turn, hovering an un-fired enemy cell shows a pulsing ring (border `1.5px` accent, glow, `reticlePulse` animation) and the cell tints `rgba(123,156,255,0.14)`.
- **Miss marker**: a small dot — circle `rgba(143,174,255,0.4)` with a soft ring, `splashIn` animation. Cell bg `rgba(255,255,255,0.02)`.
- **Hit marker (ship still afloat)**: an explosion burst that settles into a **burning flame** in that cell (see Fire Effects).
- **Your board**: your ships are always visible as silhouettes; incoming hits show flames the same way.
- **Rosters**: enemy roster shows `Active` / hit count `n/size` / `Sunk`; your roster shows `Afloat` / `n/size` / `Sunk`. Sunk rows turn red-tinted.
- **Battle log**: last 6 events, each a colored dot + mono text. Dot colors: hit `#ffc409`, miss `rgba(143,174,255,0.5)`, sunk `#ff6b7a`, info = accent. Newest on top, older rows fade.

### 4. Ship sunk state
- When **every** cell of a ship is hit, the ship becomes a **charred wreck** (dark hull with gash marks) and, for ~6.5 seconds, emits a **rising smoke column** + a small base flame. After that window the animated smoke/flame **stop rendering** (perf), leaving the static wreck and a faint pulsing ember on each of its cells.

### 5. Result overlay — end of war (`phase: 'over'`)
- **Purpose**: Announce win/loss with a medal, show stats, offer restart.
- **Layout**: A full-cover dimmed backdrop (`rgba(6,9,14,0.72)` + `backdrop-filter: blur(8px)`) centering a card. Card: `min(420px, 90%)` wide, background `linear-gradient(180deg,#1c2030,#141821)`, radius 22px, padding 28px 26px 24px, centered text, border tinted gold (win) or red (loss). `cardRise` entrance animation.
- **Contents (top→bottom)**:
  - Mono eyebrow "WAR CONCLUDED" (10px/letter-spacing 4px, `rgba(143,174,255,0.6)`).
  - **Medal** (120×148): ribbon + circular disc with a star. **Win** = gold (`#ffd76b → #e0a327 → #b8791a`) with a bright star `#fff4d0` and an animated **shine sweep**; red ribbons. **Loss** = iron/grey (`#8a9099 → #565c66 → #3a3f47`), muted rotated star, grey ribbons, no shine. `medalPop` entrance.
  - Title: "VICTORY" (gold `#ffd76b`) or "DEFEAT" (red `#ff6b7a`), 34px/700/letter-spacing 6px.
  - **Rank** (mono, 12px/letter-spacing 2px): win → `Fleet Admiral` (≥4 ships survived) / `Commodore` (≥2) / `Battle-Scarred Victor` (else); loss → `Lost at Sea`.
  - Citation line (13px, `rgba(220,226,245,0.65)`), e.g. "Enemy armada sent to the depths with 4 of your 5 ships still afloat." / "Your fleet has been destroyed. The waters fall silent."
  - **Stats row** in a subtle inset box: Shots (total fired), Accuracy (`hits/shots` %, value in accent color), Ships Sunk (`n/5`), Survivors (`n/5`, green on win / red on loss). Each stat: 22px/700 mono value + 9.5px mono uppercase label.
  - **Buttons**: "New battle" (primary — resets to deployment), "Review board" (dismisses the overlay to inspect the final board), "Leave" (exits fullscreen / closes the game).
- **Dismiss / reopen**: Tapping "Review board" or the backdrop hides the modal (`resultDismissed = true`) and reveals the final board; the over-phase controls then include a "View result" button that reopens it (`resultDismissed = false`).

---

## Ship Silhouettes (the "items")
Five ship classes, each drawn as a **top-down SVG** that stretches (`preserveAspectRatio: none`) to fill its `size × 1` cell span; when vertical, the same SVG is rotated 90°.

| Ship | Size (cells) | Silhouette details |
|---|---|---|
| Carrier | 5 | Long flat-deck hull, dashed centerline runway, a small island/tower offset from center, deck-edge marks |
| Battleship | 4 | Two forward main turrets + one aft turret (each = disc + two barrels), central bridge block |
| Cruiser | 3 | Slimmer hull, one fore + one aft turret, a bridge block + funnel disc |
| Submarine | 3 | Rounded pill hull, central conning tower, a short deck line |
| Destroyer | 2 | Small sleek hull, one turret, a short bridge + thin funnel |

- **Afloat palette**: hull `#3d4d78` (sub `#33406a`), stroke `rgba(143,174,255,0.6)`, superstructure `#6274a8`, barrels `rgba(8,12,22,0.6)`.
- **Wrecked palette**: hull `#2c2723` (sub `#282320`), stroke `rgba(150,74,48,0.65)`, plus black gash polygons, a smouldering rim line `rgba(90,40,25,0.7)`, and a central ember dot `rgba(235,90,42,0.5)`.
- A small circular **insignia badge** (first letter of ship name) sits at hull center when afloat and not hovered.

Reference the exact SVG path construction in `Armada.dc.html` → method `shipTopSVG(key, L, S, wrecked)` (L = length in px, S = cell size). It's parametric so it scales to any cell size.

---

## Interactions & Behavior

### Placement
- Ships are placed **in fixed order**: Carrier → Battleship → Cruiser → Submarine → Destroyer.
- **Tap an empty cell** to place the current ship with its bow at that cell (blocked if it would overlap or run off-board; preview shows green/red).
- **Auto-deploy** randomly places all remaining ships (retry loop up to 800 tries per ship, no overlaps).
- **Clear** removes all ships and restarts placement.
- After all 5 are placed, ships remain editable:
  - **Tap a placed ship** → rotate it (h↔v). If rotation would run off-board it nudges inward; blocked if it would overlap another ship.
  - **Drag a placed ship** → move it. Uses **pointer events** (mouse + touch). A **6px movement threshold** distinguishes a drag from a tap. While dragging, the ship follows the grid and glows green (valid drop) / red (invalid); on release it commits if valid, else snaps back. Set `touch-action: none` on draggable ships.
  - Keyboard: `R` rotates the current ship during placement.

### Combat turn loop
- Player fires by tapping an un-fired enemy cell **only on their turn**. Repeated shots on the same cell are ignored.
- A shot is a **hit** if it lands on an enemy ship cell, else a **miss**. **No bonus turn on a hit** — turn always passes to the enemy after each player shot (classic alternating salvo; note this is a deliberate rule choice — confirm with product if "fire again on hit" is desired).
- After the player's shot, the enemy fires after a **760ms** delay (feels like "thinking").
- **Win** when all enemy ship cells are hit; **loss** when all player ship cells are hit → `phase: 'over'`.

### AI targeting (opponent)
Two difficulties (prop `difficulty`): **Recruit** (random) and **Admiral** (hunt/target). Admiral logic:
- **Hunt mode**: fire on a parity/checkerboard pattern (only cells where `(row + col) % 2 === 0`) among untried cells — the optimal search pattern since the smallest ship is length 2.
- **Target mode**: when a hit lands (and the ship isn't yet sunk), push the 4 orthogonal neighbors of that hit onto a priority queue; drain the queue before returning to hunt mode.
- When a ship is sunk, purge its cells from the queue.
- Recruit mode skips the queue/parity and just fires at a random untried cell.

Port this verbatim from `aiFire()` in the prototype — it's clean, dependency-free JS.

### Fullscreen
- On launch, call `element.requestFullscreen()` on the game container. **`requestFullscreen()` returns a Promise that rejects when blocked by iframe permissions policy** — you must attach a `.catch(() => {})` (a synchronous try/catch does NOT catch the async rejection). Same for `document.exitFullscreen()`.
- Fullscreen is **optional/graceful**: if it's blocked, the overlay still covers the app surface via absolute positioning, and the game plays normally.
- On exit (chevron / "Leave"), call `exitFullscreen()` (guarded) and return to the launching surface.

### Animations (all short, GPU-friendly)
| Name | Trigger | Spec |
|---|---|---|
| `deployIn` | ship placed | scale .82→1, 0.35s ease-out |
| `sinkSettle` | ship sunk | small translate/rotate settle, 0.6s |
| `splashIn` | miss marker | scale 0→1.2→1, 0.45s |
| `impactIn` | hit explosion | scale .2→1.3→1, 0.5s |
| `explosionBurst` | hit | radial burst scale .2→1.75, opacity→0, 0.55s forwards |
| `flameFlicker` | burning cell | subtle scale/translate flicker, 0.5s infinite |
| `emberGlow` | sunk-cell ember | opacity .5↔.95, 1.6s infinite |
| `smokeRise` / `smokeRiseL` / `smokeRiseR` | sunk ship, first ~6.5s | puff rises ~400%, expands ~2×, fades; 2.6s staggered infinite (then removed) |
| `reticlePulse` | aim hover | scale 1↔1.16, 1.2s infinite |
| `radarSweep` | enemy board (battle) | conic wedge rotate 360°, 5s linear infinite |
| `resultFade` / `cardRise` / `medalPop` / `medalShine` | result overlay | fade-in / card slide-up / medal pop / gold shine sweep |

**Performance note (important):** the rising smoke uses blurred, animated divs — the single most GPU-expensive element. It is deliberately **time-boxed to ~6.5s per sunk ship, then unmounted**, and limited to **3 puffs** with light blur. Preserve this behavior; do not leave blurred smoke animating indefinitely, especially for multiple sunk ships, or low-end devices will thermal-throttle.

### Radar / sonar (enemy board, battle + over)
Ambient decoration behind the enemy cells (`z-index: 0`, `pointer-events: none`): concentric rings + crosshair + center blip (SVG, stroke in accent at low alpha), plus a rotating **conic-gradient sweep** wedge. The sweep is **dim (opacity .35) on your turn** and **bright (opacity 1) during ENEMY FIRING**. Toggle via prop `radar`.

---

## State Management
Core state (see the prototype's `state = {…}`):
- `phase`: `'place' | 'battle' | 'over'`
- `orient`: `'h' | 'v'` (orientation for the next placement)
- `placeIndex`: `0–5` (how many ships placed)
- `playerFleet` / `enemyFleet`: array of `{ name, size, key, orient, start, cells:number[] }` (cells are 0–99 board indices)
- `shotsOnEnemy` / `shotsOnPlayer`: map `cellIndex → 'hit' | 'miss'`
- `turn`: `'player' | 'enemy'`
- `winner`: `null | 'player' | 'enemy'`
- `aiQueue`: number[] (AI target-mode priority cells)
- `hoverIdx`, `hoverShip`, `dragging` (+ transient drag fields), `smoking` (map of `shipKey → bool`, cleared by timers), `resultDismissed`
- `message`, `log` (array of `{ t, text }`)

Geometry helpers to port: `cellsFor(idx, orient, size)`, `canPlace(cells, fleet)`, `placeRandom()`. Board is a flat 10×10; `index = row*10 + col`.

**Multiplayer note:** the prototype opponent is a local AI. If the real feature is player-vs-player over Ring's E2EE transport, keep the same board/ship data model and turn loop but replace `aiFire()` with sending/receiving the opponent's shot (each side keeps only its own fleet; you exchange shot coordinates + hit/miss/sunk results). The rendering, animations, and result overlay are unchanged.

---

## Design Tokens

### Colors (map to Ring's `var(--ring-*)` where possible)
| Role | Value | Ring token |
|---|---|---|
| App background (overlay) | radial `#1c2030 → #141821 → #0e1116` | `--ring-bg` = `#0e1116` |
| Surface / panel / card | `#1c2030` | `--ring-surface` |
| Panel border | `rgba(255,255,255,0.08)` | — |
| Primary (buttons, ship hull light) | `#2c3e70` / hover `#41537e` | `--ring-primary` (dark: `#7b9cff`) |
| Primary button gradient | `linear-gradient(135deg,#41537e,#2c3e70)` | — |
| Accent (aim, links, active) — **configurable prop** | default `#7b9cff` | `--ring-primary` (dark) |
| Ship hull (afloat) | `#3d4d78` / `#33406a` (sub) | — |
| Text primary | `#f5f5f5` / `#f5f7ff` | `--ring-text` |
| Text subdued | `rgba(220,226,245,0.55–0.65)` | — |
| Success / afloat-good / survivors-win | `#2dd36f` | `--ring-success` |
| Warning / hit / enemy-firing | `#ffc409` | `--ring-warning` |
| Danger / miss-of-ship / sunk / defeat | `#eb445a` / `#ff6b7a` | `--ring-danger` |
| Fire / flame | `#eb5a2a → #ffb226 → #ffe680` | — |
| Smoke | `rgba(168,170,182,…)` grey puffs | — |
| Medal gold | `#ffd76b → #e0a327 → #b8791a`, star `#fff4d0` | — |
| Medal iron (loss) | `#8a9099 → #565c66 → #3a3f47` | — |

### Typography
- **UI font**: Inter (design-system substitute for the native `-apple-system` stack). Use Ring's `--ring-font-family` in the app.
- **Mono font**: JetBrains Mono — used for labels, pills, stats, coordinates, the battle log. Use `--ring-font-mono`.
- Scale used: 34px/700 (result title), 22px/700 (stat value, chat title), 18px/700 (status title), 15–16px/600–700 (card/chat titles), 13–14px/400–600 (body, buttons), 9.5–12px (mono labels, chips, captions).
- Letter-spacing is used deliberately on titles/labels (2–6px) for a "military UI" feel.

### Spacing & radius (8px base)
- Common paddings: 12, 14, 16, 20, 24, 28px. Gaps: 4px (grid cells), 6–10px (rows/controls), 14–20px (panels/columns).
- Radius: cells 7px, ships 8–9px, panels/log 14–16px, result card 22px, pills/buttons 8–11px, exit button 12px, avatars/discs 50%.

### Board cell sizing (responsive)
Cell size is computed to fit the container: `cell = clamp(24px, floor((contentWidth − 22 − 9*gap) / 10), 40px)`, `gap = 4px`. `twoCol` layout kicks in at container width **≥ 760px**. Markers scale off cell size (miss ≈ 0.32×, hit ≈ 0.62×, reticle ≈ 0.55×). Recreate this responsiveness so the board fits phones and tablets without horizontal scroll.

---

## Assets
- **No external image assets** — all ships, medals, fire, smoke, radar, and icons are drawn as inline SVG/CSS. Icons in the shell (chat, phone, tablet, back chevron, etc.) are simple inline stroked SVGs; in the Ring app, use **Ionicons v8** equivalents instead.
- **Fonts**: Inter + JetBrains Mono via Google Fonts in the prototype; use Ring's configured font tokens in the app.
- App-glyph on the challenge card is a small inline SVG placeholder — swap for Ring's real Armada/game icon if one exists.

## Files
- `Armada.dc.html` — the complete design reference (all screens, styles, animations, and game logic inline). Key methods to read when implementing:
  - `shipTopSVG()` — parametric top-down ship silhouettes
  - `buildBoard()` — grid, markers, ship overlays, radar, drag/aim wiring
  - `flameEl()` / `explosionEl()` / `emberEl()` / `buildSmoke()` — fire/smoke effects
  - `playerFire()` / `aiFire()` — turn loop + AI targeting
  - `cellsFor()` / `canPlace()` / `placeRandom()` — board geometry
  - `buildResultModal()` / `medalSVG()` — end-of-war overlay
  - `launch()` / `onExitGame()` — fullscreen enter/exit (note the Promise `.catch`)
  - `state` + `renderVals()` — full state model
