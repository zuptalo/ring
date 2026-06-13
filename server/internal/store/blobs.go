package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// PutBlob stores ciphertext bytes under an id owned by a user.
func (s *Store) PutBlob(ctx context.Context, id, owner string, bytes []byte) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO blobs (id, owner, bytes, size) VALUES ($1, $2, $3, $4)`,
		id, owner, bytes, len(bytes))
	return err
}

// GetBlob returns the ciphertext bytes for an id. found=false if absent.
func (s *Store) GetBlob(ctx context.Context, id string) ([]byte, bool, error) {
	var bytes []byte
	err := s.pool.QueryRow(ctx, `SELECT bytes FROM blobs WHERE id = $1`, id).Scan(&bytes)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return bytes, true, nil
}

// DeleteBlobOwnedBy removes a blob, but only if `owner` uploaded it — so a leaked
// capability id can't be used to delete someone else's media. found=false if the blob is
// absent or owned by another user (both look the same to the caller, which is fine: the
// only legitimate deleter is the owner, and idempotent re-deletes are a no-op). Used by the
// sender once every recipient has downloaded the media, and on chat delete.
func (s *Store) DeleteBlobOwnedBy(ctx context.Context, id, owner string) (found bool, err error) {
	tag, err := s.pool.Exec(ctx, `DELETE FROM blobs WHERE id = $1 AND owner = $2`, id, owner)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// SweepBlobsOlderThan deletes up to `limit` of the oldest blobs created before now-age, and
// returns how many it removed. The backstop for media whose recipients never download it (so
// the sender-driven precise delete never fires): kept at/above the relay-queue retention so
// any still-deliverable envelope still has a fetchable blob. Batched (LIMIT) so reclaiming a
// large historical backlog never runs as one table-locking transaction — the caller loops
// until it returns < limit.
func (s *Store) SweepBlobsOlderThan(ctx context.Context, age time.Duration, limit int) (int64, error) {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM blobs WHERE id IN (
		   SELECT id FROM blobs WHERE created_at < now() - make_interval(secs => $1)
		   ORDER BY created_at LIMIT $2
		 )`,
		age.Seconds(), limit)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

