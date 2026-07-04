# Implementation Plan: spec 2020 (hotfix)

**Branch**: `fix/2020-fast-message-bursts` | **Date**: 2026-07-04 | **Spec**: [spec.md](spec.md)

## Server: trailing-edge debounce for message tickles

`server/internal/push/push.go` — a per-user debouncer used ONLY by `Notify` (msg tickles):

- First tickle in a quiet period sends immediately (SC-003) and stamps `last[user]`.
- Further tickles within `window` (2s) schedule ONE trailing send at `last+window`
  (`time.AfterFunc`), then coalesce into it (the SW drains the whole relay queue on any
  wake, so the trailing tickle covers every message of the burst — FR-004).
- Map pruned lazily (entries older than a few windows dropped on insert) so it can't grow
  unbounded. Call/conn/post/version paths bypass the debouncer entirely (FR-002).
- Unit test with an injected window + a fake send hook: leading fires, mid-burst sends
  coalesce, trailing fires exactly once, isolated sends are immediate.

## Client: skip visually-identical re-asserts

`src/sw.ts` + `src/services/sw-inbox.ts`:

- Track the last SHOWN signature per conversation tag (`{tag → {body, count, ts}}`, one
  settings record, bounded + TTL'd like the shown summary): updated by `showNotes` (real
  shows) and by `reassertFromSummary` (silent re-asserts).
- `reassertFromSummary` compares the freshest summary entry against the signature: same
  body + count → show NOTHING (the spec-2016 badge-only outcome class); changed → re-assert
  silently as today and update the signature.
- Pure decision helper (`shouldReassert(prevSig, entry)`) unit-tested in sw-inbox tests.

## Constitution check

- I: tickle payload unchanged; timing-only server change (spec §Zero-Knowledge Impact).
- III: Go unit tests for the debouncer ordering; vitest for the re-assert decision; device
  burst test for the end-to-end shape (push delivery lag can't be simulated headless).
- VI: no schema/store change (in-memory debounce state; the server stays stateless — a
  restart merely forgets in-flight debounce windows, worst case one extra tickle).

## Verification

- `go test ./internal/push/`; vitest sw-inbox; burst test on-device: 10 rapid messages →
  wakes only for new content, last message announced within ~2s.
