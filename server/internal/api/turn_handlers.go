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
// All media rides TURNS on 443 (the only public path), so a single iceServers
// entry is returned; the client forces iceTransportPolicy:'relay'.
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

	httpx.JSON(w, http.StatusOK, map[string]any{
		"iceServers": []map[string]any{{
			// The actual reachable relay URL(s): turns:<host>:443 (TLS), or
			// plaintext turn:<host>:<port> with one entry per advertised
			// transport (UDP preferred, TCP fallback).
			"urls":       h.TurnURLs,
			"username":   username,
			"credential": password,
		}},
		"ttl": int(turnCredTTL.Seconds()),
		// Group calls negotiate with the SFU over the WS signalling channel.
		"sfu": map[string]any{"signalVia": "ws"},
	})
}
