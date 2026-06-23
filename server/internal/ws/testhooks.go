package ws

import "time"

// SetGroupRingCadenceForTest overrides the group-ring reminder cadence for tests and
// returns a restore func. Test-only helper; production uses the package defaults.
func SetGroupRingCadenceForTest(interval time.Duration, count int) func() {
	pi, pc := groupRingInterval, groupRingCount
	groupRingInterval, groupRingCount = interval, count
	return func() { groupRingInterval, groupRingCount = pi, pc }
}
