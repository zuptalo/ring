# Tasks: Submarine Redesign of the Battleship Card

**Input**: [spec.md](spec.md) + the authoritative pixel spec [design/handoff.md](design/handoff.md)
**Order**: the handoff's own implementation order. Rules/protocol files are OFF LIMITS (SC-001).

- [ ] T001 Full-width neutral game card: `.bubble-row`/`.bubble` game treatment in ChatDetailPage + GameBubble shell tokens (all game kinds, both themes)
- [ ] T002 Submarine vessels: SubmarineSvg (hull/tower/periscope/prop/portholes/dive plane, h/v, wreck variant) + the positioned overlay math on both seas in BattleshipBoard
- [ ] T003 Custom shot iconography replacing emoji marks: reticle (pending), sonar ripple (miss), layered flames (hit), charred/sunk tints, own-wreck immediate + their-wreck at reveal
- [ ] T004 Manual placement: drag (snap, lift shadow, red invalid tint, snap-back), tap-rotate with fit clamp, hint row, Shuffle ghost + Deploy fleet pill feeding the unchanged ready()/commitment flow (e2e label updated)
- [ ] T005 Sonar radar overlay on Their sea: crosshair, rings, trailing-fade sweep (negative rotation), ping; bright on your turn; never blocks taps
- [ ] T006 Medallion result overlay (battleship only) + full visual matrix (SC-003), gates (unit + all game e2e), diff verification (SC-001), roadmap

## GitHub Issues

One issue per task (created 2026-07-06):
T001 #852 · T002 #853 · T003 #854 · T004 #855 · T005 #856 · T006 #857 · 
