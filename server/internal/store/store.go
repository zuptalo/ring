// Package store is the PostgreSQL persistence layer. Handlers depend on small
// interfaces (see internal/api) that *Store satisfies, so they can be tested
// without a database.
package store

import (
	"context"
	"crypto/rand"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrInviteInvalid means the invitation code is unknown, already used, or
// expired.
var ErrInviteInvalid = errors.New("invitation code invalid, used, or expired")

// ErrUsernameTaken means the requested username is already claimed (case-folded).
var ErrUsernameTaken = errors.New("username already taken")

// isUniqueViolation reports whether err is a Postgres unique-constraint error
// (SQLSTATE 23505).
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// ErrInviteLimit means the user has too many outstanding (unused) invites.
var ErrInviteLimit = errors.New("too many outstanding invitations")

// maxUnusedInvitesPerUser caps how many unclaimed invites a user may hold.
const maxUnusedInvitesPerUser = 50

// inviteAlphabet is unambiguous uppercase (no 0/O/1/I) and matches the
// [A-Z0-9]{8} the register UI requires.
const inviteAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

type Store struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// Register atomically claims an unused, unexpired invite, creates the user,
// marks the invite used, and stores the token hash. Returns ErrInviteInvalid if
// the code cannot be claimed.
// Register claims an invitation code and creates a new account with the chosen
// immutable username (usernameFold is its case-folded uniqueness key;
// display_name defaults to the username until the user edits their profile). It
// returns the new user id and the code's creator (inviterID, "" for ownerless
// codes like the dev/first-run seeds) so the client can auto-connect the invitee
// to whoever invited them. Returns ErrUsernameTaken if the username (case-folded)
// is already claimed - and because that happens inside the same transaction, the
// invite code is rolled back unused so the user can retry with another name.
func (s *Store) Register(ctx context.Context, code, username, usernameFold string, tokenHash []byte) (userID, inviterID string, err error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Lock the invite row and confirm it's claimable; capture its creator.
	var claimed string
	var inviter *string
	err = tx.QueryRow(ctx,
		`SELECT code, created_by::text FROM invitations
		 WHERE code = $1 AND used_by IS NULL AND (expires_at IS NULL OR expires_at > now())
		 FOR UPDATE`, code).Scan(&claimed, &inviter)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", ErrInviteInvalid
	}
	if err != nil {
		return "", "", err
	}

	insErr := tx.QueryRow(ctx,
		`INSERT INTO users (username, username_fold, display_name)
		 VALUES ($1, $2, $1) RETURNING id::text`, username, usernameFold).Scan(&userID)
	if isUniqueViolation(insErr) {
		return "", "", ErrUsernameTaken
	}
	if insErr != nil {
		return "", "", insErr
	}
	if _, err := tx.Exec(ctx,
		`UPDATE invitations SET used_by = $1, used_at = now() WHERE code = $2`, userID, code); err != nil {
		return "", "", err
	}
	// The inviter and invitee are connected from the start (the invite is the
	// handshake), so directory-gated messaging works between them immediately.
	if inviter != nil && *inviter != "" {
		if _, err := tx.Exec(ctx,
			`INSERT INTO connections (requester, target, state) VALUES ($1, $2, 'accepted')
			 ON CONFLICT (requester, target) DO UPDATE SET state = 'accepted', updated_at = now()`,
			*inviter, userID); err != nil {
			return "", "", err
		}
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO tokens (token_hash, user_id) VALUES ($1, $2)`, tokenHash, userID); err != nil {
		return "", "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", "", err
	}
	if inviter != nil {
		inviterID = *inviter
	}
	return userID, inviterID, nil
}

// AddToken issues an additional device token for an existing user (used when a
// new device restores the account via its recovery code). Only the token hash is
// stored. Idempotent on the hash.
func (s *Store) AddToken(ctx context.Context, userID string, tokenHash []byte) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO tokens (token_hash, user_id) VALUES ($1, $2) ON CONFLICT (token_hash) DO NOTHING`,
		tokenHash, userID)
	return err
}

// UserIDForToken resolves a token hash to a user id.
func (s *Store) UserIDForToken(ctx context.Context, tokenHash []byte) (string, bool, error) {
	var userID string
	err := s.pool.QueryRow(ctx, `SELECT user_id::text FROM tokens WHERE token_hash = $1`, tokenHash).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return userID, true, nil
}

// TouchToken bumps last_seen_at for a token (best-effort, on /v1/session).
func (s *Store) TouchToken(ctx context.Context, tokenHash []byte) error {
	_, err := s.pool.Exec(ctx, `UPDATE tokens SET last_seen_at = now() WHERE token_hash = $1`, tokenHash)
	return err
}

// DeleteUser terminates an account: it wipes all of the user's per-user data but
// KEEPS the user row, flipped to state='terminated'. Keeping the row means the id
// can never be re-registered, and peers can detect the termination via
// POST /v1/status (and then render the person as "Ghosted").
//
// Everything is removed explicitly (rather than letting ON DELETE CASCADE fire on
// the user row, which we deliberately don't delete) EXCEPT blobs: a peer may not
// have downloaded media this user already sent them, so the encrypted blobs are
// retained. Consumed/created invitations are removed too, so a spent code can't
// resurface. Idempotent: terminating an already-terminated user is a no-op.
func (s *Store) DeleteUser(ctx context.Context, userID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	wipes := []string{
		`DELETE FROM tokens WHERE user_id::text = $1`,
		`DELETE FROM prekey_bundles WHERE user_id::text = $1`,
		`DELETE FROM one_time_prekeys WHERE user_id::text = $1`,
		`DELETE FROM relay_queue WHERE recipient::text = $1 OR sender::text = $1`,
		`DELETE FROM sync_records WHERE user_id::text = $1`,
		`DELETE FROM recovery_wraps WHERE user_id::text = $1`,
		`DELETE FROM push_subscriptions WHERE user_id::text = $1`,
		`DELETE FROM blocks WHERE blocker::text = $1 OR blocked::text = $1`,
		`DELETE FROM invitations WHERE used_by::text = $1 OR created_by::text = $1`,
	}
	for _, q := range wipes {
		if _, err := tx.Exec(ctx, q, userID); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx,
		`UPDATE users
		    SET state = 'terminated', last_seen_at = NULL,
		        share_online = false, share_last_seen = false
		  WHERE id::text = $1`, userID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// UserStates resolves a set of user ids to their lifecycle state ('active' or
// 'terminated'). Ids with no row are simply absent from the map; the caller
// reports those as "unknown".
func (s *Store) UserStates(ctx context.Context, ids []string) (map[string]string, error) {
	out := make(map[string]string, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := s.pool.Query(ctx, `SELECT id::text, state FROM users WHERE id::text = ANY($1)`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, state string
		if err := rows.Scan(&id, &state); err != nil {
			return nil, err
		}
		out[id] = state
	}
	return out, rows.Err()
}

// CreateInvite inserts an invitation code idempotently (no-op if it exists).
func (s *Store) CreateInvite(ctx context.Context, code string) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO invitations (code) VALUES ($1) ON CONFLICT (code) DO NOTHING`, code)
	return err
}

// SeedDevInvites inserts development invitation codes idempotently. Dev only.
func (s *Store) SeedDevInvites(ctx context.Context, codes []string) error {
	for _, c := range codes {
		if err := s.CreateInvite(ctx, c); err != nil {
			return err
		}
	}
	return nil
}

// MintInvite generates a fresh, single-use invitation code and stores it,
// returning the code. It backs the dev-only mint endpoint so the e2e harness can
// register accounts with a code that is fresh on every attempt, instead of a
// fixed pool that a Playwright retry would re-consume (and whose derived username
// would collide). Dev/test only.
func (s *Store) MintInvite(ctx context.Context) (string, error) {
	code, err := generateInviteCode()
	if err != nil {
		return "", err
	}
	if err := s.CreateInvite(ctx, code); err != nil {
		return "", err
	}
	return code, nil
}

// generateInviteCode returns a random 8-char code from the unambiguous alphabet
// (matches the [A-Z0-9]{8} the register UI requires).
func generateInviteCode() (string, error) {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	for i := range b {
		b[i] = inviteAlphabet[int(b[i])%len(inviteAlphabet)]
	}
	return string(b), nil
}

// IsInviteClaimable reports whether a code exists and is unused + unexpired.
func (s *Store) IsInviteClaimable(ctx context.Context, code string) (bool, error) {
	var ok bool
	err := s.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM invitations
		 WHERE code = $1 AND used_by IS NULL AND (expires_at IS NULL OR expires_at > now()))`,
		code).Scan(&ok)
	return ok, err
}

// CreateInvitation mints a unique 8-char code owned by creatorID and stores it,
// returning the code. Enforces a per-user cap on outstanding unused invites.
func (s *Store) CreateInvitation(ctx context.Context, creatorID string) (string, error) {
	var outstanding int
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM invitations WHERE created_by = $1 AND used_by IS NULL`,
		creatorID).Scan(&outstanding); err != nil {
		return "", err
	}
	if outstanding >= maxUnusedInvitesPerUser {
		return "", ErrInviteLimit
	}

	for attempt := 0; attempt < 5; attempt++ {
		code, err := randomInviteCode()
		if err != nil {
			return "", err
		}
		tag, err := s.pool.Exec(ctx,
			`INSERT INTO invitations (code, created_by, expires_at)
			 VALUES ($1, $2, now() + interval '7 days') ON CONFLICT (code) DO NOTHING`,
			code, creatorID)
		if err != nil {
			return "", err
		}
		if tag.RowsAffected() == 1 {
			return code, nil
		}
	}
	return "", errors.New("could not allocate a unique invite code")
}

// Invitation is one of a user's created invitation codes and its redemption
// state.
type Invitation struct {
	Code      string
	CreatedAt time.Time
	ExpiresAt *time.Time // nil = never expires (legacy codes)
	UsedBy    string     // new account's user id, "" if not yet redeemed
	UsedAt    *time.Time
}

// ListInvitations returns the invitations a user created, newest first, so the
// client can show their expiry/redemption state and auto-connect on redemption.
func (s *Store) ListInvitations(ctx context.Context, creatorID string) ([]Invitation, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT code, created_at, expires_at, used_by::text, used_at FROM invitations
		 WHERE created_by = $1 ORDER BY created_at DESC`, creatorID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Invitation
	for rows.Next() {
		var (
			code      string
			createdAt time.Time
			expiresAt *time.Time
			usedBy    *string
			usedAt    *time.Time
		)
		if err := rows.Scan(&code, &createdAt, &expiresAt, &usedBy, &usedAt); err != nil {
			return nil, err
		}
		inv := Invitation{Code: code, CreatedAt: createdAt, ExpiresAt: expiresAt, UsedAt: usedAt}
		if usedBy != nil {
			inv.UsedBy = *usedBy
		}
		out = append(out, inv)
	}
	return out, rows.Err()
}

// ExtendInvitation pushes an unused invite's expiry 24h further out (from now, or
// from its current expiry if that's later), so it works whether the code is still
// valid or already expired. Only the creator can extend, and only an UNUSED code.
// Returns the new expiry, or ErrInviteInvalid if no such unused code is theirs.
func (s *Store) ExtendInvitation(ctx context.Context, creatorID, code string) (time.Time, error) {
	var newExpiry time.Time
	err := s.pool.QueryRow(ctx,
		`UPDATE invitations
		 SET expires_at = GREATEST(COALESCE(expires_at, now()), now()) + interval '24 hours'
		 WHERE code = $1 AND created_by = $2 AND used_by IS NULL
		 RETURNING expires_at`, code, creatorID).Scan(&newExpiry)
	if errors.Is(err, pgx.ErrNoRows) {
		return time.Time{}, ErrInviteInvalid
	}
	return newExpiry, err
}

// CancelInvitation deletes an unused invite so it can no longer be redeemed. Only
// the creator's own, still-unused codes can be cancelled. Returns ErrInviteInvalid
// if there's nothing to cancel (unknown, not theirs, or already redeemed).
func (s *Store) CancelInvitation(ctx context.Context, creatorID, code string) error {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM invitations WHERE code = $1 AND created_by = $2 AND used_by IS NULL`,
		code, creatorID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrInviteInvalid
	}
	return nil
}

func randomInviteCode() (string, error) {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	for i := range b {
		b[i] = inviteAlphabet[int(b[i])%len(inviteAlphabet)]
	}
	return string(b), nil
}

// CountUsers returns the number of registered accounts.
func (s *Store) CountUsers(ctx context.Context) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `SELECT count(*) FROM users`).Scan(&n)
	return n, err
}

// UnusedInviteCodes returns up to `limit` claimable (unused, unexpired) codes.
func (s *Store) UnusedInviteCodes(ctx context.Context, limit int) ([]string, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT code FROM invitations
		 WHERE used_by IS NULL AND (expires_at IS NULL OR expires_at > now())
		 ORDER BY created_at LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var c string
		if err := rows.Scan(&c); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// Ping verifies database connectivity (for /healthz).
func (s *Store) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }
