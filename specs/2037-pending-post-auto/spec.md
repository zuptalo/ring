# Feature Specification: Pending-Post Auto-Retry Gets an Attempt Budget

**Feature Branch**: `fix/2037-pending-post-auto`

**Created**: 2026-07-15

**Status**: in-progress
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped. -->

**Input**: User bug report (2026-07-15, iPhone screenshots): after spec 2036, a
failing video post puts the installed app into a never-ending crash loop on the
Wall tab — iOS shows "A problem repeatedly occurred on …/tabs/wall", the pending
card no longer offers Cancel/Finish, and it auto-retries forever.

## Diagnosis

Spec 2036 made startup recovery leave byte-backed 'uploading' records for the
drain to resume — correct for the zombie-draft bug, but it removed the only
brake the old behavior accidentally provided (draft-ifying on every launch).
`uploadOne` increments `attempts` and NOTHING ever consults it: on a device
where the resumed transcode of a large video exhausts the web view's memory,
WebKit kills the page, the reload auto-resumes the same record, and the loop
never converges — while the record stays 'uploading', so the user never gets
the failed/interrupted affordances to break out themselves.

## Requirements

- **FR-001**: Automatic drains MUST honor a per-record attempt budget: once
  `attempts` reaches the cap (3), the record flips to 'failed' with a clear
  reason BEFORE any heavy work runs — a crash-looping device breaks the loop on
  the first launch past the budget, with Retry/Cancel visible again.
- **FR-002**: A manual Retry keeps resetting the budget (existing behavior),
  so the user can always try again deliberately.
- **FR-003**: The budget check MUST precede the transcode/upload (the loop must
  break even when the heavy work itself is what crashes the app).

## Success Criteria

- **SC-001**: Unit tests pin: a record at the cap is marked failed without
  createPost running; below the cap it uploads; manual retry resets and runs.
- **SC-002**: The reporter's device recovers: after updating, the Wall loads,
  the stuck post shows a failed card with Retry/Cancel, and the app stays up.
