package push

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"ring/server/internal/store"
)

// Daytime-local version-announcement scheduler (spec 1016). The on-boot all-device broadcast
// is gone; instead a periodic sweep sends the content-free version push to each device that is
// BEHIND the current version, once per release, during waking hours in that device's local time.
// A device that falls behind during the day is told that day; one behind overnight waits until
// the window reopens at 09:00 — so an announcement never arrives in the middle of the night.

const (
	// Local-time send window [start, end): a release reaches a device the first sweep tick its
	// local clock is inside this window. Behind-at-2pm → that afternoon; behind-at-2am → 09:00.
	sendWindowStartHour = 9  // inclusive — also the "held overnight, sent next morning" time
	sendWindowEndHour   = 17 // exclusive — after this, hold until the window reopens at 09:00
)

// dueInSendWindow returns the subscriptions whose LOCAL time falls in the daytime send window,
// given the current UTC time. JavaScript getTimezoneOffset() = UTC − local, so local = UTC −
// offset. Pure + clock-injected, so the timezone math is unit-testable without a DB or real time.
func dueInSendWindow(subs []store.PushSubscription, nowUTC time.Time) []store.PushSubscription {
	out := make([]store.PushSubscription, 0, len(subs))
	for _, s := range subs {
		local := nowUTC.Add(-time.Duration(s.TZOffsetMinutes) * time.Minute)
		if h := local.Hour(); h >= sendWindowStartHour && h < sendWindowEndHour {
			out = append(out, s)
		}
	}
	return out
}

// VersionSchedStore is the persistence the version sweep needs (satisfied by *store.Store).
type VersionSchedStore interface {
	SubscriptionsBehind(ctx context.Context, currentVersion string) ([]store.PushSubscription, error)
	MarkAnnounced(ctx context.Context, endpoint, version string) error
}

// VersionSender delivers a version tickle to one subscription (satisfied by *Notifier).
type VersionSender interface {
	SendVersion(ctx context.Context, sub store.PushSubscription)
}

// SweepVersionAnnouncements is one tick of the scheduler: for every device that is BEHIND
// the current version (SubscriptionsBehind already excludes up-to-date / already-announced
// ones) AND whose LOCAL time is within the daytime send window, send the version push and
// mark it announced (dedup-on-send → once per release; the short TTL means a push that races
// the window edge expires rather than arriving at night). No-op on a dev/empty version.
// Bounded concurrency; panic-safe so a bad tick can never crash the server.
func SweepVersionAnnouncements(ctx context.Context, st VersionSchedStore, sender VersionSender, currentVersion string, nowUTC time.Time) {
	defer recoverLog("push: version sweep")
	if currentVersion == "" || currentVersion == "dev" {
		return
	}
	behind, err := st.SubscriptionsBehind(ctx, currentVersion)
	if err != nil {
		slog.Error("push: version sweep load behind", "err", err)
		return
	}
	due := dueInSendWindow(behind, nowUTC)
	if len(due) == 0 {
		return
	}
	sem := make(chan struct{}, versionSweepConcurrency)
	var wg sync.WaitGroup
	for _, sub := range due {
		wg.Add(1)
		sem <- struct{}{}
		go func(sub store.PushSubscription) {
			defer wg.Done()
			defer func() { <-sem }()
			defer recoverLog("push: version sweep deliver")
			sender.SendVersion(ctx, sub)
			// Dedup-on-send: mark regardless of delivery outcome (Web Push gives no
			// receipt; once-per-release is keyed on send, never on confirmed delivery).
			if err := st.MarkAnnounced(ctx, sub.Endpoint, currentVersion); err != nil {
				slog.Warn("push: version sweep mark announced", "err", err)
			}
		}(sub)
	}
	wg.Wait()
	// NFR-ZK-004: coarse count only — never a device's local time-of-day, endpoint, or
	// per-device send history.
	slog.Info("push: version announcement sweep", "sent", len(due))
}
