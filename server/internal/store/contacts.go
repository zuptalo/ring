package store

import "context"

// SetContacts replaces `owner`'s outbound contact edges with exactly `contactIDs`
// (a reconcile, like the client's block-list sync). Self-edges are ignored.
func (s *Store) SetContacts(ctx context.Context, owner string, contactIDs []string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `DELETE FROM contacts WHERE owner::text = $1`, owner); err != nil {
		return err
	}
	for _, id := range contactIDs {
		if id == "" || id == owner {
			continue
		}
		// ON CONFLICT guards dupes in the input; the FK silently drops ids that
		// aren't real users (we cast text→uuid, so a malformed id errors - the
		// caller validates uuids first).
		if _, err := tx.Exec(ctx,
			`INSERT INTO contacts (owner, contact) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
			owner, id); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// PresenceAudience returns the set of user ids allowed to see `owner`'s presence
// under the 'contacts' tier: everyone with a contact edge to owner in EITHER
// direction (owner added them, or they added owner), minus any blocked pair.
func (s *Store) PresenceAudience(ctx context.Context, owner string) (map[string]bool, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT u FROM (
		     SELECT contact::text AS u FROM contacts WHERE owner::text = $1
		     UNION
		     SELECT owner::text   AS u FROM contacts WHERE contact::text = $1
		 ) e
		 WHERE NOT EXISTS (
		     SELECT 1 FROM blocks b
		      WHERE (b.blocker::text = $1 AND b.blocked::text = e.u)
		         OR (b.blocker::text = e.u AND b.blocked::text = $1))`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var u string
		if err := rows.Scan(&u); err != nil {
			return nil, err
		}
		out[u] = true
	}
	return out, rows.Err()
}

// ContactEdgesWith returns which of `targets` have a contact edge with `viewer`
// in either direction (minus blocked pairs) - used to gate a presence-sub reply
// for many targets at once.
func (s *Store) ContactEdgesWith(ctx context.Context, viewer string, targets []string) (map[string]bool, error) {
	out := map[string]bool{}
	if len(targets) == 0 {
		return out, nil
	}
	rows, err := s.pool.Query(ctx,
		`SELECT t FROM (
		     SELECT contact::text AS t FROM contacts WHERE owner::text = $1 AND contact::text = ANY($2)
		     UNION
		     SELECT owner::text   AS t FROM contacts WHERE contact::text = $1 AND owner::text = ANY($2)
		 ) e
		 WHERE NOT EXISTS (
		     SELECT 1 FROM blocks b
		      WHERE (b.blocker::text = $1 AND b.blocked::text = e.t)
		         OR (b.blocker::text = e.t AND b.blocked::text = $1))`, viewer, targets)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			return nil, err
		}
		out[t] = true
	}
	return out, rows.Err()
}
