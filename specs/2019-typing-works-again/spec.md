# Feature Specification: Typing works again after sending pasted media, and captions reach every attachment

**Feature Branch**: `fix/2019-typing-works-again`

**Created**: 2026-07-04

**Status**: shipped

**Input**: Bug report (iOS installed PWA): "after pasting an image the composer still works and
I can type captions — but after I press SEND, I can't type in the composer anymore until I
leave the chat and come back. Also with multiple attachments, the main caption only applies
to the first image; it should apply to any attachment without its own caption."

## The bugs

1. **Keyboard dies after sending staged media.** Sending clears the staged-media strip,
   which unmounts the paste-bar toolbar and swaps the composer textarea's
   placeholder/maxlength. On iOS WebKit that DOM churn destroys the field's native input
   session while the element stays focused — tapping the composer raises no keyboard until
   the element itself is recreated (leaving + re-entering the chat).
2. **Shared caption only reaches the first album item.** `send()` deliberately attached the
   composer text as a caption only to the FIRST item of an album; items 2+ without a
   per-item caption went out uncaptioned.

## Requirements

- **FR-001**: After sending staged media, the composer MUST keep accepting input — the
  keyboard session is re-established within the send gesture.
- **FR-002**: The composer text applies as the caption to EVERY staged attachment that has
  no per-item caption (album or individual); a per-item caption always wins for its item.
- **FR-003**: Plain-text sends and per-item caption editing behavior are unchanged.

## Success Criteria

- **SC-001**: Paste → caption → send → type again immediately, on-device (the reporting
  iPhone), 100% of attempts.
- **SC-002**: A 3-photo batch with a composer caption and one per-item caption arrives as:
  item with its own caption keeps it; the other two carry the composer caption.
- **SC-003**: Existing chat-media e2e suites stay green.

## Zero-Knowledge Impact *(constitution Principle I)*

None — composer focus handling and client-side caption assignment; nothing new on the wire
(captions were already carried E2EE inside the sealed payload).

## Assumptions

- The keyboard fix (blur→refocus of the native textarea inside the send gesture, after the
  reactive flush) is verified on the reporting device before merge — the WebKit input-
  session teardown is not reproducible in headless e2e.
- Keeping the keyboard OPEN after send is the desired UX (messenger convention).
