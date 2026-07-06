# Handoff: Submarine Game Bubble (Battleship redesign)

## Overview
A visual + UX redesign of the in‑chat Battleship game (spec `0011-battleship-hidden-fleets`) for the Ring messenger. It reskins the fleet as **submarines** (which fits the "opponent fires blind at hidden ships" mechanic), turns the game message into a **full‑width shared card**, and adds four things the current board doesn't have:

1. **Full‑width game card** instead of a right‑aligned chat bubble (it's a shared experience, not "your" message).
2. **Manual fleet placement** during the placing phase — drag a submarine to move it, tap to rotate 90°, with live overlap/out‑of‑bounds validation.
3. **A sonar radar sweep** over the opponent's sea during battle (rotating beam + range rings + ping), brighter on your turn.
4. **Custom vector art + animations everywhere** — submarines drawn as continuous multi‑cell vessels, per‑segment **fire** on hits, a **sunk‑submarine wreck** reveal, a targeting **reticle**, sonar **ripple** misses, and a struck **medallion** result. No emoji.

## About the Design Files
The files in this bundle are a **design reference built in HTML** (a self‑contained prototype that shows the intended look, motion, and interactions). They are **not** production code to copy verbatim.

The Ring app is **Vue 3 + Ionic + TypeScript**. The task is to **recreate this design inside the existing components and patterns** of the ring repo — primarily:

- `src/components/GameBubble.vue` — the card shell (matchup header, glanceable status, action row, result overlay).
- `src/games/battleship/BattleshipBoard.vue` — the board itself (placing / battle faces, the two seas, shots, and now the radar + placement UX).
- `src/games/battleship/logic.ts` / `session.ts` / `secret.ts` — **unchanged game rules**. See the "Keep the real protocol" note below.

Reuse the existing tokens in `src/theme/variables.css` (`--ion-color-primary`, `--app-text-muted`, `--app-bubble-*`, etc.). Only the submarine art, the radar, and the placement‑editing UX are genuinely new.

## Fidelity
**High‑fidelity.** Final colors, sizes, spacing, motion, and interactions are all specified below and are the intended production values. Recreate pixel‑for‑pixel using the codebase's Vue/Ionic patterns (the prototype draws the ships/fire/ghost/medal with inline SVG via a small `React.createElement`‑style helper; in Vue these become `<svg>` in the SFC template or a small render function).

## ⚠️ Keep the real protocol (important)
The prototype contains a **mock opponent** (random return fire, instant "answers") purely so the prototype is playable in isolation. **Do not port that.** The real game is commit‑and‑reveal, zero‑knowledge, driven by `applyMove`/`status`/`replayState` over the shared move log, with the local fleet secret in `secret.ts`. This redesign only changes **presentation + the placement UI**:

- The chosen/rearranged layout is exactly what today gets hashed in `BattleshipBoard.vue`'s `ready()` (`commitment(layout, salt)` → `setFleetSecret`). Manual placement just lets the player author `layout` instead of only shuffling a random one.
- Shot results (`miss` / `hit` / `sunk`), turn derivation, the end‑of‑game reveal, and out‑of‑sync handling all stay in the engine. The visuals are a pure function of the replayed public state, same as today (FR‑004).

## Layout & sizing
- **Card**: full width of the message column. Padding `14px`, border‑radius `18px`, `1px` border, soft shadow `0 1px 2px rgba(0,0,0,.06), 0 10px 26px -14px rgba(0,0,0,.28)`. Background is a **neutral surface**, not the green outgoing bubble: `#ffffff` (light) / `#181f1b` (dark); border `rgba(0,0,0,.07)` / `rgba(255,255,255,.08)`.
- **Inner column**: `display:flex; flex-direction:column; gap:9px`.
- **Board**: 8×8. Each grid is `display:grid; grid-template-columns:repeat(8,1fr); gap:2px; padding:4px; border-radius:10px`. Cells are `aspect-ratio:1; border-radius:4px`.
- **Fleet**: lengths `[4,3,3,2]` = **12 cells** (`FLEET`, `FLEET_CELLS` — matches `logic.ts`).
- **Two seas stack vertically** in battle: *Their sea* on top (you fire here), *Your sea* below. Keep this order (prompt‑adjacency + parity with today's board).

## Screens / faces

### 1. Placing
- **Your sea** (8×8) pre‑filled with your submarines.
- Hint row above the grid: a four‑arrow move glyph + **"Drag ships to move · tap to rotate"** in the primary green, 13px/600.
- Action row (right aligned): **Shuffle** (ghost button, primary text, shuffle icon) and **Deploy fleet** (solid primary pill `#10b981`, text `#04150f`, check icon, shadow `0 4px 10px -3px rgba(16,185,129,.6)`).
- Ships are the interactive submarine vessels (see Interactions → Placement).

### 2. Battle
- **Turn strip** (above Their sea): spinning reticle + **"Your shot — tap their sea"** in primary when it's your turn; muted spinner + **"Waiting for their move…"** otherwise.
- **Their sea** (top): tappable cells. Grid gets a green turn‑glow `box-shadow:0 0 0 2px rgba(16,185,129,.55)` on your turn, and dims to `opacity:.6` while waiting. **Radar** overlay on top of the water (see below). Subs are hidden until sunk.
- **Your sea** (bottom): your submarines drawn in full; incoming shots land here as ripples/fire; a fully‑destroyed sub becomes a wreck.
- **Status line** (below board): reticle + "Your move" / spinner + "Mia's move" (mirrors today's `GameBubble` status). **Resign** action while ongoing.

### 3. Result overlay
- Dark scrim `rgba(6,10,18,.62)` + `backdrop-filter:blur(2px)` over the board.
- **Medallion** (92px), `heroPop` entrance. Gold = win `{fill:#f6c453, ring:#c99a2e, star:#fff8e6}`; silver = loss `{fill:#d7dde3, ring:#98a2ac, star:#ffffff}`.
- Result text (`You won!` / `Mia won` / `You gave up`) + **Rematch** button (refresh icon).

## Interactions & behavior

### Placement (new)
- **Drag**: `pointerdown` on a sub starts a drag; it follows the pointer and snaps to the nearest cell. While held it lifts with a shadow only (`filter: drop-shadow(0 4px 5px rgba(0,0,0,.35))`) — **no scale transform** (scaling made neighbours appear to wobble).
- **Validity**: an illegal position (overlap or off‑board) tints the sub red (`drop-shadow` red glow); on release an invalid drop **snaps back** to where it started.
- **Tap** (pointer down+up without moving): **rotate 90°** (`h`⇄`v`), clamped into bounds; if the rotation wouldn't fit it's declined (no‑op).
- **Isolation requirement**: each sub is absolutely positioned from its **own** `{r,c,len,dir}` (see "Positioning math"), NOT via a shared CSS grid. This is deliberate — with a shared `1fr` grid, rotating one ship forces the browser to re‑solve tracks and sub‑pixel‑nudges the neighbours. With independent absolute boxes, moving/rotating one ship changes **only** that ship.

### Battle
- Tap an un‑fired enemy cell → a **reticle** (pending) shows (~640ms in the prototype; in production it's however long the answer takes) → resolves to **miss** (ripple), **hit** (fire on that cell), or **sunk** (all of that sub's cells were hit → its individual flames are removed and the **wreck** is revealed spanning the sub).
- Only the player whose turn it is can fire (gate on the engine's `canMove`).

### Radar (new)
- Overlay on *Their sea* only, `position:absolute; inset:4px; border-radius:10px; overflow:hidden; pointer-events:none` (must NOT block taps — cells sit below it and stay clickable). Place it **above** the water grid but **below** the ships/shots overlay.
- Opacity `0.95` on your turn, `0.5` while waiting (`transition:opacity .35s`).
- Contents: faint crosshair (2 lines), 3 concentric range rings (`rgba(16,185,129, .11–.16)`), a rotating **conic‑gradient sweep**, and a **ping** ring.
- **Sweep direction matters**: the beam must rotate so the **bright edge leads and the glow fades behind it** (trailing). Implemented as a full‑circle element (`150%`, `border-radius:50%`) with `background: conic-gradient(from 0deg, rgba(16,185,129,.32), rgba(16,185,129,.06) 26deg, rgba(16,185,129,0) 56deg, transparent)` animated `@keyframes radarSweep { to { transform: rotate(-360deg) } }` (note the **negative** rotation — that's what puts the fade on the trailing side). Duration `3.8s linear infinite`.
- **Ping**: a ring `@keyframes sonarPing { 0%{transform:scale(.12);opacity:.55} 80%{opacity:0} 100%{transform:scale(1);opacity:0} }`, `3.8s ease-out infinite`.

## Positioning math (ship & fire overlay)
Overlay container: `position:absolute; inset:4px; pointer-events:none`. For a region at row `r`, col `c`, spanning `cs`×`rs` cells on an 8×8 board with 2px gaps:
```
offset(n) = calc((100% - 14px) / 8 * n + n*2px)      // 7 gaps × 2px = 14px
size(n)   = calc((100% - 14px) / 8 * n + (n-1)*2px)
style = { position:absolute, left:offset(c), top:offset(r), width:size(cs), height:size(rs) }
```
Ship: `cs = horizontal ? len : 1`, `rs = horizontal ? 1 : len`. A fire marker is a single cell (`cs=rs=1`, flex‑center the flame). Each submarine SVG fills its box with `preserveAspectRatio:"none"`.

## Submarine artwork
Drawn horizontally (bow to the right) in a `len*100 × 100` viewBox; for vertical subs wrap the art in `translate(100,0) rotate(90)` and use a `100 × len*100` viewBox. A gentle `scale(1,1.14)` around y=54 fattens the beam. Parts (scale with length):
- **Pressure hull**: rounded capsule, fill `#454f5a`, outline `#1a2026` 2.5; top highlight `#707b86`, bottom shadow `#262d34`.
- **Conning tower (sail)** amidships: `#374049`, with a small `#7dd3fc` window light.
- **Periscope + antenna** rising from the tower.
- **Propeller** (stern/left): brass `#c6a24a` crossed ellipses + hub, plus a rudder fin.
- **Bow dive plane** (right).
- **Glowing portholes**: `#7dd3fc` dots along the hull (count scales with length).
- Drop shadow `0 1px 1.5px rgba(0,0,0,.28)`.

**Sunk wreck** (replaces the sub when all its cells are hit): same capsule silhouette in spectral `rgba(200,214,226,.58)` with white stroke, a hull crack, dark breaches, dead **X** eyes on the tower, and two rising bubbles (`bob` animation). Entrance `ghostIn` (fade + rise + settle at `rotate(-4deg)`).

## Shot / status iconography (all custom SVG, no emoji)
- **Reticle / target** (pending shot, "your move"): `#10b981` — outer pulsing ring (`reticlePulse`), dashed spinning ring (`reticleSpin`), center dot, crosshair ticks.
- **Miss**: concentric sonar **ripple** rings, stroke = "ink" `rgba(2,6,23,.42)` light / `rgba(255,255,255,.55)` dark (`ripple` keyframe).
- **Hit fire**: layered flames, outer `#fb923c`, inner `#fde047`, core `#ff5a2c` (`flicker` keyframe, transform‑origin bottom).
- **Waiting spinner**: dashed arc in `--app-text-muted` (`spin`).
- **Medallion**: ring + 5‑point star, gold/silver values above (`heroPop`).
- **Buttons**: Feather‑style **shuffle**, **check** (Deploy), **refresh** (Rematch), four‑arrow **move** (placement hint).
- **Header fleet mark**: a mini submarine beside each player name (mirrored for the opponent).

## State
```
phase: 'placing' | 'battle'            // battle also carries the result overlay
myShips / theirShips: { r,c,len,dir }[] // dir: 'h' | 'v'  (theirShips hidden until sunk)
theirSea / mySea: Record<cellIndex, 'pending'|'miss'|'hit'|'sunk'>
turn: 0 | 1        // seat, from the engine
winner: 0 | 1 | null
dragIdx: number    // ship being dragged (-1 = none)
dragInvalid: bool  // current drag/rotate position illegal
```
Helpers: `shipCells({r,c,len,dir})` → cell indices; a ship is **sunk** when all its cells are `hit`/`sunk`. In production these map onto the engine's derived state — `myShips` comes from the local secret layout, `theirShips` are only known (for the wreck reveal) once revealed at game end; before that, render fire on hit cells and reveal the wreck only when the sub is confirmed sunk.

## Design tokens
**Color**
- Primary / accent (green): `#10b981` (= `--ion-color-primary`); pill text on primary: `#04150f`
- Sea accent: `rgb(28, 92, 140)`
  - water cell: `rgba(28,92,140,0.13)`
  - grid background (depth gradient): `linear-gradient(180deg, rgba(28,92,140,0.07), rgba(28,92,140,0.16))`
  - charred hit cell: `rgba(120,60,30,0.20)`; sunk cell: `rgba(70,84,110,0.22)`
- Card: bg `#ffffff` / `#181f1b`; border `rgba(0,0,0,.07)` / `rgba(255,255,255,.08)`
- Text: `#0b0b0c` / `#ffffff`; muted `rgba(0,0,0,.55)` / `rgba(255,255,255,.6)`
- Submarine: hull `#454f5a`, hi `#707b86`, lo `#262d34`, outline `#1a2026`, tower `#374049`, trim `#8b96a1`, porthole `#7dd3fc`, propeller `#c6a24a`
- Fire: `#fb923c` / `#fde047` / core `#ff5a2c`
- Ghost/wreck: `rgba(200,214,226,.58)` fill, `rgba(255,255,255,.55)` stroke
- Miss ink: `rgba(2,6,23,.42)` / `rgba(255,255,255,.55)`
- Medal gold `#f6c453 / #c99a2e / #fff8e6`; silver `#d7dde3 / #98a2ac / #ffffff`
- Radar: `#10b981` at `.11–.45` alpha
- Turn glow: `rgba(16,185,129,.55)`

**Spacing / shape** — card padding 14, radius 18; grid padding 4, radius 10, gap 2; cell radius 4; board 8×8.

**Type** — matchup names 16/600; "vs" 12/700 uppercase; sea labels 11/600 uppercase; turn strip & status 13/600 & 13; hint 13/600. Inherit the app font stack.

**Motion** — `radarSweep` 3.8s linear (rotate −360°), `sonarPing` 3.8s, `flicker` ~.5s alternate, `ripple` .7s, `reticleSpin` 3.5s / `reticlePulse` 1.4s, `spin` .9s, `markPop` .3s, `ghostIn` .55s, `bob` 2.4–2.8s, `heroPop` .55s.

## Assets
No external assets — everything is inline SVG (submarines, fire, wreck, reticle, ripple, spinner, medallion, radar, and the Feather‑style button icons). No image files, no icon fonts. The avatar is a placeholder monogram; wire it to the real chat avatar (`UserAvatar.vue`).

## Files in this bundle
- `Ring Battleship Bubble v2.dc.html` — the design prototype (all layout, submarine/fire/wreck/radar SVG, placement drag‑and‑drop, and animations live here).
- `support.js` — runtime the prototype needs to render. Open the `.dc.html` in a browser with this file alongside it to view/interact with the design. (This runtime is prototype‑only; do not port it.)

## Suggested implementation order
1. Full‑width neutral card in `GameBubble.vue` (layout + tokens).
2. Submarine SVG vessels as a positioned overlay in `BattleshipBoard.vue` (both seas) using the positioning math above.
3. Custom shot icons (reticle/ripple/fire) + sunk‑sub wreck reveal, replacing today's emoji marks.
4. Manual placement (drag/tap‑rotate + validation) feeding the existing `ready()` commitment.
5. Radar overlay on *Their sea*.
6. Result medallion overlay.
