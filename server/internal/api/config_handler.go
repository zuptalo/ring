package api

import (
	"net/http"

	"ring/server/internal/httpx"
)

// ReleaseNote is one user-facing change in this build's changelog (the changes since
// the last release tag), advertised at /v1/config so the PWA can show a per-user
// "what's new" between the running build and a newly deployed one. Public, non-secret
// build metadata derived from public git history (sha = the change's stable identity).
type ReleaseNote struct {
	SHA     string `json:"sha"`
	Subject string `json:"subject"`
}

// serverConfig (GET /v1/config) lets clients self-configure without baking in
// anything but the base URL: it advertises the canonical public URL, the Web Push
// VAPID public key, the running version, and this build's release notes. No auth -
// it's public, non-secret bootstrap info.
func (h *Handlers) serverConfig(w http.ResponseWriter, r *http.Request) {
	notes := h.ReleaseNotes
	if notes == nil {
		notes = []ReleaseNote{} // serialize as [] rather than null
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"publicUrl":      h.PublicURL,
		"vapidPublicKey": h.VapidPublicKey,
		"callsEnabled":   h.CallsEnabled,
		"maxBlobBytes":   h.maxBlob(),
		"version":        h.Version,
		"notes":          notes,
	})
}
