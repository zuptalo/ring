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
