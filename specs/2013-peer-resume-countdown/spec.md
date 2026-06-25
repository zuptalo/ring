# Feature Specification: Mirror the resume countdown for the swapper

**Feature Branch**: `fix/2013-peer-resume-countdown`

**Created**: 2026-06-25

**Status**: in-review
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: When a held video call resumes, the party coming back on camera gets a 5s "You'll be on
camera…" heads-up before their camera goes live (spec 0005). But the person who swapped TO that call
(the resumer) gets nothing — they stare at the other party's frozen frame for 5 seconds with no
explanation. Show them a matching countdown: "{name}'s video resumes in 5…", so they know the other
side's video is about to come back. Video calls only (an audio resume has no video, so no countdown —
consistent with spec 2012).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The swapper knows the other side's video is coming back (Priority: P1)

When someone swaps back to (or returns to) a held **video** call, they see a brief countdown telling
them the other party's video will resume in a few seconds — mirroring the heads-up the other party
gets before their camera goes live. So instead of an unexplained frozen frame, both sides see a
synchronized "video resuming" countdown.

**Why this priority**: Without it, the resumer sees a stale/frozen remote frame for ~5s and may think
the call is broken; the symmetric countdown makes the brief wait understandable.

**Independent Test**: A↔B on a held video call; A swaps/returns to B (resuming it) → A sees a "{B}'s
video resumes in N…" countdown (5→…), which clears as B's video comes back; B still sees its own
"You'll be on camera…" countdown. On an audio call, A sees no countdown.

**Acceptance Scenarios**:

1. **Given** a held **video** call, **When** the user swaps/returns to it (resuming it), **Then** they
   see a countdown indicating the other party's video resumes shortly, which clears when the video is
   back.
2. **Given** a held **audio** call, **When** the user swaps/returns to it, **Then** no resume
   countdown is shown (consistent with spec 2012).
3. **Given** the resumed party's existing "You'll be on camera…" countdown, **When** a video call
   resumes, **Then** that countdown is unchanged (this only adds the mirrored one for the other side).

### Edge Cases

- The call is torn down / re-held / swapped again before the countdown elapses: the countdown clears
  and does not linger.
- The resumer's countdown is a heads-up only (informational) — it does not gate media; the remote
  video appears when the other side's camera actually goes live.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When a user resumes a held **video** call (swap, or return after the other call ends),
  they MUST see a brief countdown indicating the other party's video is about to resume.
- **FR-002**: The resumer's countdown MUST be shown only for video calls; an audio resume MUST show no
  countdown (consistent with spec 2012).
- **FR-003**: The resumer's countdown MUST clear when it elapses (or sooner if the call is torn
  down / re-held / swapped) and MUST NOT linger.
- **FR-004**: The existing "You'll be on camera…" countdown shown to the party coming back on camera
  MUST be unchanged.
- **FR-005**: The countdown is purely informational/client-local — it MUST NOT gate media or change
  any signalling; no server change; the zero-knowledge boundary is unchanged.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Resuming a held video call shows the resumer a "{name}'s video resumes…" countdown that
  clears within ~5s; resuming a held audio call shows no countdown.
- **SC-002**: The resumed party's own "You'll be on camera…" countdown is unaffected.
- **SC-003**: No regression to the call-waiting hold/swap/resume suites.

## Assumptions

- The resumer initiates the resume locally (the swap/return path that sends `resume` to the peer), so
  it can start a synchronized local countdown of the same length as the peer's heads-up (5s).
- Approximate sync (both ~5s, started as the resume is sent/received) is sufficient — it is a heads-up,
  not a hard gate on when the remote video appears.
