package store

import (
	"context"
	"errors"

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
