package push

import (
	"context"
	"sync"
	"testing"
	"time"

	"ring/server/internal/store"
)

// fakeSchedStore is an in-memory VersionSchedStore: `behind` are the already-behind
// candidates (the real SQL applies the behind/non-null pre-filter); SubscriptionsBehind
// additionally drops any endpoint already announced for the queried version (mimicking the
// last_announced_version dedup clause).
type fakeSchedStore struct {
	mu        sync.Mutex
	behind    []store.PushSubscription
	announced map[string]string // endpoint -> version
}

func (f *fakeSchedStore) SubscriptionsBehind(_ context.Context, current string) ([]store.PushSubscription, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []store.PushSubscription
	for _, s := range f.behind {
		if f.announced[s.Endpoint] != current {
			out = append(out, s)
		}
	}
	return out, nil
}

func (f *fakeSchedStore) MarkAnnounced(_ context.Context, endpoint, version string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.announced == nil {
		f.announced = map[string]string{}
	}
	f.announced[endpoint] = version
	return nil
}

type recordingSender struct {
	mu   sync.Mutex
	sent []string
}

func (r *recordingSender) SendVersion(_ context.Context, sub store.PushSubscription) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sent = append(r.sent, sub.Endpoint)
}
func (r *recordingSender) sentEndpoints() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.sent...)
}

func schedSub(ep string, tzOffsetMinutes int) store.PushSubscription {
	return store.PushSubscription{Endpoint: ep, P256dh: "x", Auth: "y", TZOffsetMinutes: tzOffsetMinutes}
}
func utc(h, m int) time.Time { return time.Date(2026, 6, 22, h, m, 0, 0, time.UTC) }
func contains(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}

// TestDueAtNine: a subscription is selected iff its LOCAL hour (UTC − tz offset) is 09.
func TestDueAtNine(t *testing.T) {
	cases := []struct {
		name       string
		tz         int
		nowH, nowM int
		want       bool
	}{
		{"UTC 09:30 → local 09:30", 0, 9, 30, true},
		{"EST(+300) 14:15 → local 09:15", 300, 14, 15, true},
		{"CEST(-120) 07:00 → local 09:00", -120, 7, 0, true},
		{"IST(-330 half-hour, UTC+5:30) 03:30 → local 09:00", -330, 3, 30, true},
		{"UTC 08:30 → local 08:30", 0, 8, 30, false},
		{"UTC 10:00 → local 10:00", 0, 10, 0, false},
		{"EST(+300) 13:30 → local 08:30", 300, 13, 30, false},
	}
	for _, c := range cases {
		got := dueAtNine([]store.PushSubscription{schedSub("e", c.tz)}, utc(c.nowH, c.nowM))
		if sel := len(got) == 1; sel != c.want {
			t.Errorf("%s: selected=%v, want %v", c.name, sel, c.want)
		}
	}
}

// TestSweepSelectsDueOnly: among behind candidates, only those at local 09:00 are sent; a
// dev/empty version sends nothing.
func TestSweepSelectsDueOnly(t *testing.T) {
	st := &fakeSchedStore{behind: []store.PushSubscription{
		schedSub("at9", 0),   // local 09:30 at 09:30 UTC → due
		schedSub("not9", 60), // local 08:30 at 09:30 UTC → not due
	}}
	sender := &recordingSender{}
	SweepVersionAnnouncements(context.Background(), st, sender, "v2", utc(9, 30))
	got := sender.sentEndpoints()
	if len(got) != 1 || !contains(got, "at9") || contains(got, "not9") {
		t.Errorf("sent=%v; want only [at9]", got)
	}

	// A local `dev`/empty version is a no-op.
	dev := &recordingSender{}
	SweepVersionAnnouncements(context.Background(), st, dev, "dev", utc(9, 30))
	SweepVersionAnnouncements(context.Background(), st, dev, "", utc(9, 30))
	if n := len(dev.sentEndpoints()); n != 0 {
		t.Errorf("dev/empty version sent %d, want 0", n)
	}
}

// TestSweepDedupOncePerRelease: a device is sent once for a version; a second sweep at its
// 09:00 does not re-send; a NEWER version makes it eligible again exactly once.
func TestSweepDedupOncePerRelease(t *testing.T) {
	st := &fakeSchedStore{behind: []store.PushSubscription{schedSub("d", 0)}}
	sender := &recordingSender{}

	SweepVersionAnnouncements(context.Background(), st, sender, "v2", utc(9, 30))
	if n := len(sender.sentEndpoints()); n != 1 {
		t.Fatalf("first sweep sent %d, want 1", n)
	}
	SweepVersionAnnouncements(context.Background(), st, sender, "v2", utc(9, 30))
	if n := len(sender.sentEndpoints()); n != 1 {
		t.Errorf("second sweep (same version) total sent %d, want 1 (deduped)", n)
	}
	SweepVersionAnnouncements(context.Background(), st, sender, "v3", utc(9, 30))
	if n := len(sender.sentEndpoints()); n != 2 {
		t.Errorf("after newer version, total sent %d, want 2 (one more)", n)
	}
}
