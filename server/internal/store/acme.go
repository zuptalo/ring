package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// GetACME returns a cached ACME blob by key. found=false if absent. The bytes are
// opaque to the store (encrypted by the caller).
func (s *Store) GetACME(ctx context.Context, key string) ([]byte, bool, error) {
	var b []byte
	err := s.pool.QueryRow(ctx, `SELECT data FROM acme_cache WHERE key = $1`, key).Scan(&b)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return b, true, nil
}

// PutACME upserts a cached ACME blob.
func (s *Store) PutACME(ctx context.Context, key string, data []byte) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO acme_cache (key, data) VALUES ($1, $2)
		 ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
		key, data)
	return err
}

// DeleteACME removes a cached ACME blob (no-op if absent).
func (s *Store) DeleteACME(ctx context.Context, key string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM acme_cache WHERE key = $1`, key)
	return err
}

// DeleteACMEExcept removes every cached ACME blob whose key does NOT begin with
// keepPrefix, returning how many rows were removed. It is used to sweep account
// keys + certs left over from a different ACME environment (e.g. staging) once
// the server is pointed at another directory (e.g. production).
func (s *Store) DeleteACMEExcept(ctx context.Context, keepPrefix string) (int64, error) {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM acme_cache WHERE left(key, char_length($1)) <> $1`, keepPrefix)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
