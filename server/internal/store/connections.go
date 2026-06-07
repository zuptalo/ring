package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// Connection lifecycle (the server-enforced connect-request graph). A pair is
// "connected" when an accepted row exists in either direction and neither has
// blocked the other; that predicate gates 1:1 message delivery and presence.

// Connected reports whether a and b have an accepted connection (either direction)
// and neither has blocked the other.
func (s *Store) Connected(ctx context.Context, a, b string) (bool, error) {
	var ok bool
	err := s.pool.QueryRow(ctx,
		`SELECT EXISTS (
		     SELECT 1 FROM connections c
		      WHERE c.state = 'accepted'
		        AND ((c.requester::text = $1 AND c.target::text = $2)
		          OR (c.requester::text = $2 AND c.target::text = $1))
		        AND NOT EXISTS (
		            SELECT 1 FROM blocks bl
		             WHERE (bl.blocker::text = $1 AND bl.blocked::text = $2)
		                OR (bl.blocker::text = $2 AND bl.blocked::text = $1)))`, a, b).Scan(&ok)
	return ok, err
}

// ConnectionState returns the state ('pending' | 'accepted' | 'rejected') of the
// connection FROM requester TO target, or "" when no such row exists.
func (s *Store) ConnectionState(ctx context.Context, requester, target string) (string, error) {
	var state string
	err := s.pool.QueryRow(ctx,
		`SELECT state FROM connections WHERE requester::text = $1 AND target::text = $2`,
		requester, target).Scan(&state)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil
		}
		return "", err
	}
	return state, nil
}

// RequestConnection records (or re-opens) a pending request from requester to
// target. No-op self-edge; leaves an already-accepted pair accepted. Returns the
// resulting state so the caller can short-circuit when already connected.
func (s *Store) RequestConnection(ctx context.Context, requester, target string) (string, error) {
	if requester == target {
		return "", nil
	}
	// If the OTHER direction is already accepted, this pair is connected - reflect that.
	if connected, err := s.Connected(ctx, requester, target); err != nil {
		return "", err
	} else if connected {
		return "accepted", nil
	}
	var state string
	err := s.pool.QueryRow(ctx,
		`INSERT INTO connections (requester, target, state) VALUES ($1, $2, 'pending')
		 ON CONFLICT (requester, target) DO UPDATE SET
		     state = CASE WHEN connections.state = 'accepted' THEN 'accepted' ELSE 'pending' END,
		     updated_at = now()
		 RETURNING state`, requester, target).Scan(&state)
	return state, err
}

// AcceptConnection marks the request requester->target accepted (target accepts).
func (s *Store) AcceptConnection(ctx context.Context, target, requester string) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO connections (requester, target, state) VALUES ($1, $2, 'accepted')
		 ON CONFLICT (requester, target) DO UPDATE SET state = 'accepted', updated_at = now()`,
		requester, target)
	return err
}

// RejectConnection marks the request requester->target rejected. When block is true
// it also blocks the requester, so they can no longer see target in the directory or
// its presence (and the request shows as rejected for them).
func (s *Store) RejectConnection(ctx context.Context, target, requester string, block bool) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx,
		`INSERT INTO connections (requester, target, state) VALUES ($1, $2, 'rejected')
		 ON CONFLICT (requester, target) DO UPDATE SET state = 'rejected', updated_at = now()`,
		requester, target); err != nil {
		return err
	}
	if block {
		if _, err := tx.Exec(ctx,
			`INSERT INTO blocks (blocker, blocked) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
			target, requester); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// ConnectionReq is one row in an incoming/outgoing request list.
type ConnectionReq struct {
	Requester string
	Target    string
	State     string
	UpdatedMs int64
}

// IncomingRequests returns pending requests addressed TO user (people awaiting their
// accept), newest first.
func (s *Store) IncomingRequests(ctx context.Context, user string) ([]ConnectionReq, error) {
	return s.listRequests(ctx,
		`SELECT requester::text, target::text, state, (extract(epoch from updated_at)*1000)::bigint
		   FROM connections WHERE target::text = $1 AND state = 'pending' ORDER BY updated_at DESC`, user)
}

// OutgoingRequests returns the requests user SENT that are still pending or were
// rejected (so the UI can show "requested" / "rejected"), newest first.
func (s *Store) OutgoingRequests(ctx context.Context, user string) ([]ConnectionReq, error) {
	return s.listRequests(ctx,
		`SELECT requester::text, target::text, state, (extract(epoch from updated_at)*1000)::bigint
		   FROM connections WHERE requester::text = $1 AND state IN ('pending','rejected')
		   ORDER BY updated_at DESC`, user)
}

func (s *Store) listRequests(ctx context.Context, q, arg string) ([]ConnectionReq, error) {
	rows, err := s.pool.Query(ctx, q, arg)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ConnectionReq
	for rows.Next() {
		var r ConnectionReq
		if err := rows.Scan(&r.Requester, &r.Target, &r.State, &r.UpdatedMs); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
