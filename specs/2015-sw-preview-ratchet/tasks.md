---
description: "Task list for spec 2015 — SW preview decrypts queued messages after the ratchet advanced"
---

# Tasks: Background notifications decrypt queued messages reliably

**Input**: [spec.md](./spec.md)

**Tests**: REQUIRED (TDD). Reproduce the decrypt failure as a FAILING crypto/messaging unit test
first, then implement the fix to green. Touches the E2EE ratchet → adversarial safety review required.

## Phase 3: User Story 1 + 2 — reliable preview without corrupting the session (P1)

- [x] T001 Write a FAILING unit test reproducing the bug: establish a 1:1 session; ADVANCE + PERSIST
  the receiving ratchet (simulating live call/`qos` signals received + saved) so the persisted base is
  past a still-queued earlier message; then `previewPacket` that queued message → currently throws
  ("ciphertext cannot be decrypted"). (`src/services/messaging.test.ts` or `crypto/*.test.ts`.)
- [x] T002 Fix `previewPacket` (`src/services/messaging.ts`): run inside `sessionMutex` (FR-006);
  when an ESTABLISHED (persisted) session decrypts a NORMAL message, `saveSession` the advanced
  receiving ratchet + skipped keys (FR-001/FR-002); for a prekey / no-session / re-init path, decrypt
  IN-MEMORY only — do NOT consume the one-time prekey or persist a new responder session (FR-003); do
  NOT touch the send-preamble (FR-004). Run T001 → green.
- [x] T003 Test idempotency/no-corruption (FR-005): after `previewPacket` advanced+persisted, the
  authoritative `openPacket` of the same and subsequent messages still decrypts (via the skipped-key
  cache); a first-contact prekey is still established/consumed only by `openPacket`, and the preamble
  is cleared only by `openPacket`.
- [~] T004 (Optional, robustness) In `src/services/sw-inbox.ts` `previewPending`, decrypt a backlog as
  one in-order advancing pass (per session) rather than reloading per frame — only if it doesn't
  complicate the mutex/persist model.

## Phase 6: Polish

- [x] T005 Adversarial review: a fresh pass specifically hunting session-corruption / message-loss /
  prekey-consumption / SW↔page race regressions in the fix.
- [x] T006 Zero-knowledge confirmation: no plaintext leaves the device; SW still only fetches the
  sealed ciphertext; no server change (FR-007).
- [x] T007 Full gate: `npm run build`; `npx vitest run`; `cd server && go build/vet/test`;
  `RING_E2E_PORT=8085 npm run test:e2e` (notifications-inapp / sw-decrypt / calls — no regression).
- [x] T008 Flip spec `Status:` to `in-review` at PR and run `make roadmap`.
