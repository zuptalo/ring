package store

import "context"

// Block records that `blocker` has blocked `blocked` (idempotent) and purges any
// already-queued frames from the blocked party so they vanish immediately.
func (s *Store) Block(ctx context.Context, blocker, blocked string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx,
		`INSERT INTO blocks (blocker, blocked) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		blocker, blocked); err != nil {
		return err
	}
	// Drop anything the blocked user already had queued for the blocker.
	if _, err := tx.Exec(ctx,
		`DELETE FROM relay_queue WHERE recipient::text = $1 AND sender::text = $2`,
		blocker, blocked); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Unblock removes the block (idempotent).
func (s *Store) Unblock(ctx context.Context, blocker, blocked string) error {
	_, err := s.pool.Exec(ctx,
		`DELETE FROM blocks WHERE blocker::text = $1 AND blocked::text = $2`, blocker, blocked)
	return err
}

// ListBlocks returns the ids `blocker` has blocked (for start-up sync).
func (s *Store) ListBlocks(ctx context.Context, blocker string) ([]string, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT blocked::text FROM blocks WHERE blocker::text = $1`, blocker)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// IsBlocked reports whether `blocker` has blocked `blocked` - used by the relay
// (drop their messages) and the key-fetch endpoint (404 their bundle requests).
func (s *Store) IsBlocked(ctx context.Context, blocker, blocked string) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM blocks WHERE blocker::text = $1 AND blocked::text = $2)`,
		blocker, blocked).Scan(&exists)
	return exists, err
}
