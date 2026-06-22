package api

import (
	"encoding/json"
	"net/http"

	"ring/server/internal/auth"
	"ring/server/internal/httpx"
	"ring/server/internal/store"
)

type pushSubscriptionDTO struct {
	Endpoint string `json:"endpoint"`
	Keys     struct {
		P256dh string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
	// Optional per-device metadata for the 9-AM-local version announcement (spec 1016).
	// Pointers so an omitted field (e.g. the SW resubscribe path) preserves the stored value.
	InstalledVersion *string `json:"installedVersion"`
	TzOffsetMinutes  *int    `json:"tzOffsetMinutes"`
}

// subscribePush (POST /v1/push/subscribe) registers a browser push subscription.
func (h *Handlers) subscribePush(w http.ResponseWriter, r *http.Request) {
	uid, _ := auth.UserID(r.Context())
	var req pushSubscriptionDTO
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Endpoint == "" || req.Keys.P256dh == "" || req.Keys.Auth == "" {
		httpx.Error(w, http.StatusBadRequest, "missing endpoint or keys")
		return
	}
	if err := h.Push.SaveSubscription(r.Context(), uid, store.PushSubscription{
		Endpoint: req.Endpoint, P256dh: req.Keys.P256dh, Auth: req.Keys.Auth,
	}, req.InstalledVersion, req.TzOffsetMinutes); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not save subscription")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// unsubscribePush (POST /v1/push/unsubscribe) removes a subscription.
func (h *Handlers) unsubscribePush(w http.ResponseWriter, r *http.Request) {
	uid, _ := auth.UserID(r.Context())
	var req struct {
		Endpoint string `json:"endpoint"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&req); err != nil || req.Endpoint == "" {
		httpx.Error(w, http.StatusBadRequest, "missing endpoint")
		return
	}
	if err := h.Push.DeleteSubscription(r.Context(), uid, req.Endpoint); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not remove subscription")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
