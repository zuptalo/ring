# Implementation Plan: spec 2019 (hotfix)

**Branch**: `fix/2019-typing-works-again` | **Date**: 2026-07-04 | **Spec**: [spec.md](spec.md)

## Fix (src/views/detail/ChatDetailPage.vue, send() media branch only)

1. After clearing `pendingMedia` + the draft, `await nextTick()` (reactive flush lands,
   still inside the send tap's user gesture — iOS requires a gesture for keyboard-raising
   focus), then blur→focus the native textarea via the existing `nativeComposer()` helper.
2. Caption mapping becomes `it.caption || caption || undefined` — the shared composer
   caption fills every item that has no per-item caption, album and individual alike
   (previously: album → first item only).

## Constitution check

- III (TDD): the caption rule is pinned in e2e (batch send asserts per-item bodies); the
  keyboard fix is device-verified (WebKit session teardown has no headless reproduction —
  same caveat as spec 2018, documented in the spec).
- I: no wire change. XI: no new UI.

## Verification

- e2e: extend a chat-media spec to send a multi-attachment batch with mixed captions and
  assert each received message's caption.
- Device: paste → caption → send → keep typing; batch captions as SC-002.
