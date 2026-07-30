# Implementation Plan: Voice/audio blank on chat-list open (spec 2060)

**Branch**: `fix/2060-voice-and-audio` | **Date**: 2026-07-30 | **Spec**: [spec.md](./spec.md)

## Summary

The chat bubble's `v-memo` lists `mediaInfo[m.mediaId]?.posterUrl` as the signal that a message's
media became available, but not the resolved playback `url`. Voice messages and audio cards have
no poster, so when their media resolves after the bubble first painted (which is what happens when
a chat is opened by tapping its list row — bubbles paint a beat before media resolves), the memo's
watched values are unchanged and the bubble never re-renders to show the player. Fix: add
`mediaInfo[m.mediaId]?.url` to the memo dependency list.

Root cause verified empirically: `resolveMediaFor` runs and resolves the voice blob on the
list-tap path (logged `media? true, blob? true`), yet `.vp` never appears — the bubble is frozen
by the memo. Adding the `url` dep makes it render. The `onUnmounted` revoke + resolve watcher + the
poster-only memo dep all date to spec 1014 (#239), which is why this is pre-existing.

## Technical Context

Client-only, one line in `src/views/detail/ChatDetailPage.vue`. No new dependency, storage, wire,
or server surface. TDD: a red e2e that opens the chat from the list and asserts the voice player
renders. Also on this branch: the deferred 1.0.33 Docker Scout bumps (server `go.mod`:
`x/net` 0.56.0, `x/text` 0.39.0) and the start-of-cycle version bump to 1.0.34.

## Constitution Check

- **I. Zero-Knowledge**: PASS — nothing crosses the wire (ZK Impact section present).
- **III. Test-Driven**: PASS (binding) — red e2e observed failing before the fix.
- **V. Offline-First**: N/A — no store change.
- **VII. Quality Gates**: PASS — build + vitest + e2e; server build/vet/test after the dep bump.
- **Supply-chain scan / version bump** (Dev Workflow MUSTs): addressed on this branch — see spec
  Complexity & Exceptions E-1/E-2.
- Others: N/A (no crypto/server/migration).

## Risks

- **The memo must not lose its suppression value** (FR-005/SC-003): `url` changes only when media
  resolves or is evicted — never on a status tick or reaction — so the scroll/update-path
  suppression the memo exists for is unchanged. Verified: media-viewer + chat-media-scroll suites
  green.
- **The two viewer clear/delete-while-open tests are pre-existing flake** (timing race between a
  media clear and the viewer reconcile); confirmed 4/4 green with the fix and 9/9 with retries.
