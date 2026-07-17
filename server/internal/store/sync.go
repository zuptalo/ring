package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// SyncRecordIn is one encrypted record pushed by a client.
type SyncRecordIn struct {
	Store      string
	RecordID   string
	UpdatedAt  int64
	Ciphertext string // opaque (base64 of the sealed record); "" when deleted
	Deleted    bool
}

// SyncRecordOut is one record returned by a pull, with its server seq.
type SyncRecordOut struct {
	Store      string
	RecordID   string
	UpdatedAt  int64
	Ciphertext string
	Deleted    bool
	Seq        int64
}

// PushRecords upserts encrypted records for a user, assigning each a fresh seq.
// Last-write-wins on updated_at: a push older than what's stored is ignored.
// Returns the highest seq assigned in this batch (0 if nothing changed).
func (s *Store) PushRecords(ctx context.Context, userID string, recs []SyncRecordIn) (int64, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var maxSeq int64
	for _, r := range recs {
		var seq int64
		err := tx.QueryRow(ctx,
			`INSERT INTO sync_records (user_id, store, record_id, seq, updated_at, ciphertext, deleted)
			 VALUES ($1, $2, $3, nextval('sync_seq'), $4, $5, $6)
			 ON CONFLICT (user_id, store, record_id) DO UPDATE SET
			   seq = nextval('sync_seq'),
			   updated_at = EXCLUDED.updated_at,
			   ciphertext = EXCLUDED.ciphertext,
			   deleted = EXCLUDED.deleted
			 WHERE EXCLUDED.updated_at >= sync_records.updated_at
			 RETURNING seq`,
			userID, r.Store, r.RecordID, r.UpdatedAt, r.Ciphertext, r.Deleted).Scan(&seq)
		if errors.Is(err, pgx.ErrNoRows) {
			continue // stale write, ignored by LWW
		}
		if err != nil {
			return 0, err
		}
		if seq > maxSeq {
			maxSeq = seq
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return maxSeq, nil
}

// PullRecords returns records changed after `cursor`, oldest first (up to
// limit), plus the new cursor (max seq returned, or the input cursor if none).
func (s *Store) PullRecords(ctx context.Context, userID string, cursor int64, limit int) ([]SyncRecordOut, int64, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT store, record_id, seq, updated_at, COALESCE(ciphertext, ''), deleted
		 FROM sync_records
		 WHERE user_id = $1 AND seq > $2
		 ORDER BY seq
		 LIMIT $3`, userID, cursor, limit)
	if err != nil {
		return nil, cursor, err
	}
	defer rows.Close()

	out := []SyncRecordOut{}
	newCursor := cursor
	for rows.Next() {
		var r SyncRecordOut
		if err := rows.Scan(&r.Store, &r.RecordID, &r.Seq, &r.UpdatedAt, &r.Ciphertext, &r.Deleted); err != nil {
			return nil, cursor, err
		}
		out = append(out, r)
		if r.Seq > newCursor {
			newCursor = r.Seq
		}
	}
	return out, newCursor, rows.Err()
}

/* ---- recovery wrap ---- */

// PutRecoveryWrap stores (or replaces) the user's recovery envelope + salt, plus
// the one-way lookup hash of the recovery code (so a new device can find the
// account from the code - see FindByRecoveryLookup).
func (s *Store) PutRecoveryWrap(ctx context.Context, userID, salt, envelope, lookup string) error {
	// NULLIF keeps an empty lookup as SQL NULL so the partial UNIQUE index never
	// collides on '' across legacy/pre-lookup uploads.
	_, err := s.pool.Exec(ctx,
		`INSERT INTO recovery_wraps (user_id, salt, envelope, lookup, updated_at)
		 VALUES ($1, $2, $3, NULLIF($4, ''), now())
		 ON CONFLICT (user_id) DO UPDATE SET
		   salt = EXCLUDED.salt, envelope = EXCLUDED.envelope, lookup = EXCLUDED.lookup, updated_at = now()`,
		userID, salt, envelope, lookup)
	return err
}

// FindByRecoveryLookup resolves a recovery-code lookup hash to its account's id
// and stored wrap. found=false if no account advertised that lookup.
func (s *Store) FindByRecoveryLookup(ctx context.Context, lookup string) (userID, salt, envelope string, found bool, err error) {
	err = s.pool.QueryRow(ctx,
		`SELECT user_id::text, salt, envelope FROM recovery_wraps WHERE lookup = $1`, lookup).
		Scan(&userID, &salt, &envelope)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", "", false, nil
	}
	if err != nil {
		return "", "", "", false, err
	}
	return userID, salt, envelope, true, nil
}

// GetRecoveryWrap returns the stored salt + envelope. found=false if absent.
func (s *Store) GetRecoveryWrap(ctx context.Context, userID string) (salt, envelope string, found bool, err error) {
	err = s.pool.QueryRow(ctx,
		`SELECT salt, envelope FROM recovery_wraps WHERE user_id = $1`, userID).Scan(&salt, &envelope)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", false, nil
	}
	if err != nil {
		return "", "", false, err
	}
	return salt, envelope, true, nil
}
