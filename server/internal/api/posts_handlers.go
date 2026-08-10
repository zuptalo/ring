package api

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"slices"
	"strconv"
	"strings"
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
	TtlMs     int64             `json:"ttlMs"`     // per-post lifetime window
	Envelopes []postEnvelopeReq `json:"envelopes"`
}

// maxPostEnvelopes bounds a single post's fan-out (a sanity cap, not a privacy gate).
const maxPostEnvelopes = 1024

// maxPostLifetime is the hard ceiling on how long any post lives, enforced
// server-side regardless of the client (spec 0003, FR-012).
const maxPostLifetime = 72 * time.Hour

// FR-008 anti-flood volume limits. Enforced using ONLY routing metadata the server
// already holds (counts of recent rows by author / actor / post) — never by reading
// content. The windows are deliberately generous: a real person never hits them, but
// a script that tries to flood a Wall or a viewer is throttled with 429.
const (
	rateWindowSec            = 60 // sliding window for all three caps
	maxPostsPerWindow        = 20 // posts a single author may create per window
	maxEngagementsPerWindow  = 60 // reactions+comments a single actor may submit per window
	maxCommentsPerPostWindow = 10 // comments one actor may add to ONE post per window
)

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
		h.Notifier.NotifyPost(ctx, recipient, author)
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
	// FR-008 per-author post-rate limit (anti-flood) — counts only the author's own
	// recent posts, no content involved.
	if n, err := h.Posts.RecentPostCount(r.Context(), uid, rateWindowSec); err == nil && n >= maxPostsPerWindow {
		httpx.Error(w, http.StatusTooManyRequests, "posting too fast, please slow down")
		return
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
	// Clamp the per-post window to (0, 72h]; default 72h.
	ttl := req.TtlMs
	if ttl <= 0 || ttl > maxPostLifetime.Milliseconds() {
		ttl = maxPostLifetime.Milliseconds()
	}
	if err := h.Posts.CreatePost(r.Context(), store.NewPost{
		ID: req.ID, Author: uid, BlobID: req.BlobID, Size: req.Size, ExpiresAt: &expires, TtlMs: ttl, Envelopes: envs,
	}); err != nil {
		if errors.Is(err, store.ErrPostIDTaken) {
			httpx.Error(w, http.StatusForbidden, "post id unavailable")
			return
		}
		// Kept after the spec-2036 hunt: an unlogged store error here cost a whole
		// debugging round-trip (the duplicate-key churn surfaced only as bare 500s).
		slog.Error("create post failed", "err", err, "post", req.ID)
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
	TtlMs      int64  `json:"ttlMs,omitempty"`
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
			CreatedAt: p.CreatedMs, ExpiresAt: p.ExpiresMs, TtlMs: p.TtlMs, WrappedKey: p.WrappedKey,
		})
		if p.CreatedMs > cursor {
			cursor = p.CreatedMs
		}
	}
	// Revocations: posts the caller was removed from (e.g. dropped from close friends)
	// so the client deletes its local copies. Idempotent.
	revoked, _ := h.Posts.ListRevocations(r.Context(), uid)
	httpx.JSON(w, http.StatusOK, map[string]any{"posts": posts, "cursor": cursor, "revoked": revoked})
}

// removePostRecipient (DELETE /v1/posts/{id}/recipient/{userId}) drops a recipient from
// one of the caller's own posts (author-only) and signals them to remove their copy —
// used when un-close-friending someone to revoke close-only posts.
func (h *Handlers) removePostRecipient(w http.ResponseWriter, r *http.Request) {
	uid, ok := auth.UserID(r.Context())
	if !ok || uid == "" {
		httpx.Error(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	postID := r.PathValue("id")
	recipient := r.PathValue("userId")
	if !uuidRE.MatchString(postID) || !uuidRE.MatchString(recipient) {
		httpx.Error(w, http.StatusBadRequest, "invalid id")
		return
	}
	owns, err := h.Posts.RemovePostRecipient(r.Context(), postID, uid, recipient)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not revoke")
		return
	}
	if !owns {
		httpx.Error(w, http.StatusForbidden, "not your post")
		return
	}
	// Signal the removed recipient: a live frame to delete it now, and a push so an
	// offline device picks up the revocation on its next sync.
	if h.Hub != nil {
		if b, e := json.Marshal(map[string]any{"t": "post-revoke", "post": postID}); e == nil {
			h.Hub.Send(recipient, b)
		}
	}
	if h.Notifier != nil {
		// A revocation rides the same post class: a recipient who muted this
		// author's posts simply reconciles the removal on next open (spec 1050).
		h.Notifier.NotifyPost(r.Context(), recipient, uid)
	}
	w.WriteHeader(http.StatusNoContent)
}

// maxNotifyTargets caps the wake hint. The notification rules never name more
// than two people (the post owner and the person answered), so a longer list is
// an attempt to use the field as a broadcast primitive, not a legitimate call.
const maxNotifyTargets = 2
const maxActivityPreviewBytes = 2048

type engagementReq struct {
	ID      string `json:"id"`
	Kind    string `json:"kind"`             // reaction | comment | game | tombstone
	Payload string `json:"payload"`          // opaque, sealed under K_post
	Target  string `json:"target,omitempty"` // tombstone: the engagement id being removed
	// Notify (spec 1065 FR-031b) names who to wake. The server routes push and can
	// only route to someone it can name, and it cannot read the sealed parent that
	// says who a reply answers — so the sending device says.
	//
	// What the server learns: who a reply is addressed to. What it still cannot
	// learn: which comment was answered, any text or emoji, or the size of any
	// thread. It is validated against the audience so it cannot wake a stranger,
	// capped so it cannot become a broadcast primitive, used only for routing,
	// and NEVER persisted or logged.
	Notify  []string `json:"notify,omitempty"`
	Preview string   `json:"preview,omitempty"` // opaque sender-sealed wording; routed, never stored
}

// "follow" (spec 1036): a content-free opt-in to a challenge post's outcome —
// the server learns only that this user wants the result push (the same
// visibility class as reacting). Removed by tombstone. Never pushes anyone.
// "gameover" (spec 1036): the final mover's device announcing the game ended,
// so the result push can fan to participants + followers without the server
// ever reading a move. Payloads for both stay sealed under K_post.
// "game" (spec 0009): an accept or move on a game-challenge post. The payload
// stays sealed under K_post like every other kind — the server learns only that
// a post has game-type engagement, the same class of metadata as its existing
// reaction-vs-comment distinction.
func validEngagementKind(k string) bool {
	return k == "reaction" || k == "comment" || k == "tombstone" || k == "game" || k == "follow" || k == "gameover"
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
	// Authorize the ACTOR before inspecting any named target. Otherwise an outsider
	// who knows a post id could distinguish "target is in the audience" from "target
	// is not" by comparing validation errors, turning this convenience field into an
	// audience-membership oracle.
	canSee, err := h.Posts.CanSeePost(r.Context(), postID, uid)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not authorize")
		return
	}
	if !canSee {
		httpx.Error(w, http.StatusForbidden, "not in this post's audience")
		return
	}

	// Validate the wake hint before anything else touches it (spec 1065 FR-031b).
	// Every entry must be a real user in this post's audience, so the field cannot
	// be used to wake someone who is not entitled to see the post in the first
	// place, and it is capped so it cannot fan out.
	if len(req.Notify) > maxNotifyTargets {
		httpx.Error(w, http.StatusBadRequest, "notify too long")
		return
	}
	if len(req.Preview) > maxActivityPreviewBytes || (req.Preview != "" && len(req.Notify) == 0) {
		httpx.Error(w, http.StatusBadRequest, "invalid preview")
		return
	}
	notify := make([]string, 0, len(req.Notify))
	for _, target := range req.Notify {
		if !uuidRE.MatchString(target) {
			httpx.Error(w, http.StatusBadRequest, "bad notify")
			return
		}
		if target == uid {
			continue // you never wake yourself
		}
		ok, err := h.Posts.CanSeePost(r.Context(), postID, target)
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "could not authorize")
			return
		}
		if !ok {
			httpx.Error(w, http.StatusBadRequest, "notify outside audience")
			return
		}
		notify = append(notify, target)
	}

	// FR-008 anti-flood volume limits (skip tombstones — removing your own item is not
	// flooding). Per-actor engagement rate guards a viewer against being spammed; the
	// per-post comment rate guards a single Wall thread. Counts only, never content.
	if !tombstone {
		if n, err := h.Posts.RecentEngagementCount(r.Context(), uid, rateWindowSec); err == nil && n >= maxEngagementsPerWindow {
			httpx.Error(w, http.StatusTooManyRequests, "engaging too fast, please slow down")
			return
		}
		if req.Kind == "comment" {
			if n, err := h.Posts.RecentCommentCount(r.Context(), postID, uid, rateWindowSec); err == nil && n >= maxCommentsPerPostWindow {
				httpx.Error(w, http.StatusTooManyRequests, "commenting too fast, please slow down")
				return
			}
		}
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
	// This WS fan-out is DATA SYNC, not alerting: a reaction appearing/disappearing
	// must reach online viewers immediately so the post renders correctly for all.
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
		}
	}
	// A web push (which can WAKE an offline device) goes to the POST OWNER only
	// (spec 1031): engagement is an interaction with THEIR content, so nobody else —
	// not the audience, not co-commenters, and never the actor — is woken for it.
	// Tombstones (removals) never push. The reaction add-vs-remove flag is sealed
	// under K_post, so the owner's DEVICE makes the final show/skip call after
	// decrypting; the server only routes on metadata it already holds (author id).
	// A failed author lookup skips the push rather than failing the write — the
	// engagement is stored and the WS frames above already went out.
	//
	// EXCEPTION — kind "game" (spec 0009, narrowed by spec 1035): a game riding
	// a post must reach its PLAYERS while their app is CLOSED (a turn-based game
	// whose player never learns it is their turn defeats the feature) — but only
	// its players. The participants are the post author plus everyone who has
	// previously written a `game` engagement here (the accept and every move are
	// all kind "game", and the CURRENT row is already stored, so the accepter is
	// a participant from their own accept onward). The passive audience is never
	// woken per move — their one game push stays the challenge post itself; a
	// spectator device learns of results on its next ordinary wake or open.
	// Routing uses only kind + actor, which the server already stores; each
	// woken device still pulls, decrypts under K_post, and decides locally.
	if h.Notifier != nil && !tombstone {
		switch req.Kind {
		case "game", "gameover":
			// Participants always; on GAMEOVER also the followers (spec 1036) —
			// the one end-of-game wake an opted-in spectator asked for.
			targets := map[string]bool{}
			if players, err := h.Posts.GameParticipants(r.Context(), postID); err == nil {
				for _, u := range players {
					targets[u] = true
				}
			}
			if author, err := h.Posts.PostAuthor(r.Context(), postID); err == nil && author != "" {
				targets[author] = true
			}
			if req.Kind == "gameover" {
				if followers, err := h.Posts.GameFollowers(r.Context(), postID); err == nil {
					for _, u := range followers {
						targets[u] = true
					}
				}
			}
			for u := range targets {
				if u == uid {
					continue
				}
				h.Notifier.NotifyPostActivity(r.Context(), u, postID)
			}
		case "follow":
			// An opt-in is bookkeeping, not activity — nobody is woken for it.
		default:
			// The post owner as always, plus anyone the sender named (a reply
			// names the person it answers). Deduplicated, so an owner replied to
			// on their own post is woken once, not twice.
			targets := map[string]bool{}
			if author, err := h.Posts.PostAuthor(r.Context(), postID); err == nil && author != "" && author != uid {
				targets[author] = true
			}
			for _, t := range notify {
				targets[t] = true
			}
			for t := range targets {
				if req.Preview != "" && slices.Contains(notify, t) {
					h.Notifier.NotifyPostActivityPreview(r.Context(), t, postID, []byte(req.Preview))
				} else {
					h.Notifier.NotifyPostActivity(r.Context(), t, postID)
				}
			}
		}
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"id": req.ID})
}

// The engagement cursor is "<createdMs>.<id>" — the (created_at, id) keyset pair.
// Opaque to clients by contract; the format is an implementation detail.
func formatEngagementCursor(ms int64, id string) string {
	return strconv.FormatInt(ms, 10) + "." + id
}

func parseEngagementCursor(s string) (int64, string, error) {
	dot := strings.IndexByte(s, '.')
	if dot <= 0 || dot == len(s)-1 {
		return 0, "", errBadCursor
	}
	ms, err := strconv.ParseInt(s[:dot], 10, 64)
	if err != nil || ms < 0 {
		return 0, "", errBadCursor
	}
	id := s[dot+1:]
	if !uuidRE.MatchString(id) {
		return 0, "", errBadCursor
	}
	return ms, id, nil
}

var errBadCursor = errors.New("bad engagement cursor")

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
	// Paging is additive (spec 1065): a caller that sends neither parameter still
	// gets a working `items` array, now bounded rather than the post's whole
	// history. `cursor` is opaque on purpose — it encodes (created_at, id), and
	// clients have no business parsing it.
	page := store.EngagementPage{Limit: store.DefaultEngagementLimit}
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > store.MaxEngagementLimit {
			httpx.Error(w, http.StatusBadRequest, "invalid limit")
			return
		}
		page.Limit = n
	}
	if raw := r.URL.Query().Get("before"); raw != "" {
		ms, id, err := parseEngagementCursor(raw)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "invalid before")
			return
		}
		page.BeforeMs, page.BeforeID = ms, id
	}
	// Ask the store for one look-ahead row. A page containing exactly `limit`
	// items is not proof that another page exists; limit+1 makes hasMore truthful
	// without a count query and the extra row is never returned.
	requestedLimit := page.Limit
	page.Limit++
	rows, err := h.Posts.ListEngagement(r.Context(), postID, page)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not list engagement")
		return
	}
	hasMore := len(rows) > requestedLimit
	if hasMore {
		rows = rows[:requestedLimit]
	}
	items := make([]engagementOut, 0, len(rows))
	for _, e := range rows {
		items = append(items, engagementOut{ID: e.ID, Actor: e.Actor, Kind: e.Kind, Payload: e.Payload, CreatedAt: e.CreatedMs})
	}
	out := map[string]any{"items": items}
	if hasMore && len(rows) > 0 {
		last := rows[len(rows)-1]
		out["cursor"] = formatEngagementCursor(last.CreatedMs, last.ID)
		out["hasMore"] = true
	} else {
		out["hasMore"] = false
	}
	httpx.JSON(w, http.StatusOK, out)
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
	recipients, err := h.Posts.DeletePost(r.Context(), uid, id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not delete post")
		return
	}
	// Live prune: tell every online recipient to drop its local copy right now (offline ones
	// catch it via listPosts.revoked on their next sync — the post_deletions tombstone).
	if h.Hub != nil {
		if b, err := json.Marshal(map[string]any{"t": "post-revoke", "post": id}); err == nil {
			for _, rec := range recipients {
				h.Hub.Send(rec, b)
			}
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

// keepAlivePost (author-only) pushes a post's auto-delete back to a full window from now —
// the explicit "Keep for longer" action. 404 if it isn't the caller's post.
func (h *Handlers) keepAlivePost(w http.ResponseWriter, r *http.Request) {
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
	ok, err := h.Posts.KeepAlive(r.Context(), uid, id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not extend post")
		return
	}
	if !ok {
		httpx.Error(w, http.StatusNotFound, "post not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// addPostEnvelopes broadens a post's audience (author-only): the client re-wraps K_post to
// the newly-included friends and posts their envelopes here. Newly-added recipients get a
// SILENT live delivery (a `post-new` frame with no `from` → the device syncs the post into its
// feed without a banner) — a visibility change must NOT notify anyone (the explicit ask).
func (h *Handlers) addPostEnvelopes(w http.ResponseWriter, r *http.Request) {
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
	var req createPostReq // reuse: it carries Envelopes []{Recipient, WrappedKey}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256<<10)).Decode(&req); err != nil ||
		len(req.Envelopes) == 0 || len(req.Envelopes) > maxPostEnvelopes {
		httpx.Error(w, http.StatusBadRequest, "invalid envelopes")
		return
	}
	envs := make([]store.NewPostEnvelope, 0, len(req.Envelopes))
	for _, e := range req.Envelopes {
		if !uuidRE.MatchString(e.Recipient) || e.Recipient == uid || e.WrappedKey == "" {
			httpx.Error(w, http.StatusBadRequest, "invalid recipient")
			return
		}
		// Same audience rule as createPost: recipients must be accepted, non-blocked friends.
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
	added, err := h.Posts.AddEnvelopes(r.Context(), uid, id, envs)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not update audience")
		return
	}
	if h.Hub != nil {
		if b, err := json.Marshal(map[string]any{"t": "post-new"}); err == nil {
			for _, rec := range added {
				h.Hub.Send(rec, b)
			}
		}
	}
	w.WriteHeader(http.StatusNoContent)
}
