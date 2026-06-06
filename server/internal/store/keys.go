package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// ErrNoBundle means the target user has not published a prekey bundle.
var ErrNoBundle = errors.New("no key bundle for user")

// SignedPreKey is the signed prekey portion of a published bundle (all public).
type SignedPreKey struct {
	ID  string
	Pub string
	Sig string
}

// OneTimePreKey is a single one-time prekey (public).
type OneTimePreKey struct {
	ID  string
	Pub string
}

// PublicBundle is what a user publishes: identity public keys, the current
// signed prekey, and a batch of one-time prekeys to seed the pool.
type PublicBundle struct {
	EdPub          string
	XPub           string
	SignedPreKey   SignedPreKey
	OneTimePreKeys []OneTimePreKey
}

// PeerBundle is what a peer fetches to start an X3DH session: identity + signed
// prekey, plus at most one consumed one-time prekey (nil when the pool is dry).
type PeerBundle struct {
	UserID        string
	EdPub         string
	XPub          string
	SignedPreKey  SignedPreKey
	OneTimePreKey *OneTimePreKey
}

// PublishBundle upserts the caller's identity + signed prekey and adds the
// included one-time prekeys to their pool, atomically. Re-publishing rotates the
// signed prekey; one-time prekeys accumulate (duplicates by key_id are ignored).
func (s *Store) PublishBundle(ctx context.Context, userID string, b PublicBundle) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx,
		`INSERT INTO prekey_bundles (user_id, ed_pub, x_pub, spk_id, spk_pub, spk_sig, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, now())
		 ON CONFLICT (user_id) DO UPDATE SET
		   ed_pub = EXCLUDED.ed_pub, x_pub = EXCLUDED.x_pub,
		   spk_id = EXCLUDED.spk_id, spk_pub = EXCLUDED.spk_pub, spk_sig = EXCLUDED.spk_sig,
		   updated_at = now()`,
		userID, b.EdPub, b.XPub, b.SignedPreKey.ID, b.SignedPreKey.Pub, b.SignedPreKey.Sig); err != nil {
		return err
	}
	if err := insertOneTimePreKeys(ctx, tx, userID, b.OneTimePreKeys); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// AddOneTimePreKeys appends one-time prekeys to the caller's pool (replenish).
func (s *Store) AddOneTimePreKeys(ctx context.Context, userID string, keys []OneTimePreKey) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := insertOneTimePreKeys(ctx, tx, userID, keys); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func insertOneTimePreKeys(ctx context.Context, tx pgx.Tx, userID string, keys []OneTimePreKey) error {
	for _, k := range keys {
		if _, err := tx.Exec(ctx,
			`INSERT INTO one_time_prekeys (user_id, key_id, pub) VALUES ($1, $2, $3)
			 ON CONFLICT (user_id, key_id) DO NOTHING`,
			userID, k.ID, k.Pub); err != nil {
			return err
		}
	}
	return nil
}

// OneTimePreKeyCount reports how many one-time prekeys remain in the user's pool
// (so the client knows when to replenish).
func (s *Store) OneTimePreKeyCount(ctx context.Context, userID string) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM one_time_prekeys WHERE user_id = $1`, userID).Scan(&n)
	return n, err
}

// EdPub returns a user's published Ed25519 identity public key (b64url).
// found=false if the user has never published a bundle. Read-only (unlike
// FetchBundle it consumes no one-time prekey) - used to verify a recovery
// challenge signature during new-device restore.
func (s *Store) EdPub(ctx context.Context, userID string) (string, bool, error) {
	var edPub string
	err := s.pool.QueryRow(ctx,
		`SELECT ed_pub FROM prekey_bundles WHERE user_id = $1`, userID).Scan(&edPub)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return edPub, true, nil
}

// FetchBundle returns the target user's bundle for X3DH, consuming exactly one
// one-time prekey in the same transaction (SKIP LOCKED so concurrent fetchers
// each get a distinct key). Returns ErrNoBundle if the user hasn't published.
func (s *Store) FetchBundle(ctx context.Context, targetUserID string) (*PeerBundle, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	pb := &PeerBundle{UserID: targetUserID}
	err = tx.QueryRow(ctx,
		`SELECT ed_pub, x_pub, spk_id, spk_pub, spk_sig FROM prekey_bundles WHERE user_id = $1`,
		targetUserID).Scan(&pb.EdPub, &pb.XPub, &pb.SignedPreKey.ID, &pb.SignedPreKey.Pub, &pb.SignedPreKey.Sig)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoBundle
	}
	if err != nil {
		return nil, err
	}

	// Consume one one-time prekey if any remain.
	var otk OneTimePreKey
	err = tx.QueryRow(ctx,
		`DELETE FROM one_time_prekeys
		 WHERE (user_id, key_id) IN (
		   SELECT user_id, key_id FROM one_time_prekeys
		   WHERE user_id = $1
		   ORDER BY created_at
		   FOR UPDATE SKIP LOCKED
		   LIMIT 1
		 )
		 RETURNING key_id, pub`, targetUserID).Scan(&otk.ID, &otk.Pub)
	if err == nil {
		pb.OneTimePreKey = &otk
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return pb, nil
}
