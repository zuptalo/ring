package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// serverSecretID is the primary key of the single server_secrets row.
const serverSecretID = "default"

// GetServerSecret returns the encrypted server-secret blob (nonce||ciphertext).
// found=false if the server has never persisted its secrets yet.
func (s *Store) GetServerSecret(ctx context.Context) ([]byte, bool, error) {
	var b []byte
	err := s.pool.QueryRow(ctx,
		`SELECT secret FROM server_secrets WHERE id = $1`, serverSecretID).Scan(&b)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return b, true, nil
}

// PutServerSecret upserts the encrypted server-secret blob.
func (s *Store) PutServerSecret(ctx context.Context, secret []byte) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO server_secrets (id, secret) VALUES ($1, $2)
		 ON CONFLICT (id) DO UPDATE SET secret = EXCLUDED.secret, updated_at = now()`,
		serverSecretID, secret)
	return err
}
