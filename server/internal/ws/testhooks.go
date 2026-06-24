package ws

import (
	"time"

	"ring/server/internal/call"
)

// SetGroupRingCadenceForTest overrides the group-ring reminder cadence for tests and
// returns a restore func. Test-only helper; production uses the package defaults.
func SetGroupRingCadenceForTest(interval time.Duration, count int) func() {
	pi, pc := groupRingInterval, groupRingCount
	groupRingInterval, groupRingCount = interval, count
	return func() { groupRingInterval, groupRingCount = pi, pc }
}

// SetVideoMaxForTest overrides the video participant cap (server side, via the call pkg)
// for tests and returns a restore func, so a cap test needs only a few participants.
func SetVideoMaxForTest(n int) func() {
	prev := call.VideoMax
	call.VideoMax = n
	return func() { call.VideoMax = prev }
}

// SetCallRecoveryGraceForTest shrinks the disconnect-eviction grace so tests don't wait the
// production window; returns a restore func.
func SetCallRecoveryGraceForTest(d time.Duration) func() {
	prev := callRecoveryGrace
	callRecoveryGrace = d
	return func() { callRecoveryGrace = prev }
}

// SetAudioMaxForTest overrides the audio participant cap, mirroring SetVideoMaxForTest.
func SetAudioMaxForTest(n int) func() {
	prev := call.AudioMax
	call.AudioMax = n
	return func() { call.AudioMax = prev }
}

// ApplyTestCallConfig sets every call tunable at once. It backs the dev/e2e-only
// POST /v1/dev/call-config endpoint so a Playwright test can shrink the participant caps and
// the ring/recovery windows — instead of spinning many browser contexts or waiting the full
// production cadence. Absolute values (not deltas): pass the production defaults to reset.
func ApplyTestCallConfig(videoMax, audioMax, ringCount int, ringInterval, recoveryGrace time.Duration) {
	call.VideoMax = videoMax
	call.AudioMax = audioMax
	groupRingCount = ringCount
	groupRingInterval = ringInterval
	callRecoveryGrace = recoveryGrace
}
