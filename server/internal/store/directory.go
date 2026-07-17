package store

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// foldOf is the case-folding used for username uniqueness/lookup (v1: lowercase).
func foldOf(s string) string { return strings.ToLower(s) }

// foldLike folds a search term and escapes LIKE metacharacters so user input
// can't inject wildcards (Postgres LIKE uses backslash as the default escape). A
// leading "@" is dropped so "@bob" matches the username "bob".
func foldLike(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(strings.TrimLeft(strings.ToLower(s), "@"))
}

// ErrUsernameAlreadySet means a one-time username claim was attempted on an
// account that already has a username (usernames are immutable).
var ErrUsernameAlreadySet = errors.New("username already set")

// DirectoryUser is a publicly-listable profile in the in-network directory. The
// avatar/about fields are empty when the owner has hidden them (privacy tier
// 'nobody' → the client uploads "" → stored NULL).
type DirectoryUser struct {
	ID          string
	Username    string
	DisplayName string
	Avatar      string // small data-URL thumbnail, "" if hidden/unset
	About       string // "" if hidden/unset
	ProfileAt   time.Time
}

// scanDirectoryUser maps a directory row (nullable profile columns) into a
// DirectoryUser.
func scanDirectoryUser(row pgx.Row) (*DirectoryUser, error) {
	var (
		du                   DirectoryUser
		display, avatar, abt *string
	)
	if err := row.Scan(&du.ID, &du.Username, &display, &avatar, &abt, &du.ProfileAt); err != nil {
		return nil, err
	}
	if display != nil {
		du.DisplayName = *display
	}
	if du.DisplayName == "" {
		du.DisplayName = du.Username
	}
	if avatar != nil {
		du.Avatar = *avatar
	}
	if abt != nil {
		du.About = *abt
	}
	return &du, nil
}

// ListUsers returns a page of the directory visible to viewerID: active,
// username-bearing accounts other than the viewer, excluding any account in a
// mutual-block relationship with the viewer (either direction, matching the
// fetchKeys 404 behaviour). Results are ordered by username_fold for keyset
// pagination; pass the last row's username_fold back as `cursor` to continue.
// An optional case-insensitive `query` substring-matches username or display
// name. Returns the rows and the next cursor ("" when the page is the last one).
func (s *Store) ListUsers(ctx context.Context, viewerID, query, cursor string, limit int) ([]DirectoryUser, string, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	pattern := "%" + foldLike(query) + "%"
	rows, err := s.pool.Query(ctx,
		`SELECT id::text, username, display_name, avatar_thumb, about, profile_at
		   FROM users u
		  WHERE u.state = 'active' AND u.username IS NOT NULL
		    AND u.id::text <> $1
		    AND u.username_fold > $2
		    AND ($3 = '' OR u.username_fold LIKE $4 OR lower(coalesce(u.display_name,'')) LIKE $4)
		    AND NOT EXISTS (
		          SELECT 1 FROM blocks b
		           WHERE (b.blocker::text = $1 AND b.blocked = u.id)
		              OR (b.blocker = u.id AND b.blocked::text = $1))
		  ORDER BY u.username_fold
		  LIMIT $5`,
		viewerID, cursor, query, pattern, limit+1)
	if err != nil {
		return nil, "", err
	}
	defer rows.Close()

	out := make([]DirectoryUser, 0, limit)
	for rows.Next() {
		du, err := scanDirectoryUser(rows)
		if err != nil {
			return nil, "", err
		}
		out = append(out, *du)
	}
	if err := rows.Err(); err != nil {
		return nil, "", err
	}
	next := ""
	if len(out) > limit {
		// We fetched one extra to detect a further page; the cursor is the last
		// returned row's fold.
		out = out[:limit]
		next = foldOf(out[len(out)-1].Username)
	}
	return out, next, nil
}

// GetUser returns one directory profile as seen by viewerID, or ErrNoUser if the
// target doesn't exist, isn't active, has no username, or is in a mutual-block
// relationship with the viewer.
func (s *Store) GetUser(ctx context.Context, viewerID, targetID string) (*DirectoryUser, error) {
	du, err := scanDirectoryUser(s.pool.QueryRow(ctx,
		`SELECT id::text, username, display_name, avatar_thumb, about, profile_at
		   FROM users u
		  WHERE u.id::text = $2 AND u.state = 'active' AND u.username IS NOT NULL
		    AND NOT EXISTS (
		          SELECT 1 FROM blocks b
		           WHERE (b.blocker::text = $1 AND b.blocked = u.id)
		              OR (b.blocker = u.id AND b.blocked::text = $1))`,
		viewerID, targetID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoUser
	}
	return du, err
}

// UserProfile returns the caller's own profile (no block filtering), used by
// /v1/me and /v1/session so a restored client learns its own username + profile.
// Returns ErrNoUser if the account row is gone.
func (s *Store) UserProfile(ctx context.Context, userID string) (*DirectoryUser, error) {
	var (
		du                          DirectoryUser
		uname, display, avatar, abt *string
	)
	err := s.pool.QueryRow(ctx,
		`SELECT id::text, username, display_name, avatar_thumb, about, profile_at
		   FROM users WHERE id::text = $1`, userID).
		Scan(&du.ID, &uname, &display, &avatar, &abt, &du.ProfileAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoUser
	}
	if err != nil {
		return nil, err
	}
	if uname != nil {
		du.Username = *uname
	}
	if display != nil {
		du.DisplayName = *display
	}
	if du.DisplayName == "" {
		du.DisplayName = du.Username
	}
	if avatar != nil {
		du.Avatar = *avatar
	}
	if abt != nil {
		du.About = *abt
	}
	return &du, nil
}

// UpdateProfile updates the caller's mutable profile fields (display name, avatar
// thumbnail, About) and bumps profile_at. It NEVER touches the username. An empty
// avatar/about is stored as NULL so the directory omits it (the client sends ""
// when the matching privacy tier is 'nobody').
func (s *Store) UpdateProfile(ctx context.Context, userID, displayName, avatar, about string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE users
		    SET display_name = $2,
		        avatar_thumb = NULLIF($3, ''),
		        about        = NULLIF($4, ''),
		        profile_at   = now()
		  WHERE id::text = $1`,
		userID, displayName, avatar, about)
	return err
}

// ClaimUsername sets a username on a legacy account that registered before
// usernames existed (username IS NULL). It is the only writer of username besides
// Register, and only fills a NULL - it can never change an existing handle.
// Returns ErrUsernameAlreadySet if the account already has one, or
// ErrUsernameTaken if the handle is claimed by someone else.
func (s *Store) ClaimUsername(ctx context.Context, userID, username, usernameFold string) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE users
		    SET username = $2, username_fold = $3,
		        display_name = COALESCE(display_name, $2), profile_at = now()
		  WHERE id::text = $1 AND username IS NULL`,
		userID, username, usernameFold)
	if isUniqueViolation(err) {
		return ErrUsernameTaken
	}
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrUsernameAlreadySet
	}
	return nil
}

// ErrNoUser means the requested account isn't a visible directory profile.
var ErrNoUser = errors.New("no such user")
