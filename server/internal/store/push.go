package store

import "context"

// PushSubscription is a browser Web Push subscription.
type PushSubscription struct {
	Endpoint string
	P256dh   string
	Auth     string
}

// SaveSubscription upserts a push subscription for a user (idempotent on the
// endpoint, refreshing its keys).
func (s *Store) SaveSubscription(ctx context.Context, userID string, sub PushSubscription) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (user_id, endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
		userID, sub.Endpoint, sub.P256dh, sub.Auth)
	return err
}

// DeleteSubscription removes one of a user's subscriptions (on unsubscribe).
func (s *Store) DeleteSubscription(ctx context.Context, userID, endpoint string) error {
	_, err := s.pool.Exec(ctx,
		`DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2`, userID, endpoint)
	return err
}

// DeleteSubscriptionByEndpoint removes a dead subscription (push service
// returned 404/410), regardless of owner.
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
