package store

import "context"

// PushSubscription is a browser Web Push subscription. InstalledVersion + TZOffsetMinutes
// are the per-device metadata for the 9-AM-local version announcement (spec 1016); they
// are zero/empty on subscriptions that haven't reported them and on read paths that don't
// select them.
type PushSubscription struct {
	Endpoint         string
	P256dh           string
	Auth             string
	InstalledVersion string
	TZOffsetMinutes  int
}

// SaveSubscription stores the user's ONE push subscription, overwriting any previous one
// (single active device by design — see migration 0026). The table is keyed on user_id, so a
// new or rotated endpoint replaces the old row rather than adding another, which is also how a
// login from a second device revokes the first's push: registering the new subscription drops
// the old endpoint. The keys are always refreshed; installedVersion / tzOffsetMinutes (the
// client's reported app version + coarse local UTC offset) are updated ONLY when provided
// (non-nil), so a version-less re-subscribe (the service-worker resubscribe path) preserves
// the values the page reported (COALESCE). last_announced_version is never written here — only
// the version scheduler sets it.
func (s *Store) SaveSubscription(ctx context.Context, userID string, sub PushSubscription, installedVersion *string, tzOffsetMinutes *int) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, installed_version, tz_offset_minutes)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (user_id) DO UPDATE SET
		     endpoint = EXCLUDED.endpoint,
		     p256dh = EXCLUDED.p256dh,
		     auth = EXCLUDED.auth,
		     installed_version = COALESCE(EXCLUDED.installed_version, push_subscriptions.installed_version),
		     tz_offset_minutes = COALESCE(EXCLUDED.tz_offset_minutes, push_subscriptions.tz_offset_minutes)`,
		userID, sub.Endpoint, sub.P256dh, sub.Auth, installedVersion, tzOffsetMinutes)
	return err
}

// DeleteSubscription removes one of a user's subscriptions (on unsubscribe).
func (s *Store) DeleteSubscription(ctx context.Context, userID, endpoint string) error {
	_, err := s.pool.Exec(ctx,
		`DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2`, userID, endpoint)
	return err
}

// DeleteSubscriptionByEndpoint removes a dead subscription (push service returned
// 404/410), regardless of owner.
func (s *Store) DeleteSubscriptionByEndpoint(ctx context.Context, endpoint string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM push_subscriptions WHERE endpoint = $1`, endpoint)
	return err
}

// SubscriptionsFor returns all of a user's push subscriptions.
func (s *Store) SubscriptionsFor(ctx context.Context, userID string) ([]PushSubscription, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PushSubscription
	for rows.Next() {
		var sub PushSubscription
		if err := rows.Scan(&sub.Endpoint, &sub.P256dh, &sub.Auth); err != nil {
			return nil, err
		}
		out = append(out, sub)
	}
	return out, rows.Err()
}

// SubscriptionsBehind returns the candidate subscriptions for a version announcement: those
// that have reported a version AND a timezone offset, whose installed version differs from
// currentVersion (behind), and that have not already been announced for currentVersion
// (once-per-release dedup). The local-09:00 filter is applied in Go (dueAtNine) so it stays
// unit-testable; this is the cheap SQL pre-filter. Each row carries its TZOffsetMinutes.
func (s *Store) SubscriptionsBehind(ctx context.Context, currentVersion string) ([]PushSubscription, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT endpoint, p256dh, auth, COALESCE(tz_offset_minutes, 0)
		   FROM push_subscriptions
		  WHERE installed_version IS NOT NULL
		    AND tz_offset_minutes IS NOT NULL
		    AND installed_version <> $1
		    AND (last_announced_version IS NULL OR last_announced_version <> $1)`, currentVersion)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PushSubscription
	for rows.Next() {
		var sub PushSubscription
		if err := rows.Scan(&sub.Endpoint, &sub.P256dh, &sub.Auth, &sub.TZOffsetMinutes); err != nil {
			return nil, err
		}
		out = append(out, sub)
	}
	return out, rows.Err()
}

// MarkAnnounced records that this subscription was sent the announcement for `version`,
// so it isn't notified again for the same release (dedup-on-send).
func (s *Store) MarkAnnounced(ctx context.Context, endpoint, version string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE push_subscriptions SET last_announced_version = $2 WHERE endpoint = $1`,
		endpoint, version)
	return err
}
