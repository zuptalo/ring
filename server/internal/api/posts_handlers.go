package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"ring/server/internal/auth"
	"ring/server/internal/httpx"
	"ring/server/internal/store"
)

// Social Wall handlers (spec 0003). A post is opaque ciphertext (the K_post-sealed
// payload, uploaded as a blob) plus one wrapped-key envelope per audience member. The
// server enforces that every recipient is an accepted friend of the author (and not
// blocked) — but it never sees content, media keys, the audience tier, or the
// close-friends subset. Engagement + views are added with US4/US7.

type postEnvelopeReq struct {
	Recipient  string `json:"recipient"`
	WrappedKey string `json:"wrappedKey"`
}
type createPostReq struct {
	ID        string            `json:"id"`
	BlobID    string            `json:"blobId"`
	Size      int               `json:"size"`
	ExpiresAt int64             `json:"expiresAt"` // epoch ms; 0/absent = keep
	Envelopes []postEnvelopeReq `json:"envelopes"`
}

// maxPostEnvelopes bounds a single post's fan-out (a sanity cap, not a privacy gate).
const maxPostEnvelopes = 1024

// maxPostLifetime is the hard ceiling on how long any post lives, enforced
// server-side regardless of the client (spec 0003, FR-012).
const maxPostLifetime = 72 * time.Hour

// notifyPost sends a content-free "a post is waiting" nudge to a recipient: a live WS
// frame if connected, and an offline push tickle otherwise. Carries no content — the
// client reconciles via GET /v1/posts — preserving the zero-knowledge boundary.
func (h *Handlers) notifyPost(ctx context.Context, recipient, author string) {
	if h.Hub != nil {
		if b, err := json.Marshal(map[string]any{"t": "post-new", "from": author}); err == nil {
			h.Hub.Send(recipient, b)
		}
	}
	if h.Notifier != nil {
		h.Notifier.NotifyPost(ctx, recipient)
	}
}

// createPost (POST /v1/posts) records a post + its per-recipient envelopes. Every
// recipient MUST be an accepted connection of the author (Connected() also excludes
// blocked pairs); otherwise the post is rejected.
func (h *Handlers) createPost(w http.ResponseWriter, r *http.Request) {
	uid, ok := auth.UserID(r.Context())
	if !ok || uid == "" {
		httpx.Error(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req createPostReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256<<10)).Decode(&req); err != nil ||
		!uuidRE.MatchString(req.ID) || req.BlobID == "" || len(req.Envelopes) == 0 ||
		len(req.Envelopes) > maxPostEnvelopes {
		httpx.Error(w, http.StatusBadRequest, "invalid post")
		return
	}
	envs := make([]store.NewPostEnvelope, 0, len(req.Envelopes))
	for _, e := range req.Envelopes {
		if !uuidRE.MatchString(e.Recipient) || e.Recipient == uid || e.WrappedKey == "" {
			httpx.Error(w, http.StatusBadRequest, "invalid recipient")
			return
		}
		// Audience must be friends-only: an accepted connection, not blocked.
		connected, err := h.Connections.Connected(r.Context(), uid, e.Recipient)
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "could not verify audience")
			return
		}
		if !connected {
			httpx.Error(w, http.StatusForbidden, "recipient is not a friend")
			return
		}
		envs = append(envs, store.NewPostEnvelope{Recipient: e.Recipient, WrappedKey: e.WrappedKey})
	}
	// Wall posts are ALWAYS ephemeral: clamp the expiry to at most 72h from now,
	// whatever the client sent (including "no expiry"). This guarantees the
	// 72-hour ceiling server-side, independent of the client (FR-012).
	maxExpiry := time.Now().Add(maxPostLifetime)
	expires := maxExpiry
	if req.ExpiresAt > 0 {
		if t := time.UnixMilli(req.ExpiresAt); t.Before(maxExpiry) {
			expires = t
		}
	}
	if err := h.Posts.CreatePost(r.Context(), store.NewPost{
		ID: req.ID, Author: uid, BlobID: req.BlobID, Size: req.Size, ExpiresAt: &expires, Envelopes: envs,
	}); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not create post")
		return
	}
	for _, e := range envs {
		h.notifyPost(r.Context(), e.Recipient, uid)
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"id": req.ID})
}

type postOut struct {
	ID         string `json:"id"`
	Author     string `json:"author"`
	BlobID     string `json:"blobId"`
	Size       int    `json:"size"`
	CreatedAt  int64  `json:"createdAt"`
	ExpiresAt  int64  `json:"expiresAt,omitempty"`
	WrappedKey string `json:"wrappedKey,omitempty"`
}

// listPosts (GET /v1/posts?since=) returns the caller's own posts + posts addressed
// to them, newest-first, with the caller's wrapped K_post envelope.
func (h *Handlers) listPosts(w http.ResponseWriter, r *http.Request) {
	uid, ok := auth.UserID(r.Context())
	if !ok || uid == "" {
		httpx.Error(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var since int64
	if s := r.URL.Query().Get("since"); s != "" {
		since, _ = strconv.ParseInt(s, 10, 64)
	}
	rows, err := h.Posts.ListPosts(r.Context(), uid, since)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not list posts")
		return
	}
	posts := make([]postOut, 0, len(rows))
	var cursor int64 = since
	for _, p := range rows {
		posts = append(posts, postOut{
			ID: p.ID, Author: p.Author, BlobID: p.BlobID, Size: p.Size,
			CreatedAt: p.CreatedMs, ExpiresAt: p.ExpiresMs, WrappedKey: p.WrappedKey,
		})
		if p.CreatedMs > cursor {
			cursor = p.CreatedMs
		}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"posts": posts, "cursor": cursor})
}

type engagementReq struct {
	ID      string `json:"id"`
	Kind    string `json:"kind"`             // reaction | comment | tombstone
	Payload string `json:"payload"`          // opaque, sealed under K_post
	Target  string `json:"target,omitempty"` // tombstone: the engagement id being removed
}

func validEngagementKind(k string) bool {
	return k == "reaction" || k == "comment" || k == "tombstone"
}

// submitEngagement (POST /v1/posts/{id}/engagement) records one opaque engagement item
// and nudges everyone who can see the post to pull it. Only audience members (or the
// author) may engage; the server never reads the payload.
func (h *Handlers) submitEngagement(w http.ResponseWriter, r *http.Request) {
	uid, ok := auth.UserID(r.Context())
	if !ok || uid == "" {
		httpx.Error(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	postID := r.PathValue("id")
	if !uuidRE.MatchString(postID) {
		httpx.Error(w, http.StatusBadRequest, "invalid id")
		return
	}
	var req engagementReq
	tombstone := false
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&req); err == nil {
		tombstone = req.Kind == "tombstone"
	} else {
		httpx.Error(w, http.StatusBadRequest, "invalid engagement")
		return
	}
	// A tombstone removes a target engagement and needs no payload; reaction/comment
	// carry a sealed payload.
	if !uuidRE.MatchString(req.ID) || !validEngagementKind(req.Kind) ||
		(!tombstone && req.Payload == "") || (tombstone && !uuidRE.MatchString(req.Target)) {
		httpx.Error(w, http.StatusBadRequest, "invalid engagement")
		return
	}
	canSee, err := h.Posts.CanSeePost(r.Context(), postID, uid)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not authorize")
		return
	}
	if !canSee {
		httpx.Error(w, http.StatusForbidden, "not in this post's audience")
		return
	}
	// Moderation: only the original author of the targeted engagement, or the POST's
	// author, may tombstone it (FR-034).
	if tombstone {
		postAuthor, err1 := h.Posts.PostAuthor(r.Context(), postID)
		engActor, err2 := h.Posts.EngagementActor(r.Context(), postID, req.Target)
		if err1 != nil || err2 != nil {
			httpx.Error(w, http.StatusInternalServerError, "could not authorize")
			return
		}
		if uid != postAuthor && uid != engActor {
			httpx.Error(w, http.StatusForbidden, "cannot remove this item")
			return
		}
	}
	// A tombstone carries its (cleartext) target engagement id in place of a sealed
	// payload, so recipients know which item to remove.
	payload := req.Payload
	if tombstone {
		payload = req.Target
	}
	if err := h.Posts.SubmitEngagement(r.Context(), postID, req.ID, uid, req.Kind, payload); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not submit engagement")
		return
	}
	// Nudge everyone who can see the post (content-free) to pull the new engagement.
	if aud, err := h.Posts.PostAudience(r.Context(), postID); err == nil {
		for _, u := range aud {
			if u == uid {
				continue
			}
			if h.Hub != nil {
				if b, e := json.Marshal(map[string]any{"t": "post-engagement", "post": postID}); e == nil {
					h.Hub.Send(u, b)
				}
			}
			if h.Notifier != nil {
				h.Notifier.Notify(r.Context(), u)
			}
		}
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"id": req.ID})
}

type engagementOut struct {
	ID        string `json:"id"`
	Actor     string `json:"actor"`
	Kind      string `json:"kind"`
	Payload   string `json:"payload"`
	CreatedAt int64  `json:"createdAt"`
}

// listEngagement (GET /v1/posts/{id}/engagement) returns the opaque engagement on a
// post the caller can see; the client decrypts under K_post.
func (h *Handlers) listEngagement(w http.ResponseWriter, r *http.Request) {
	uid, ok := auth.UserID(r.Context())
	if !ok || uid == "" {
		httpx.Error(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	postID := r.PathValue("id")
	if !uuidRE.MatchString(postID) {
		httpx.Error(w, http.StatusBadRequest, "invalid id")
		return
	}
	canSee, err := h.Posts.CanSeePost(r.Context(), postID, uid)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not authorize")
		return
	}
	if !canSee {
		httpx.Error(w, http.StatusForbidden, "not in this post's audience")
		return
	}
	rows, err := h.Posts.ListEngagement(r.Context(), postID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not list engagement")
		return
	}
	items := make([]engagementOut, 0, len(rows))
	for _, e := range rows {
		items = append(items, engagementOut{ID: e.ID, Actor: e.Actor, Kind: e.Kind, Payload: e.Payload, CreatedAt: e.CreatedMs})
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
}

// recordView (POST /v1/posts/{id}/view) records that the caller viewed a post,
// delivered to the author only. The caller sends this ONLY when their seen-receipts
// setting is on (client-gated). Must be in the post's audience.
func (h *Handlers) recordView(w http.ResponseWriter, r *http.Request) {
	uid, ok := auth.UserID(r.Context())
	if !ok || uid == "" {
		httpx.Error(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	postID := r.PathValue("id")
	if !uuidRE.MatchString(postID) {
		httpx.Error(w, http.StatusBadRequest, "invalid id")
		return
	}
	canSee, err := h.Posts.CanSeePost(r.Context(), postID, uid)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not authorize")
		return
	}
	if !canSee {
		httpx.Error(w, http.StatusForbidden, "not in this post's audience")
		return
	}
	if err := h.Posts.RecordView(r.Context(), postID, uid); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not record view")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type viewOut struct {
	Viewer   string `json:"viewer"`
	ViewedAt int64  `json:"viewedAt"`
}

// listViews (GET /v1/posts/{id}/views) returns who viewed a post — author-only.
func (h *Handlers) listViews(w http.ResponseWriter, r *http.Request) {
	uid, ok := auth.UserID(r.Context())
	if !ok || uid == "" {
		httpx.Error(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	postID := r.PathValue("id")
	if !uuidRE.MatchString(postID) {
		httpx.Error(w, http.StatusBadRequest, "invalid id")
		return
	}
	author, err := h.Posts.PostAuthor(r.Context(), postID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not authorize")
		return
	}
	if author == "" || author != uid {
		httpx.Error(w, http.StatusForbidden, "only the author can see views")
		return
	}
	rows, err := h.Posts.ListViews(r.Context(), postID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not list views")
		return
	}
	views := make([]viewOut, 0, len(rows))
	for _, v := range rows {
		views = append(views, viewOut{Viewer: v.Viewer, ViewedAt: v.ViewedMs})
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"views": views})
}

// deletePost (DELETE /v1/posts/{id}) deletes the caller's own post (author-only; the
// store guards on author so a non-author delete is a no-op). Idempotent.
func (h *Handlers) deletePost(w http.ResponseWriter, r *http.Request) {
	uid, ok := auth.UserID(r.Context())
	if !ok || uid == "" {
		httpx.Error(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	id := r.PathValue("id")
	if !uuidRE.MatchString(id) {
		httpx.Error(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := h.Posts.DeletePost(r.Context(), uid, id); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not delete post")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
