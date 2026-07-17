package store

import "context"

// Per-contact presence overrides: 'allow' (always show this watcher my presence) or
// 'deny' (never), layered on top of the global tier in the hub's gating.

// SetPresenceOverrides reconciles owner's overrides to exactly the given map
// (target -> 'allow'|'deny'); any target not present is cleared.
func (s *Store) SetPresenceOverrides(ctx context.Context, owner string, overrides map[string]string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `DELETE FROM presence_overrides WHERE owner::text = $1`, owner); err != nil {
		return err
	}
	for target, ov := range overrides {
		if target == "" || target == owner || (ov != "allow" && ov != "deny") {
			continue
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO presence_overrides (owner, target, override) VALUES ($1, $2, $3)
			 ON CONFLICT (owner, target) DO UPDATE SET override = EXCLUDED.override`,
			owner, target, ov); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// PresenceOverridesFor returns, for a watcher, the override each of `owners` set
// for THEM (owner -> 'allow'|'deny'), used to gate a presence-sub reply at once.
func (s *Store) PresenceOverridesFor(ctx context.Context, watcher string, owners []string) (map[string]string, error) {
	out := map[string]string{}
	if len(owners) == 0 {
		return out, nil
	}
	rows, err := s.pool.Query(ctx,
		`SELECT owner::text, override FROM presence_overrides
		  WHERE target::text = $1 AND owner::text = ANY($2)`, watcher, owners)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var o, ov string
		if err := rows.Scan(&o, &ov); err != nil {
			return nil, err
		}
		out[o] = ov
	}
	return out, rows.Err()
}

// PresenceOverrides returns owner's target->override map (for per-watcher gating).
func (s *Store) PresenceOverrides(ctx context.Context, owner string) (map[string]string, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT target::text, override FROM presence_overrides WHERE owner::text = $1`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var t, ov string
		if err := rows.Scan(&t, &ov); err != nil {
			return nil, err
		}
		out[t] = ov
	}
	return out, rows.Err()
}
