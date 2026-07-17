package api

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"ring/server/internal/auth"
	"ring/server/internal/httpx"
)

type setContactsRequest struct {
	IDs []string `json:"ids"`
}

// setContacts (PUT /v1/contacts) replaces the caller's contact edges with the
// provided set (a reconcile the client pushes on connect + when contacts change).
// The edges are used only to compute the presence audience for the 'contacts'
// visibility tier. Invalid/dup/self ids are dropped; the set is capped.
func (h *Handlers) setContacts(w http.ResponseWriter, r *http.Request) {
	uid, _ := auth.UserID(r.Context())
	var req setContactsRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256<<10)).Decode(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}
	seen := make(map[string]struct{}, len(req.IDs))
	ids := make([]string, 0, len(req.IDs))
	for _, id := range req.IDs {
		if !uuidRE.MatchString(id) || id == uid {
			continue
		}
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
		if len(ids) >= 5000 {
			break
		}
	}
	if err := h.Contacts.SetContacts(r.Context(), uid, ids); err != nil {
		slog.Error("set contacts failed", "err", err, "user", uid)
		httpx.Error(w, http.StatusInternalServerError, "could not update contacts")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
