package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"ring/server/internal/auth"
	"ring/server/internal/httpx"
	"ring/server/internal/store"
)

// maxAvatarThumbBytes caps a directory avatar thumbnail (a small downscaled
// data-URL). Generous enough for a ~256px JPEG/PNG data-URL, tight enough that
// the directory stays cheap to serve.
const maxAvatarThumbBytes = 256 << 10

// maxAboutLen caps the About line length (chars).
const maxAboutLen = 1000

// directoryUserDTO is one public profile in the in-network directory.
type directoryUserDTO struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Avatar      string `json:"avatar,omitempty"`
	About       string `json:"about,omitempty"`
	ProfileAt   int64  `json:"profileAt"`
}

func toDirectoryDTO(u store.DirectoryUser) directoryUserDTO {
	return directoryUserDTO{
		ID:          u.ID,
		Username:    u.Username,
		DisplayName: u.DisplayName,
		Avatar:      u.Avatar,
		About:       u.About,
		ProfileAt:   u.ProfileAt.UnixMilli(),
	}
}

// listUsers (GET /v1/users?q&cursor&limit) returns a page of the public
// directory visible to the caller: every active, username-bearing account except
// the caller and anyone in a mutual-block relationship. `q` substring-matches
// username/display name; paginate by passing back `nextCursor`.
func (h *Handlers) listUsers(w http.ResponseWriter, r *http.Request) {
	viewer, _ := auth.UserID(r.Context())
	q := r.URL.Query().Get("q")
	cursor := r.URL.Query().Get("cursor")
	limit := 100
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	users, next, err := h.Directory.ListUsers(r.Context(), viewer, q, cursor, limit)
	if err != nil {
		slog.Error("directory list failed", "err", err, "viewer", viewer)
		httpx.Error(w, http.StatusInternalServerError, "could not list directory")
		return
	}
	out := make([]directoryUserDTO, 0, len(users))
	for _, u := range users {
		out = append(out, toDirectoryDTO(u))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"users": out, "nextCursor": next})
}

// getUser (GET /v1/users/{id}) returns a single directory profile, 404 if it
// isn't a visible profile to the caller (unknown, inactive, no username, or
// mutually blocked - same opacity as a missing key bundle).
func (h *Handlers) getUser(w http.ResponseWriter, r *http.Request) {
	viewer, _ := auth.UserID(r.Context())
	target := r.PathValue("id")
	if !uuidRE.MatchString(target) {
		httpx.Error(w, http.StatusBadRequest, "invalid user id")
		return
	}
	u, err := h.Directory.GetUser(r.Context(), viewer, target)
	if errors.Is(err, store.ErrNoUser) {
		httpx.Error(w, http.StatusNotFound, "no such user")
		return
	}
	if err != nil {
		slog.Error("directory get failed", "err", err, "viewer", viewer, "target", target)
		httpx.Error(w, http.StatusInternalServerError, "could not fetch user")
		return
	}
	httpx.JSON(w, http.StatusOK, toDirectoryDTO(*u))
}

type updateProfileRequest struct {
	DisplayName string `json:"displayName"`
	Avatar      string `json:"avatar"`
	About       string `json:"about"`
}

// updateProfile (PUT /v1/me/profile) updates the caller's mutable profile fields
// shown in the directory. It NEVER changes the username. An empty avatar/about
// hides that field (the client sends "" when the matching privacy tier is
// 'nobody').
func (h *Handlers) updateProfile(w http.ResponseWriter, r *http.Request) {
	uid, _ := auth.UserID(r.Context())
	var req updateProfileRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxAvatarThumbBytes+8<<10)).Decode(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if len(req.Avatar) > maxAvatarThumbBytes {
		httpx.Error(w, http.StatusBadRequest, "avatar too large")
		return
	}
	if len([]rune(req.About)) > maxAboutLen {
		httpx.Error(w, http.StatusBadRequest, "about too long")
		return
	}
	if err := h.Directory.UpdateProfile(r.Context(), uid, req.DisplayName, req.Avatar, req.About); err != nil {
		slog.Error("update profile failed", "err", err, "user", uid)
		httpx.Error(w, http.StatusInternalServerError, "could not update profile")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type claimUsernameRequest struct {
	Username string `json:"username"`
}

// claimUsername (POST /v1/me/username) is the one-time username claim for a
// legacy account that registered before usernames existed. New accounts already
// have a username from register; this is a no-op surface for them (409).
func (h *Handlers) claimUsername(w http.ResponseWriter, r *http.Request) {
	uid, _ := auth.UserID(r.Context())
	var req claimUsernameRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}
	username, fold, ok := normalizeUsername(req.Username)
	if !ok {
		httpx.Error(w, http.StatusBadRequest, "invalid username")
		return
	}
	err := h.Directory.ClaimUsername(r.Context(), uid, username, fold)
	if errors.Is(err, store.ErrUsernameTaken) {
		httpx.Error(w, http.StatusConflict, "username already taken")
		return
	}
	if errors.Is(err, store.ErrUsernameAlreadySet) {
		httpx.Error(w, http.StatusConflict, "username already set")
		return
	}
	if err != nil {
		slog.Error("claim username failed", "err", err, "user", uid)
		httpx.Error(w, http.StatusInternalServerError, "could not claim username")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"username": username})
}
