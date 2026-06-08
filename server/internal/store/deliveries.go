package store

import (
	"context"
	"time"
)

// Durable delivery records (see migration 0019): a message's sender can reconcile
// its 'delivered' state on reconnect even if the receipt was dropped while it was
// offline.

// RecordDelivery durably notes that msgID (from sender) reached recipient.
// Idempotent; no-op on empty ids.
func (s *Store) RecordDelivery(ctx context.Context, sender, recipient, msgID string) error {
	if sender == "" || recipient == "" || msgID == "" {
		return nil
	}
	_, err := s.pool.Exec(ctx,
		`INSERT INTO deliveries (sender, recipient, msg_id) VALUES ($1, $2, $3)
		 ON CONFLICT (sender, recipient, msg_id) DO NOTHING`, sender, recipient, msgID)
	return err
}

// Delivery is one (msg_id, recipient) confirmation for the querying sender.
type Delivery struct {
	MsgID       string
	Recipient   string
	DeliveredMs int64
}

// DeliveriesFor returns the recorded deliveries for `sender` among the given message
// ids (a group message has one row per recipient).
func (s *Store) DeliveriesFor(ctx context.Context, sender string, msgIDs []string) ([]Delivery, error) {
	if len(msgIDs) == 0 {
		return nil, nil
	}
	rows, err := s.pool.Query(ctx,
		`SELECT msg_id, recipient::text, (extract(epoch from delivered_at)*1000)::bigint
		   FROM deliveries WHERE sender::text = $1 AND msg_id = ANY($2)`, sender, msgIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Delivery
	for rows.Next() {
		var d Delivery
		if err := rows.Scan(&d.MsgID, &d.Recipient, &d.DeliveredMs); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// SweepDeliveriesOlderThan deletes delivery records older than age, returning how
// many were removed. Bounds the table like the relay-queue sweep.
func (s *Store) SweepDeliveriesOlderThan(ctx context.Context, age time.Duration) (int64, error) {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM deliveries WHERE delivered_at < now() - make_interval(secs => $1)`, age.Seconds())
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
