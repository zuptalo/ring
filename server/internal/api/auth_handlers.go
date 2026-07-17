package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"

	"ring/server/internal/auth"
	"ring/server/internal/httpx"
	"ring/server/internal/store"
)

// Matches the client's invitation-code shape (src/services/auth.ts INVITE_RE).
var inviteRE = regexp.MustCompile(`^[A-Za-z0-9]{6,8}$`)

type registerRequest struct {
	InvitationCode string `json:"invitationCode"`
	Username       string `json:"username"`
}

type registerResponse struct {
	Token    string `json:"token"`
	UserID   string `json:"userId"`
	Username string `json:"username"`
	// InvitedBy is the user id of whoever created the redeemed code (empty for
	// ownerless dev/first-run codes), so the client can auto-connect to them.
	InvitedBy string `json:"invitedBy,omitempty"`
}

// register validates an invitation code, creates the account, and issues a
// device token. The plaintext token is returned once; the server keeps only its
// hash.
func (h *Handlers) register(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if !inviteRE.MatchString(req.InvitationCode) {
		httpx.Error(w, http.StatusBadRequest, "invalid invitation code")
		return
	}
	username, fold, ok := normalizeUsername(req.Username)
	if !ok {
		httpx.Error(w, http.StatusBadRequest, "invalid username")
		return
	}

	token, err := auth.NewToken()
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not mint token")
		return
	}

	userID, inviterID, err := h.Store.Register(r.Context(), req.InvitationCode, username, fold, auth.HashToken(token))
	if errors.Is(err, store.ErrInviteInvalid) {
		httpx.Error(w, http.StatusBadRequest, "invitation code invalid, used, or expired")
		return
	}
	if errors.Is(err, store.ErrUsernameTaken) {
		httpx.Error(w, http.StatusConflict, "username already taken")
		return
	}
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "registration failed")
		return
	}

	httpx.JSON(w, http.StatusOK, registerResponse{Token: token, UserID: userID, Username: username, InvitedBy: inviterID})
}

// selfResponse is the authenticated user's own id + profile, returned by
// /v1/session and /v1/me so a (re)connecting client learns its own username and
// profile. username is empty for a legacy account that hasn't claimed one yet -
// the client then prompts a one-time POST /v1/me/username.
type selfResponse struct {
	UserID      string `json:"userId"`
	Username    string `json:"username,omitempty"`
	DisplayName string `json:"displayName,omitempty"`
	Avatar      string `json:"avatar,omitempty"`
	About       string `json:"about,omitempty"`
	ProfileAt   int64  `json:"profileAt,omitempty"`
}

// self builds the selfResponse for uid, enriching with profile if the directory
// store is wired (it always is in prod; some handler tests omit it).
func (h *Handlers) self(r *http.Request, uid string) selfResponse {
	resp := selfResponse{UserID: uid}
	if h.Directory == nil {
		return resp
	}
	if p, err := h.Directory.UserProfile(r.Context(), uid); err == nil && p != nil {
		resp.Username = p.Username
		resp.DisplayName = p.DisplayName
		resp.Avatar = p.Avatar
		resp.About = p.About
		resp.ProfileAt = p.ProfileAt.UnixMilli()
	}
	return resp
}

// session verifies the bearer token (via the auth middleware) and reports the
// user id + profile, bumping last_seen_at. This is the backend equivalent of the
// client's token-based login.
func (h *Handlers) session(w http.ResponseWriter, r *http.Request) {
	uid, _ := auth.UserID(r.Context())
	if hash, ok := auth.TokenHash(r.Context()); ok {
		_ = h.Store.TouchToken(r.Context(), hash) // best-effort
	}
	httpx.JSON(w, http.StatusOK, h.self(r, uid))
}

// me returns the authenticated user id + profile (also a smoke test for the auth
// middleware).
func (h *Handlers) me(w http.ResponseWriter, r *http.Request) {
	uid, _ := auth.UserID(r.Context())
	httpx.JSON(w, http.StatusOK, h.self(r, uid))
}

// deleteMe permanently deletes the authenticated account and all of its
// server-side data (cascades to tokens, prekeys, the relay queue, blobs, sync
// records, the recovery wrap, and push subscriptions). Idempotent: deleting an
// already-gone user is a no-op that still returns 204.
func (h *Handlers) deleteMe(w http.ResponseWriter, r *http.Request) {
	uid, ok := auth.UserID(r.Context())
	if !ok || uid == "" {
		httpx.Error(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if err := h.Store.DeleteUser(r.Context(), uid); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not delete account")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type statusRequest struct {
	IDs []string `json:"ids"`
}

// userStatuses reports the lifecycle state of a batch of user ids so clients can
// detect terminated ("Ghosted") peers. Unknown ids report "unknown". Capped to
// keep one request bounded.
func (h *Handlers) userStatuses(w http.ResponseWriter, r *http.Request) {
	var req statusRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}
	// Validate + dedupe (ignore junk so a bad id can't fail the whole batch).
	seen := make(map[string]struct{}, len(req.IDs))
	ids := make([]string, 0, len(req.IDs))
	for _, id := range req.IDs {
		if !uuidRE.MatchString(id) {
			continue
		}
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
		if len(ids) >= 500 {
			break
		}
	}
	states, err := h.Store.UserStates(r.Context(), ids)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not look up statuses")
		return
	}
	statuses := make(map[string]string, len(ids))
	for _, id := range ids {
		if st, ok := states[id]; ok {
			statuses[id] = st
		} else {
			statuses[id] = "unknown"
		}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"statuses": statuses})
}
