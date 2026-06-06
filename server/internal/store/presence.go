package store

import "context"

// PresenceInfo is the durable presence state for one user. LastSeenMs is the
// epoch-millis of last_seen_at, or 0 when never set. OnlineTier / LastSeenTier are
// the user's visibility tiers ('everyone' | 'contacts' | 'nobody'); the relay
// gates what it reveals to a watcher accordingly (see hub.presenceFrame).
type PresenceInfo struct {
	LastSeenMs   int64
	OnlineTier   string
	LastSeenTier string
}

// SetPresencePrefs stores the user's presence visibility tiers (and keeps the
// legacy share_* booleans in sync as on/off mirrors).
func (s *Store) SetPresencePrefs(ctx context.Context, userID, onlineTier, lastSeenTier string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE users
		    SET online_tier = $2, last_seen_tier = $3,
		        share_online = ($2 <> 'nobody'), share_last_seen = ($3 <> 'nobody')
		  WHERE id::text = $1`,
		userID, normalizeTier(onlineTier), normalizeTier(lastSeenTier))
	return err
}

// normalizeTier clamps an incoming tier string to a known value (defaults to
// 'everyone' for anything unexpected - never silently hide presence on bad input).
func normalizeTier(t string) string {
	switch t {
	case "everyone", "contacts", "nobody":
		return t
	default:
		return "everyone"
	}
}

// TouchLastSeen sets last_seen_at = now() for the user (best-effort; called on
// connect and on every transition to offline).
func (s *Store) TouchLastSeen(ctx context.Context, userID string) error {
	_, err := s.pool.Exec(ctx, `UPDATE users SET last_seen_at = now() WHERE id::text = $1`, userID)
	return err
}

// GetPresence returns presence info for each requested user id. Missing ids are
// simply absent from the map. Compared as text to avoid uuid[] encoding.
func (s *Store) GetPresence(ctx context.Context, ids []string) (map[string]PresenceInfo, error) {
	out := make(map[string]PresenceInfo, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := s.pool.Query(ctx,
		`SELECT id::text,
		        COALESCE(EXTRACT(EPOCH FROM last_seen_at) * 1000, 0)::bigint,
		        online_tier, last_seen_tier
		 FROM users WHERE id::text = ANY($1)`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var pi PresenceInfo
		if err := rows.Scan(&id, &pi.LastSeenMs, &pi.OnlineTier, &pi.LastSeenTier); err != nil {
			return nil, err
		}
		out[id] = pi
	}
	return out, rows.Err()
}
