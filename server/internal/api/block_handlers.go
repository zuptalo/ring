package api

import (
	"net/http"

	"ring/server/internal/auth"
	"ring/server/internal/httpx"
)

// listBlocks returns the ids the caller has blocked, so a device can reconcile
// its local block ledger on start.
func (h *Handlers) listBlocks(w http.ResponseWriter, r *http.Request) {
	uid, ok := auth.UserID(r.Context())
	if !ok || uid == "" {
		httpx.Error(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	ids, err := h.Blocks.ListBlocks(r.Context(), uid)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not list blocks")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"blocked": ids})
}

// blockUser blocks the path user for the caller. Idempotent. A user blocking
// themselves is rejected as a no-op (it would only hurt the caller).
func (h *Handlers) blockUser(w http.ResponseWriter, r *http.Request) {
	uid, ok := auth.UserID(r.Context())
	if !ok || uid == "" {
		httpx.Error(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	target := r.PathValue("userId")
	if !uuidRE.MatchString(target) || target == uid {
		httpx.Error(w, http.StatusBadRequest, "invalid user id")
		return
	}
	if err := h.Blocks.Block(r.Context(), uid, target); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not block user")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// unblockUser removes the caller's block on the path user. Idempotent.
func (h *Handlers) unblockUser(w http.ResponseWriter, r *http.Request) {
	uid, ok := auth.UserID(r.Context())
	if !ok || uid == "" {
		httpx.Error(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	target := r.PathValue("userId")
	if !uuidRE.MatchString(target) {
		httpx.Error(w, http.StatusBadRequest, "invalid user id")
		return
	}
	if err := h.Blocks.Unblock(r.Context(), uid, target); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not unblock user")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
