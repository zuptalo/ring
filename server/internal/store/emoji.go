package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// GetEmoji returns a cached emoji asset by its upstream path. found=false if the
// asset has not been fetched + cached yet.
func (s *Store) GetEmoji(ctx context.Context, path string) (bytes []byte, contentType string, found bool, err error) {
	err = s.pool.QueryRow(ctx,
		`SELECT bytes, content_type FROM emoji_cache WHERE path = $1`, path).Scan(&bytes, &contentType)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, "", false, nil
	}
	if err != nil {
		return nil, "", false, err
	}
	return bytes, contentType, true, nil
}

// PutEmoji caches an emoji asset's bytes. Idempotent: a re-fetch of the same
// path overwrites (the upstream content is immutable, so this is a no-op refresh).
func (s *Store) PutEmoji(ctx context.Context, path, contentType string, bytes []byte) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO emoji_cache (path, content_type, bytes) VALUES ($1, $2, $3)
		 ON CONFLICT (path) DO UPDATE SET bytes = EXCLUDED.bytes, content_type = EXCLUDED.content_type`,
		path, contentType, bytes)
	return err
}
