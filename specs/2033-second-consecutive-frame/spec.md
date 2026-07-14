# Feature Specification: Second Consecutive Frame on a Fresh Carrier Session Is Lost

**Feature Branch**: `fix/2033-second-consecutive-frame`

**Created**: 2026-07-14

**Status**: in-progress
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped. -->

**Input**: Found while building spec 1050's fan-out e2e (2026-07-14): in a fresh 3-member group, a member's SECOND consecutive sealed frame to a co-member who has not written back since fails to decrypt ("ciphertext cannot be decrypted using that key", ratchetDecrypt normal packet) and — because the relay already dropped the sender's outbox copy — is permanently lost for that recipient. Reproduced identically on the pre-1050 client (bisect via `git stash push src/`), so this is a live bug in the shipped ratchet/session layer, not a 1050 regression.

## Reproduction (deterministic, from the 1050 work)

Accounts A,B,C; pair(A,B), pair(A,C) — B and C are NOT paired (their session is the
group's hidden 1:1 carrier). A creates a group {A,B,C}; A: "hello crew"; B: "bob here"
(B initiates X3DH B→C); wait until everyone has it; C: "carol here" (C's responder-side
first send — decrypts fine everywhere); then, with B staying silent, C sends ANY second
frame (the repro used a reaction signal): B logs
`failed to open incoming message {from: C, packet: normal}` and C's frame never applies
on B. Interjecting any B→group frame between C's two sends avoids it (send-after-receive
resets the chain), which is the temporary dodge marked in e2e/push-routing.spec.ts.
The full-suite flake in games-group.spec.ts (challenge→accept→observers) has the same
shape and is plausibly this bug.

## User impact

In groups containing not-mutually-paired members, back-to-back frames from one member
(two quick messages, a message + reaction, game move bursts) silently vanish for
co-members who haven't spoken since — no error, no retry, permanent divergence.

## Requirements

- **FR-001**: A member MUST be able to send arbitrarily many consecutive sealed frames
  over a fresh carrier session without any recipient losing one (Double Ratchet
  consecutive-send on the responder-established side).
- **FR-002**: Per the constitution (III, hotfix rule; IV crypto discipline), the fix
  MUST start from a failing regression test — unit-level in the crypto core (pure
  ratchet: initiator/responder, consecutive sends, out-of-order, skipped keys) plus
  the e2e choreography above un-dodged — and MUST get a security review.
- **FR-003**: Recovery for already-diverged sessions rides the existing re-key path;
  the fix must not invalidate healthy sessions.

## Zero-Knowledge Impact

None — on-device crypto correctness; nothing about the wire or server changes.

## Success Criteria

- **SC-001**: The un-dodged 1050 choreography passes 10/10 locally; the dodge comment
  in e2e/push-routing.spec.ts is removed by this spec's PR.
- **SC-002**: New pure-ratchet consecutive-send tests cover both establishment sides.
- **SC-003**: games-group.spec.ts stops flaking in full-suite runs (tracked across CI).

## Assumptions

- Suspected locus: session persistence/advance around responder-established carriers
  (`messaging.ts` open/seal + ratchet state save ordering) — to be confirmed by the
  failing unit tests before any fix (no diagnosis is trusted until a pure test
  reproduces it).
