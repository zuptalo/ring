# Implementation Plan: Call on-hold visualization & 1:1 diagnostics

**Spec**: [spec.md](./spec.md) · **Branch**: `fix/2011-hold-ui-and-1to1-diag` · **Date**: 2026-06-25

## Summary

Client-only UI/diagnostics fixes in the call screen. No server change; zero-knowledge unchanged.

## Technical context

- `src/views/detail/CallActivePage.vue` holds the 1:1 stage: the remote `main-video` (with a
  `held-frozen` blur class when `remoteHeld`), the centered `held-overlay` (currently gated on
  `remoteHeld && mainHasVideo && !mainIsLocal`), the `audio-stage` avatar (no held treatment), and a
  small `cw-onhold` pill (`v-if="remoteHeld"`) near the controls — the redundant one.
- The ⓘ panel reads `callDiagSnapshot` (set only by `mesh.ts` → group calls) and `callDiagLines`
  (`pushDiag`). The 1:1 `pollStats` in `useCall.ts` computes `callStats` (kbps) but never feeds
  `setDiagSnapshot`, so a 1:1 panel stays at "collecting…".

## Design

### US1 — unify on-hold, remove the pill
- Remove the `cw-onhold` pill element (the `v-if="remoteHeld"` one). Keep the call-waiting parked-call
  bar (`heldCall`) and the group per-tile badge (`tile-onhold`) untouched (FR-004).
- Show the centered `held-overlay` for BOTH video and audio: change its `v-if` to
  `remoteHeld && !mainIsLocal` (drop the `mainHasVideo` requirement). It's absolutely positioned over
  the stage, so it centers over the avatar for audio.
- Blur the avatar stage when held: add `:class="{ 'held-frozen': remoteHeld && !mainIsLocal }"` to the
  `audio-stage` (or its avatar), reusing the existing `.held-frozen` blur. Verify `.held-overlay` CSS
  centers within the audio stage (it already centers over the video stage).

### US2 — feed the ⓘ panel on 1:1 calls
- In `useCall.ts` `pollStats` (the `pc` / 1:1 branch), after computing kbps, build a short status line
  from the same getStats report: codec, up/down kbps, the current 1:1 tier (`oneToOneQc.tier`), and
  RTT/packet-loss if present — and call `setDiagSnapshot([...])`. Refreshes each poll (~1s).
- Clear the snapshot on call teardown (so a stale 1:1 line doesn't linger). Group calls still own the
  snapshot when `groupSession` is active (don't fight the mesh: only set the 1:1 snapshot when `pc` and
  no `groupSession`).
- This is presentation only — read from the local getStats already polled; nothing new leaves the
  device (FR-007).

## Constitution / ZK

Zero-knowledge unchanged (local getStats only, no server/DB change). TDD: these are UI/presentation
changes best covered by e2e (hold visuals via the call-waiting hold path; 1:1 diag line present) plus
the existing unit suite; no new pure logic warrants a unit test beyond what exists.

## Files

- `src/views/detail/CallActivePage.vue` — remove the pill, extend held-overlay + blur to audio, minor
  CSS.
- `src/composables/useCall.ts` — feed `setDiagSnapshot` from the 1:1 `pollStats`; clear on teardown.
- `e2e/` — assert held audio shows the overlay (and no pill) and the 1:1 ⓘ panel populates, via the
  existing call-waiting / call hooks where feasible.

## Phasing

US1 (hold UI) and US2 (1:1 diag) are independent. Polish: build + unit + targeted e2e + roadmap.
