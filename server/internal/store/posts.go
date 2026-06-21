package store

import (
	"context"
	"time"
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
	WrappedKey string // "" for own posts
}

// CreatePost stores a post and its envelopes atomically.
func (s *Store) CreatePost(ctx context.Context, p NewPost) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx,
		`INSERT INTO posts (id, author, blob_id, size, expires_at) VALUES ($1, $2, $3, $4, $5)`,
		p.ID, p.Author, p.BlobID, p.Size, p.ExpiresAt); err != nil {
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
		if err := rows.Scan(&p.ID, &p.Author, &p.BlobID, &p.Size, &p.CreatedMs, &p.ExpiresMs, &p.WrappedKey); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// DeletePost removes a post (and, via cascade, its envelopes/engagement/views). The
// author-only guard is the `author` predicate, so a non-author delete is a no-op.
func (s *Store) DeletePost(ctx context.Context, author, id string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM posts WHERE id = $1 AND author::text = $2`, id, author)
	return err
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
func (s *Store) SubmitEngagement(ctx context.Context, postID, id, actor, kind, payload string) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO post_engagement (id, post_id, actor, kind, payload) VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (id) DO NOTHING`,
		id, postID, actor, kind, payload)
	return err
}

// PostEngagementRow is one opaque engagement item delivered to an audience member.
type PostEngagementRow struct {
	ID        string
	Actor     string
	Kind      string
	Payload   string
	CreatedMs int64
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
