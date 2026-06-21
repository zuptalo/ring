package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

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
	return s.querySubscriptions(ctx,
		`SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`, userID)
}

// AllSubscriptions returns every push subscription across all users — used for the
// version-announcement broadcast (the only fan-out that isn't addressed to one user).
func (s *Store) AllSubscriptions(ctx context.Context) ([]PushSubscription, error) {
	return s.querySubscriptions(ctx, `SELECT endpoint, p256dh, auth FROM push_subscriptions`)
}

func (s *Store) querySubscriptions(ctx context.Context, q string, args ...any) ([]PushSubscription, error) {
	rows, err := s.pool.Query(ctx, q, args...)
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

// GetAppMeta reads a server-side metadata value (empty string if the key is absent).
func (s *Store) GetAppMeta(ctx context.Context, key string) (string, error) {
	var v string
	err := s.pool.QueryRow(ctx, `SELECT value FROM app_meta WHERE key = $1`, key).Scan(&v)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil
		}
		return "", err
	}
	return v, nil
}

// SetAppMeta upserts a server-side metadata value.
func (s *Store) SetAppMeta(ctx context.Context, key, value string) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO app_meta (key, value) VALUES ($1, $2)
		 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
		key, value)
	return err
}
