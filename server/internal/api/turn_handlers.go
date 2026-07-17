package api

import (
	"net/http"
	"time"

	"ring/server/internal/auth"
	"ring/server/internal/httpx"
	"ring/server/internal/turn"
)

// turnCredTTL is how long an issued TURN credential stays valid. Long enough to
// cover placing + holding a call (with a mid-call refresh), short enough that a
// leaked credential expires quickly.
const turnCredTTL = time.Hour

// turnCredentials (GET /v1/turn-credentials, bearer auth) issues ephemeral
// ICE/TURN configuration for the calling client. The username/password are
// time-windowed (coturn REST scheme) and minted from the same shared secret the
// embedded relay validates with, so no per-credential server state is needed.
//
// Media goes direct when the networks allow it (the client gathers with
// iceTransportPolicy:'all') and falls back to the relay otherwise. The
// credentialed entry always carries the TURNS-on-443 relay; when the operator
// opted into the UDP endpoint it also lists TURN-over-UDP, and a second,
// credential-less stun: entry is appended for public-address discovery. The
// response shape is stable — old clients simply ignore the extra entry.
func (h *Handlers) turnCredentials(w http.ResponseWriter, r *http.Request) {
	if !h.CallsEnabled {
		httpx.Error(w, http.StatusServiceUnavailable, "calling is not enabled on this server")
		return
	}
	uid, ok := auth.UserID(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}

	username, password, err := turn.MintCredentials(h.TurnSharedSecret, uid, turnCredTTL)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not mint TURN credentials")
		return
	}

	iceServers := []map[string]any{{
		// The actual reachable relay URL(s): turns:<host>:443 (TLS, always), plus
		// turn:<host>:<port>?transport=udp when the UDP endpoint is on; or
		// plaintext turn:<host>:<port> per advertised transport in dev.
		"urls":       h.TurnURLs,
		"username":   username,
		"credential": password,
	}}
	// Credential-less STUN advertisement (STUN Binding is unauthenticated
	// address discovery); present only when the operator opened the UDP port.
	if len(h.StunURLs) > 0 {
		iceServers = append(iceServers, map[string]any{"urls": h.StunURLs})
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"iceServers": iceServers,
		"ttl":        int(turnCredTTL.Seconds()),
	})
}
