package api

import (
	"errors"
	"log/slog"
	"net/http"

	"ring/server/internal/auth"
	"ring/server/internal/httpx"
	"ring/server/internal/store"
)

// createInvitation (POST /v1/invitations) mints a single-use invite code owned
// by the authenticated user, for them to share with someone they want to invite.
func (h *Handlers) createInvitation(w http.ResponseWriter, r *http.Request) {
	uid, _ := auth.UserID(r.Context())
	code, err := h.Invites.CreateInvitation(r.Context(), uid)
	if errors.Is(err, store.ErrInviteLimit) {
		httpx.Error(w, http.StatusTooManyRequests, "you have too many unused invitations")
		return
	}
	if err != nil {
		slog.Error("create invitation failed", "err", err, "user", uid)
		httpx.Error(w, http.StatusInternalServerError, "could not create invitation")
		return
	}
	// publicUrl is returned so the client can build the install message.
	httpx.JSON(w, http.StatusOK, map[string]string{"code": code, "publicUrl": h.PublicURL})
}

// listInvitations (GET /v1/invitations) returns the authenticated user's created
// codes and their redemption state, so the client can detect who redeemed a code
// and auto-connect to them.
func (h *Handlers) listInvitations(w http.ResponseWriter, r *http.Request) {
	uid, _ := auth.UserID(r.Context())
	invites, err := h.Invites.ListInvitations(r.Context(), uid)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not list invitations")
		return
	}
	out := make([]map[string]any, 0, len(invites))
	for _, inv := range invites {
		row := map[string]any{
			"code":      inv.Code,
			"createdAt": inv.CreatedAt.UnixMilli(),
			"usedBy":    inv.UsedBy, // "" if not yet redeemed
		}
		if inv.ExpiresAt != nil {
			row["expiresAt"] = inv.ExpiresAt.UnixMilli()
		}
		if inv.UsedAt != nil {
			row["usedAt"] = inv.UsedAt.UnixMilli()
		}
		out = append(out, row)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"invitations": out})
}

// extendInvitation (POST /v1/invitations/{code}/extend) pushes an unused invite's
// expiry 24h further out. Owner-only, unused-only.
func (h *Handlers) extendInvitation(w http.ResponseWriter, r *http.Request) {
	uid, _ := auth.UserID(r.Context())
	code := r.PathValue("code")
	exp, err := h.Invites.ExtendInvitation(r.Context(), uid, code)
	if errors.Is(err, store.ErrInviteInvalid) {
		httpx.Error(w, http.StatusNotFound, "no such unused invitation to extend")
		return
	}
	if err != nil {
		slog.Error("extend invitation failed", "err", err, "user", uid)
		httpx.Error(w, http.StatusInternalServerError, "could not extend invitation")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"code": code, "expiresAt": exp.UnixMilli()})
}

// cancelInvitation (DELETE /v1/invitations/{code}) deletes an unused invite so it
// can't be redeemed. Owner-only, unused-only.
func (h *Handlers) cancelInvitation(w http.ResponseWriter, r *http.Request) {
	uid, _ := auth.UserID(r.Context())
	code := r.PathValue("code")
	err := h.Invites.CancelInvitation(r.Context(), uid, code)
	if errors.Is(err, store.ErrInviteInvalid) {
		httpx.Error(w, http.StatusNotFound, "no such unused invitation to cancel")
		return
	}
	if err != nil {
		slog.Error("cancel invitation failed", "err", err, "user", uid)
		httpx.Error(w, http.StatusInternalServerError, "could not cancel invitation")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"code": code, "cancelled": true})
}
