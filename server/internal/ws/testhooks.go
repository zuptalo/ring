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
