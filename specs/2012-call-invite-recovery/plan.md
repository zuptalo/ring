# Implementation Plan: Call invite recovery & honest ringing

**Spec**: [spec.md](./spec.md) · **Branch**: `fix/2012-call-invite-recovery` · **Date**: 2026-06-25

## Summary

Make a mid-ring callee reload non-fatal and the caller's "ringing" honest. Primarily a small
server-side relay change (`server/internal/ws/hub.go`) plus tiny client guards. Zero-knowledge intact
(the recovered invite is the existing sealed call-offer ciphertext).

## Root causes (from investigation)

- The server **only buffers** a 1:1 `call-offer` when the callee was offline (`hub.go` `if !delivered`).
  When the callee is online, the offer is delivered live once and never retained — so after the
  callee's reload (in-memory call state destroyed; offer not persisted client-side), reconnect's
  `flushBufferedCalls()` has nothing → no incoming UI.
- The caller's `call-ringing` is a **one-shot** (server auto-issues it when the callee's socket first
  receives the offer, or on the SW push-ack). There is **no ringing keepalive** and nothing tells the
  caller the callee's socket dropped, so the caller waits out the full ~60s `ANSWER_TIMEOUT_MS`.
- The resume countdown (`beginResumeCountdown`) always runs on resume, regardless of call kind.

## Design

### US1 — Callee recovery (server retains + re-delivers the offer)
- In `hub.go`, **always buffer the 1:1 `call-offer`** (and its trickled ICE) for its existing short
  TTL, not only when `!delivered`. On the callee's next socket connect, the existing
  `flushBufferedCalls()` re-delivers it → the callee rings again.
- **Clear the buffered invite when the call resolves** for that callId: extend the existing
  answer/cancel/end/reject/busy handling (where the ring loop is stopped) to also clear the callId's
  buffered call frames — so a settled/declined call never re-rings on a later reconnect (FR-003).
- **Client double-ring guard** (`src/composables/useCall.ts` `handleOffer`): early-return if we're
  already showing the incoming call for the same `callId` (FR-002).
- The TTL already bounds staleness (FR-004). No client-side persistence of the SDP (keeps plaintext
  off disk, FR-009).

### US2 — Caller honesty (drop on callee unreachable, with grace)
- The hub tracks active 1:1 rings (the `callRing` registry used by the ring loop / `AckCallReachable`).
  When the **callee's last socket drops** (`cleanup`), for any active ring where that user is the
  callee, start a short **grace timer**. If the callee reconnects and re-acks ringing within the
  grace (the recovered offer re-flushes → callee re-rings → re-ack), cancel it (FR-006). Otherwise
  send the **caller** a `call-end` (or `call-cancel`) with reason `unreachable` (FR-005). The caller
  already tears down on `call-end`/`call-cancel` while ringing (`useCall.ts` `handleCallFrame`).
- Keep the existing `ANSWER_TIMEOUT_MS`/no-answer behavior as the long backstop (FR-007).

### US3 — No countdown on audio resume (client)
- In `src/composables/useCall.ts` `beginResumeCountdown` (and/or its caller on `resume`), gate on the
  call being video: for an audio call, skip the countdown and resume immediately (FR-008). The
  CallActivePage `resume-countdown` UI already only shows when `resumeCountdown !== null`, so not
  arming it for audio is sufficient.

## Constitution / ZK

- **Zero-knowledge (Principle I):** the buffered/re-delivered invite is the existing sealed call-offer
  ciphertext; the server cannot read it and stores no plaintext. No new readable metadata. (FR-009)
- **Server change is allowed and minimal** — relay buffering/notification only; no schema change.
- **TDD:** the hub has table tests (`hub_test.go` / handler tests). Add server tests for: an
  online-delivered offer is re-delivered on the callee's reconnect; a resolved call's invite is NOT
  re-delivered; the caller is notified when the callee drops without re-ringing within grace. Client:
  the `handleOffer` dedup guard; audio resume arms no countdown.

## Files

- `server/internal/ws/hub.go` (+ `*_test.go`) — always-buffer the offer; clear on resolve; notify
  caller on callee drop (with grace).
- `src/composables/useCall.ts` — `handleOffer` dedup guard; gate `beginResumeCountdown` on video.
- `e2e/` — callee-reload-recovers-incoming-call; caller-drops-on-vanished-callee; audio-resume-no-countdown
  (where the harness can drive a reload / socket drop).

## Phasing

US1 (recovery) and US2 (honesty) are the core, both in `hub.go` and complementary; US3 is an
independent one-line client gate. Polish: server + client gates, e2e, roadmap.
