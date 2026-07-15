# Feature Specification: Boot-Loop Safe Mode

**Feature Branch**: `fix/2039-boot-loop-safe`

**Created**: 2026-07-15

**Status**: in-progress
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped. -->

**Input**: Field incident (2026-07-15): an iPhone stuck on an old build crash-
looped at boot (background upload OOM), and BECAUSE the crash came so early the
update toast never survived long enough to be tapped — the device could not
even receive the build containing the fix. The app needs a self-rescue path
that requires nothing from the crashed feature itself.

## Requirements

- **FR-001**: The app MUST detect a boot crash-loop generically: a persisted
  boot counter increments at startup and resets only after a healthy-uptime
  window (20s); reaching 3 without a healthy boot enters SAFE MODE for the next
  launch.
- **FR-002**: Safe mode MUST pause deferrable background work for that boot —
  the pending-post drain and pending media resumes — and tell the user plainly
  ("Background work is paused after repeated restarts").
- **FR-003**: Safe mode MUST auto-apply a WAITING app update immediately (no
  toast interaction), since escaping a broken build is exactly what the mode is
  for; the installed registerType:'prompt' behavior stays for healthy boots.
- **FR-004**: A healthy safe-mode boot (20s uptime) clears the counter; the
  next boot is normal — safe mode is one boot's shield, not a latch.

## Success Criteria

- **SC-001**: Unit tests pin the counter/threshold/reset logic (pure module).
- **SC-002**: With the drain gated off in safe mode, a seeded heavy outbox
  record does not start uploading on a safe-mode boot (unit-level gate check).
