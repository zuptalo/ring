package store

import (
	"context"
	"time"
)

// Durable seen records (see migration 0020), the symmetric twin of deliveries: a
// message's sender can reconcile its 'seen' state on reconnect even if the receipt
// was dropped while it was offline (spec 1010). Same metadata shape as deliveries —
// routing ids + a timestamp, no message content.

// RecordSeen durably notes that msgID (from sender) was seen by recipient.
// Idempotent; no-op on empty ids.
func (s *Store) RecordSeen(ctx context.Context, sender, recipient, msgID string) error {
	if sender == "" || recipient == "" || msgID == "" {
		return nil
	}
	_, err := s.pool.Exec(ctx,
		`INSERT INTO seen (sender, recipient, msg_id) VALUES ($1, $2, $3)
		 ON CONFLICT (sender, recipient, msg_id) DO NOTHING`, sender, recipient, msgID)
	return err
}

// Seen is one (msg_id, recipient) seen-confirmation for the querying sender.
type Seen struct {
	MsgID     string
	Recipient string
	SeenMs    int64
}

// SeenFor returns the recorded seen receipts for `sender` among the given message
// ids (a group message has one row per member who has seen it).
func (s *Store) SeenFor(ctx context.Context, sender string, msgIDs []string) ([]Seen, error) {
	if len(msgIDs) == 0 {
		return nil, nil
	}
	rows, err := s.pool.Query(ctx,
		`SELECT msg_id, recipient::text, (extract(epoch from seen_at)*1000)::bigint
		   FROM seen WHERE sender::text = $1 AND msg_id = ANY($2)`, sender, msgIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Seen
	for rows.Next() {
		var sn Seen
		if err := rows.Scan(&sn.MsgID, &sn.Recipient, &sn.SeenMs); err != nil {
			return nil, err
		}
		out = append(out, sn)
	}
	return out, rows.Err()
}

// SweepSeenOlderThan deletes seen records older than age, returning how many were
// removed. Bounds the table like the deliveries sweep (retention parity).
func (s *Store) SweepSeenOlderThan(ctx context.Context, age time.Duration) (int64, error) {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM seen WHERE seen_at < now() - make_interval(secs => $1)`, age.Seconds())
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
