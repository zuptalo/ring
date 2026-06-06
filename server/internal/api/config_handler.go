package api

import (
	"net/http"

	"ring/server/internal/httpx"
)

// serverConfig (GET /v1/config) lets clients self-configure without baking in
// anything but the base URL: it advertises the canonical public URL and the
// Web Push VAPID public key. No auth - it's public, non-secret bootstrap info.
func (h *Handlers) serverConfig(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, map[string]any{
		"publicUrl":      h.PublicURL,
		"vapidPublicKey": h.VapidPublicKey,
		"callsEnabled":   h.CallsEnabled,
		"maxBlobBytes":   h.maxBlob(),
	})
}
