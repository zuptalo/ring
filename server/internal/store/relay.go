package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// RelayItem is one queued, undelivered frame for a recipient.
type RelayItem struct {
	Seq     int64
	Sender  string
	MsgID   string
	Payload []byte
}

// EnqueueRelay stores a delivered-frame payload for a recipient. Idempotent on
// (recipient, msg_id) so a resend of the same message doesn't duplicate.
func (s *Store) EnqueueRelay(ctx context.Context, recipient, sender, msgID string, payload []byte) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO relay_queue (recipient, sender, msg_id, payload)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (recipient, msg_id) DO NOTHING`,
		recipient, sender, msgID, payload)
	return err
}

// PendingForRecipient returns all queued frames for a recipient, oldest first.
func (s *Store) PendingForRecipient(ctx context.Context, recipient string) ([]RelayItem, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT seq, sender::text, msg_id, payload FROM relay_queue WHERE recipient = $1 ORDER BY seq`, recipient)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []RelayItem
	for rows.Next() {
		var it RelayItem
		if err := rows.Scan(&it.Seq, &it.Sender, &it.MsgID, &it.Payload); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

// OldestPendingForRecipient returns the age of the oldest queued frame for a
// recipient and the total queued count - zero-knowledge metadata for the client's
// zombie self-heal (spec 2043). oldestMs is the oldest frame's created_at in epoch
// milliseconds, 0 when the queue is empty. No payload ever leaves the server here;
// only a server timestamp and a count, so the client can tell "the server is holding
// messages I never woke for" without decrypting anything.
func (s *Store) OldestPendingForRecipient(ctx context.Context, recipient string) (oldestMs int64, count int, err error) {
	err = s.pool.QueryRow(ctx,
		`SELECT COALESCE(EXTRACT(EPOCH FROM min(created_at)) * 1000, 0)::bigint, count(*)
		   FROM relay_queue WHERE recipient = $1`,
		recipient).Scan(&oldestMs, &count)
	return oldestMs, count, err
}

// CountZombieFleet counts recipients who hold a push subscription yet carry unacked
// relay frames older than staleAge - the server-side signature of a "zombie"
// subscription (spec 2043): the upstream push service still 201-accepts every send,
// but the device never wakes to drain, so frames pile up unacked. Emitted periodically
// from the sweep loop for operator visibility (and a before/after handle on the fix).
func (s *Store) CountZombieFleet(ctx context.Context, staleAge time.Duration) (int64, error) {
	var n int64
	err := s.pool.QueryRow(ctx,
		`SELECT count(DISTINCT rq.recipient)
		   FROM relay_queue rq
		   JOIN push_subscriptions ps ON ps.user_id = rq.recipient
		  WHERE rq.created_at < now() - make_interval(secs => $1)`,
		staleAge.Seconds()).Scan(&n)
	return n, err
}

// SweepRelayOlderThan deletes queued frames older than age, returning the number
// removed. The service worker's preview path never acks (and even the spec-1032
// authoritative drain acks only what it durably committed, leaving deferred frame
// types queued), so a recipient who never opens the app would otherwise accumulate
// frames forever. Payloads are E2EE and idempotent (unique on recipient,msg_id), so
// aging one out only risks a stale notification - never message loss for a
// recipient who actually returns (the page WS-drains everything still present).
// Keep age >= the push TTL so a long-held tickle always still has a frame to fetch.
func (s *Store) SweepRelayOlderThan(ctx context.Context, age time.Duration) (int64, error) {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM relay_queue WHERE created_at < now() - make_interval(secs => $1)`,
		age.Seconds())
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// DeleteRelay removes a queued message by (recipient, msgID), returning the
// original sender so the relay can send them a delivery receipt. found=false if
// nothing matched (e.g. a duplicate ack).
func (s *Store) DeleteRelay(ctx context.Context, recipient, msgID string) (sender string, found bool, err error) {
	err = s.pool.QueryRow(ctx,
		`DELETE FROM relay_queue WHERE recipient = $1 AND msg_id = $2 RETURNING sender::text`,
		recipient, msgID).Scan(&sender)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return sender, true, nil
}
