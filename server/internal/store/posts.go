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
