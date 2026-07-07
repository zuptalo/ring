package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// Social Wall persistence (spec 0003). The server holds only opaque ciphertext +
// per-recipient wrapped-key envelopes + coarse routing metadata. This file covers
// post create/list/delete (US2); engagement + views are added with US4/US7.

// NewPostEnvelope is one recipient's wrapped K_post.
type NewPostEnvelope struct {
	Recipient  string
	WrappedKey string // opaque
}

// NewPost is an authored post plus its per-recipient envelopes (its audience).
type NewPost struct {
	ID        string
	Author    string
	BlobID    string // opaque capability of the K_post-sealed payload
	Size      int
	ExpiresAt *time.Time // nil = keep
	TtlMs     int64      // per-post lifetime window (keep-alive resets to now+ttl)
	Envelopes []NewPostEnvelope
}

// PostForRecipient is a post as delivered to one caller: the caller's wrapped key is
// included (empty for the caller's own posts, which they can already open).
type PostForRecipient struct {
	ID         string
	Author     string
	BlobID     string
	Size       int
	CreatedMs  int64
	ExpiresMs  int64  // 0 = no expiry
	TtlMs      int64  // per-post lifetime window
	WrappedKey string // "" for own posts
}

// CreatePost stores a post and its envelopes atomically.
func (s *Store) CreatePost(ctx context.Context, p NewPost) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	ttl := p.TtlMs
	if ttl <= 0 {
		ttl = 72 * 60 * 60 * 1000
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO posts (id, author, blob_id, size, expires_at, ttl_ms) VALUES ($1, $2, $3, $4, $5, $6)`,
		p.ID, p.Author, p.BlobID, p.Size, p.ExpiresAt, ttl); err != nil {
		return err
	}
	for _, e := range p.Envelopes {
		if _, err := tx.Exec(ctx,
			`INSERT INTO post_envelopes (post_id, recipient, wrapped_key) VALUES ($1, $2, $3)
			 ON CONFLICT (post_id, recipient) DO NOTHING`,
			p.ID, e.Recipient, e.WrappedKey); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// ListPosts returns posts the caller can see — their own plus those addressed to
// them — created after sinceMs, newest first, excluding expired ones (lazy prune).
// The caller's envelope (wrapped K_post) rides along for received posts.
func (s *Store) ListPosts(ctx context.Context, recipient string, sinceMs int64) ([]PostForRecipient, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT p.id, p.author::text, p.blob_id, p.size,
		        (extract(epoch from p.created_at)*1000)::bigint,
		        COALESCE((extract(epoch from p.expires_at)*1000)::bigint, 0),
		        p.ttl_ms,
		        COALESCE(e.wrapped_key, '')
		   FROM posts p
		   LEFT JOIN post_envelopes e ON e.post_id = p.id AND e.recipient::text = $1
		  WHERE (p.author::text = $1 OR e.recipient::text = $1)
		    AND (extract(epoch from p.created_at)*1000)::bigint > $2
		    AND (p.expires_at IS NULL OR p.expires_at > now())
		  ORDER BY p.created_at DESC
		  LIMIT 200`, recipient, sinceMs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PostForRecipient
	for rows.Next() {
		var p PostForRecipient
		if err := rows.Scan(&p.ID, &p.Author, &p.BlobID, &p.Size, &p.CreatedMs, &p.ExpiresMs, &p.TtlMs, &p.WrappedKey); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// DeletePost removes a post (and, via cascade, its envelopes/engagement/views). The
// author-only guard is the `author` predicate, so a non-author delete is a no-op.
// DeletePost removes the author's own post and records a durable per-recipient tombstone so
// every recipient prunes its local copy (offline → next sync; online → the caller WS-pushes).
// Returns the recipient ids that held it (for the live push). No-op + nil if not the author's.
func (s *Store) DeletePost(ctx context.Context, author, id string) ([]string, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var owned bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM posts WHERE id = $1 AND author::text = $2)`, id, author).Scan(&owned); err != nil {
		return nil, err
	}
	if !owned {
		return nil, nil
	}

	rows, err := tx.Query(ctx, `SELECT recipient::text FROM post_envelopes WHERE post_id = $1`, id)
	if err != nil {
		return nil, err
	}
	var recipients []string
	for rows.Next() {
		var r string
		if err := rows.Scan(&r); err != nil {
			rows.Close()
			return nil, err
		}
		recipients = append(recipients, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Tombstone each recipient BEFORE deleting the post (this table has no cascade FK, so the
	// rows persist past the DELETE below and reach offline recipients via listPosts.revoked).
	for _, r := range recipients {
		if _, err := tx.Exec(ctx,
			`INSERT INTO post_deletions (post_id, recipient) VALUES ($1, $2) ON CONFLICT DO NOTHING`, id, r); err != nil {
			return nil, err
		}
	}
	if _, err := tx.Exec(ctx, `DELETE FROM posts WHERE id = $1 AND author::text = $2`, id, author); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return recipients, nil
}

// KeepAlive (author-only): explicitly push a post's expiry back to now + its own window —
// the manual version of the engagement keep-alive. Never shortens. Returns false if the
// post isn't the caller's (or doesn't exist).
func (s *Store) KeepAlive(ctx context.Context, author, id string) (bool, error) {
	ct, err := s.pool.Exec(ctx,
		`UPDATE posts SET expires_at = GREATEST(expires_at, now() + (ttl_ms * interval '1 millisecond'))
		  WHERE id = $1 AND author::text = $2`,
		id, author)
	if err != nil {
		return false, err
	}
	return ct.RowsAffected() > 0, nil
}

// AddEnvelopes broadens a post's audience (author-only): inserts new recipient key-envelopes
// and clears any prior revocation/deletion tombstone for those recipients (so broadening back
// re-grants access). Returns the recipients actually ADDED (newly inserted), for a silent live
// delivery. No-op + nil if the post isn't the author's.
func (s *Store) AddEnvelopes(ctx context.Context, author, postID string, envs []NewPostEnvelope) ([]string, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var owned bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM posts WHERE id = $1 AND author::text = $2)`, postID, author).Scan(&owned); err != nil {
		return nil, err
	}
	if !owned {
		return nil, nil
	}

	var added []string
	for _, e := range envs {
		ct, err := tx.Exec(ctx,
			`INSERT INTO post_envelopes (post_id, recipient, wrapped_key) VALUES ($1, $2, $3)
			 ON CONFLICT (post_id, recipient) DO NOTHING`,
			postID, e.Recipient, e.WrappedKey)
		if err != nil {
			return nil, err
		}
		if ct.RowsAffected() > 0 {
			added = append(added, e.Recipient)
		}
		// Undo any prior tombstone so a re-granted recipient re-fetches the post.
		if _, err := tx.Exec(ctx, `DELETE FROM post_revocations WHERE post_id = $1 AND recipient::text = $2`, postID, e.Recipient); err != nil {
			return nil, err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM post_deletions WHERE post_id = $1 AND recipient::text = $2`, postID, e.Recipient); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return added, nil
}

// RemovePostRecipient drops `recipient` from a post's audience (author-only): it
// deletes their wrapped-key envelope (so they can't re-fetch the key) and records a
// revocation so their device removes the local copy on next sync. Returns true if the
// caller authored the post (the operation applied).
func (s *Store) RemovePostRecipient(ctx context.Context, postID, author, recipient string) (bool, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var owns bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM posts WHERE id = $1 AND author::text = $2)`, postID, author).Scan(&owns); err != nil {
		return false, err
	}
	if !owns {
		return false, nil
	}
	if _, err := tx.Exec(ctx,
		`DELETE FROM post_envelopes WHERE post_id = $1 AND recipient::text = $2`, postID, recipient); err != nil {
		return false, err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO post_revocations (post_id, recipient) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		postID, recipient); err != nil {
		return false, err
	}
	return true, tx.Commit(ctx)
}

// ListRevocations returns post ids recently revoked for `recipient` (bounded window),
// so their client can delete those local copies. Idempotent for the client.
func (s *Store) ListRevocations(ctx context.Context, recipient string) ([]string, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT post_id FROM post_revocations
		  WHERE recipient::text = $1 AND created_at > now() - interval '30 days'
		 UNION
		 SELECT post_id FROM post_deletions
		  WHERE recipient::text = $1 AND created_at > now() - interval '30 days'`, recipient)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

/* ---- FR-008 anti-flood counts (routing metadata only, never content) ---- */

// RecentPostCount returns how many posts `author` created within the last withinSec
// seconds — the input to the per-author post-rate limit.
func (s *Store) RecentPostCount(ctx context.Context, author string, withinSec int) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM posts
		  WHERE author::text = $1 AND created_at > now() - make_interval(secs => $2)`,
		author, withinSec).Scan(&n)
	return n, err
}

// RecentEngagementCount returns how many engagement items `actor` submitted (any post)
// within the last withinSec seconds — the input to the per-user engagement-rate limit.
func (s *Store) RecentEngagementCount(ctx context.Context, actor string, withinSec int) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM post_engagement
		  WHERE actor::text = $1 AND created_at > now() - make_interval(secs => $2)`,
		actor, withinSec).Scan(&n)
	return n, err
}

// RecentCommentCount returns how many comments `actor` added to ONE post within the
// last withinSec seconds — the input to the per-post comment-rate limit.
func (s *Store) RecentCommentCount(ctx context.Context, postID, actor string, withinSec int) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM post_engagement
		  WHERE post_id = $1 AND actor::text = $2 AND kind = 'comment'
		    AND created_at > now() - make_interval(secs => $3)`,
		postID, actor, withinSec).Scan(&n)
	return n, err
}

/* ---- engagement (reactions/comments) — US4 ---- */

// CanSeePost reports whether `user` is in a post's audience (has an envelope) or is its
// author — the gate for both submitting and reading engagement.
func (s *Store) CanSeePost(ctx context.Context, postID, user string) (bool, error) {
	var ok bool
	err := s.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM posts WHERE id = $1 AND author::text = $2)
		     OR EXISTS (SELECT 1 FROM post_envelopes WHERE post_id = $1 AND recipient::text = $2)`,
		postID, user).Scan(&ok)
	return ok, err
}

// PostAudience returns the post's recipient set plus its author (used to nudge everyone
// who can see a post when engagement arrives).
func (s *Store) PostAudience(ctx context.Context, postID string) ([]string, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT recipient::text FROM post_envelopes WHERE post_id = $1
		 UNION SELECT author::text FROM posts WHERE id = $1`, postID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var u string
		if err := rows.Scan(&u); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// SubmitEngagement records one opaque engagement item (reaction/comment/tombstone) on a
// post. The payload is sealed under K_post; the server stores it without reading it.
// Keep-alive (rolling 72h of inactivity): any engagement extends the post's expiry to
// now+72h, so an actively-engaged post stays alive (mirrors the client bump).
func (s *Store) SubmitEngagement(ctx context.Context, postID, id, actor, kind, payload string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx,
		`INSERT INTO post_engagement (id, post_id, actor, kind, payload) VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (id) DO NOTHING`,
		id, postID, actor, kind, payload); err != nil {
		return err
	}
	// Keep-alive: extend to now + the post's OWN window (never shorten).
	if _, err := tx.Exec(ctx,
		`UPDATE posts SET expires_at = GREATEST(expires_at, now() + (ttl_ms * interval '1 millisecond'))
		  WHERE id = $1`,
		postID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// PostEngagementRow is one opaque engagement item delivered to an audience member.
type PostEngagementRow struct {
	ID        string
	Actor     string
	Kind      string
	Payload   string
	CreatedMs int64
}

// GameParticipants returns the distinct actors of the post's `game`
// engagements — together with the author, these are a challenge's players
// (spec 1035): the accepter's accept and every subsequent move are all kind
// "game", so anyone who ever wrote one holds a seat (or raced for it). Uses
// only metadata the server already stores; payloads stay sealed.
func (s *Store) GameParticipants(ctx context.Context, postID string) ([]string, error) {
	rows, err := s.pool.Query(ctx, `SELECT DISTINCT actor FROM post_engagement WHERE post_id=$1 AND kind='game'`, postID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var u string
		if err := rows.Scan(&u); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// GameFollowers returns the distinct actors holding a LIVE `follow` engagement
// on the post (spec 1036) — a tombstone whose payload names the follow row
// retracts it. These are the spectators who opted in to the result push.
func (s *Store) GameFollowers(ctx context.Context, postID string) ([]string, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT DISTINCT f.actor FROM post_engagement f
		WHERE f.post_id=$1 AND f.kind='follow'
		AND NOT EXISTS (
			SELECT 1 FROM post_engagement t
			WHERE t.post_id=$1 AND t.kind='tombstone' AND t.payload=f.id
		)`, postID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var u string
		if err := rows.Scan(&u); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// PostAuthor returns a post's author id (or "" if the post is gone).
func (s *Store) PostAuthor(ctx context.Context, postID string) (string, error) {
	var author string
	err := s.pool.QueryRow(ctx, `SELECT author::text FROM posts WHERE id = $1`, postID).Scan(&author)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil
		}
		return "", err
	}
	return author, nil
}

// EngagementActor returns who authored a given engagement item on a post (or "" if not
// found) — used to authorize a tombstone (a commenter may delete their own comment).
func (s *Store) EngagementActor(ctx context.Context, postID, engID string) (string, error) {
	var actor string
	err := s.pool.QueryRow(ctx,
		`SELECT actor::text FROM post_engagement WHERE id = $1 AND post_id = $2`, engID, postID).Scan(&actor)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil
		}
		return "", err
	}
	return actor, nil
}

// RecordView records that `viewer` saw a post (idempotent), delivered to the author
// only. Gated client-side by the viewer's seen-receipts setting.
func (s *Store) RecordView(ctx context.Context, postID, viewer string) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO post_views (post_id, viewer) VALUES ($1, $2) ON CONFLICT (post_id, viewer) DO NOTHING`,
		postID, viewer)
	return err
}

// PostView is one viewer of a post (author-only).
type PostView struct {
	Viewer   string
	ViewedMs int64
}

// ListViews returns a post's viewers (the handler restricts this to the post author).
func (s *Store) ListViews(ctx context.Context, postID string) ([]PostView, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT viewer::text, (extract(epoch from viewed_at)*1000)::bigint
		   FROM post_views WHERE post_id = $1 ORDER BY viewed_at DESC`, postID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PostView
	for rows.Next() {
		var v PostView
		if err := rows.Scan(&v.Viewer, &v.ViewedMs); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// ListEngagement returns all engagement on a post, oldest-first (the caller must
// already be authorized via CanSeePost).
func (s *Store) ListEngagement(ctx context.Context, postID string) ([]PostEngagementRow, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, actor::text, kind, payload, (extract(epoch from created_at)*1000)::bigint
		   FROM post_engagement WHERE post_id = $1 ORDER BY created_at ASC`, postID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PostEngagementRow
	for rows.Next() {
		var e PostEngagementRow
		if err := rows.Scan(&e.ID, &e.Actor, &e.Kind, &e.Payload, &e.CreatedMs); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
