# Feature Specification: Video Posts Finish Cleanly

**Feature Branch**: `fix/2036-video-posts-finish`

**Created**: 2026-07-14

**Status**: in-progress
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped. -->

**Input**: User bug report (2026-07-14, screen recording): a video post churns
through states while uploading and "never finishes cleanly" — the final frame
shows the post SUCCESSFULLY on the Wall with a stale "Post didn't finish / Tap
Finish to post it" card still sitting above it.

## Diagnosis

Two startup paths race on the same outbox record after a relaunch mid-upload:
`recoverInterruptedPosts` (unlock watch in App.vue) and the drain kicked by the
WS coming online (useSync → kickPendingPosts). Since spec 1024 stores every
item's bytes INLINE, the drain genuinely resumes the leftover 'uploading'
record and posts it — but the recovery still operates on the pre-1024 premise
that a cut-off upload can never resume, flips the record to 'interrupted'
mid-flight, and (having read the outbox before the upload finished) its late
write RESURRECTS the row after the successful post already deleted it. Result:
a completed post plus a zombie draft card, and visible state churn while the
two writers fight.

## Requirements

- **FR-001**: Startup recovery MUST NOT touch outbox records it can resume:
  a record whose media items all carry inline bytes (or that has no media) is
  left 'uploading' for the drain to finish silently. Only genuinely
  unresumable records (legacy items without bytes) become 'interrupted'
  drafts; already-posted leftovers are cleaned up as today.
- **FR-002**: Recovery writes MUST be conditional on the record's current
  state (re-read before flip; skip if deleted or changed) so a racing
  successful upload can never be resurrected as a draft.
- **FR-003**: Recovery MUST kick the drain when it leaves resumable records
  behind, so a session that comes online before unlock still finishes them.

## Success Criteria

- **SC-001**: Unit tests pin: resumable records untouched + drain kicked;
  unresumable records flipped once; a record deleted mid-recovery stays
  deleted (no resurrection).
- **SC-002**: The reporter's flow (relaunch mid-video-post) ends with exactly
  one posted video and no leftover card.
