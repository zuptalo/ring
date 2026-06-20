package api

import (
	"context"
	"encoding/json"
	"net/http"

	"ring/server/internal/auth"
	"ring/server/internal/httpx"
	"ring/server/internal/store"
)

// Connect-request lifecycle: directory-initiated 1:1 connections. A request is
// metadata only (just user ids; the requester's profile is already public in the
// directory), so it can be relayed even before any E2EE session exists. The peer
// accepts/rejects; only an accepted connection lets either side fetch the other's
// prekey bundle (when the gate is on), so E2EE messaging starts after consent.

type connTargetReq struct {
	Target string `json:"target"`
}
type connPeerReq struct {
	Requester string `json:"requester"`
	Block     bool   `json:"block"`
}

// notifyConn pushes a live connect-request control frame to a user (best-effort;
// the client also reconciles via GET /v1/connections on connect).
func (h *Handlers) notifyConn(userID string, frame map[string]any) {
	if h.Hub == nil {
		return
	}
	if b, err := json.Marshal(frame); err == nil {
		h.Hub.Send(userID, b)
	}
}

// wakeConn sends a content-free push tickle so an OFFLINE peer learns of a
// friend-request lifecycle event (the live notifyConn frame above only reaches a
// connected client). Fire-and-forget; nil Notifier (tests / push disabled) is a
// no-op. The tickle carries no identity — the SW reconciles state via
// GET /v1/connections — so the zero-knowledge boundary is preserved.
func (h *Handlers) wakeConn(ctx context.Context, userID string) {
	if h.Notifier == nil {
		return
	}
	h.Notifier.NotifyConn(ctx, userID)
}

// requestConnection (POST /v1/connections/request) records a pending request from
// the caller to {target} and notifies the target.
func (h *Handlers) requestConnection(w http.ResponseWriter, r *http.Request) {
	uid, ok := auth.UserID(r.Context())
	if !ok || uid == "" {
		httpx.Error(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req connTargetReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req); err != nil ||
		!uuidRE.MatchString(req.Target) || req.Target == uid {
		httpx.Error(w, http.StatusBadRequest, "invalid target")
		return
	}
	// A target who has blocked the caller must not learn of the request: pretend it
	// went through (return pending) without recording or notifying.
	if blocked, err := h.Blocks.IsBlocked(r.Context(), req.Target, uid); err == nil && blocked {
		httpx.JSON(w, http.StatusOK, map[string]any{"state": "pending"})
		return
	}
	state, err := h.Connections.RequestConnection(r.Context(), uid, req.Target)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not send request")
		return
	}
	if state == "pending" {
		h.notifyConn(req.Target, map[string]any{"t": "connect-req", "from": uid})
		h.wakeConn(r.Context(), req.Target) // wake an offline target (FR-008)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"state": state})
}

// acceptConnection (POST /v1/connections/accept) accepts the pending request FROM
// {requester} to the caller, and notifies the requester.
func (h *Handlers) acceptConnection(w http.ResponseWriter, r *http.Request) {
	uid, ok := auth.UserID(r.Context())
	if !ok || uid == "" {
		httpx.Error(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req connPeerReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req); err != nil ||
		!uuidRE.MatchString(req.Requester) || req.Requester == uid {
		httpx.Error(w, http.StatusBadRequest, "invalid requester")
		return
	}
	if err := h.Connections.AcceptConnection(r.Context(), uid, req.Requester); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not accept")
		return
	}
	h.notifyConn(req.Requester, map[string]any{"t": "connect-update", "from": uid, "state": "accepted"})
	h.wakeConn(r.Context(), req.Requester) // wake an offline requester (FR-009)
	w.WriteHeader(http.StatusNoContent)
}

// withdrawConnection (POST /v1/connections/withdraw) lets the caller (requester)
// take back a pending request they sent to {target}. The pending row is removed
// server-side so the target's incoming list drops it; the target is notified so its
// UI/badge update live.
func (h *Handlers) withdrawConnection(w http.ResponseWriter, r *http.Request) {
	uid, ok := auth.UserID(r.Context())
	if !ok || uid == "" {
		httpx.Error(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req connTargetReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req); err != nil ||
		!uuidRE.MatchString(req.Target) || req.Target == uid {
		httpx.Error(w, http.StatusBadRequest, "invalid target")
		return
	}
	if err := h.Connections.WithdrawConnection(r.Context(), uid, req.Target); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not withdraw")
		return
	}
	// Tell the target their incoming request is gone (so it leaves their list/badge).
	h.notifyConn(req.Target, map[string]any{"t": "connect-update", "from": uid, "state": "withdrawn"})
	w.WriteHeader(http.StatusNoContent)
}

// rejectConnection (POST /v1/connections/reject) rejects (optionally + blocks) the
// pending request from {requester}; a block also hides the caller from them.
func (h *Handlers) rejectConnection(w http.ResponseWriter, r *http.Request) {
	uid, ok := auth.UserID(r.Context())
	if !ok || uid == "" {
		httpx.Error(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req connPeerReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req); err != nil ||
		!uuidRE.MatchString(req.Requester) || req.Requester == uid {
		httpx.Error(w, http.StatusBadRequest, "invalid requester")
		return
	}
	if err := h.Connections.RejectConnection(r.Context(), uid, req.Requester, req.Block); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not reject")
		return
	}
	// Tell the requester it was rejected (a blocked requester can no longer see the
	// caller in the directory either).
	h.notifyConn(req.Requester, map[string]any{"t": "connect-update", "from": uid, "state": "rejected"})
	h.wakeConn(r.Context(), req.Requester) // wake an offline requester (FR-010)
	w.WriteHeader(http.StatusNoContent)
}

// linkConnection (POST /v1/connections/link) creates an accepted connection from the
// caller to {target} WITHOUT a request - used by the client to connect group
// co-members (group membership is the consent) so fan-out can fetch their bundles
// under the gate. No notification (it isn't a request the peer needs to act on).
func (h *Handlers) linkConnection(w http.ResponseWriter, r *http.Request) {
	uid, ok := auth.UserID(r.Context())
	if !ok || uid == "" {
		httpx.Error(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req connTargetReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req); err != nil ||
		!uuidRE.MatchString(req.Target) || req.Target == uid {
		httpx.Error(w, http.StatusBadRequest, "invalid target")
		return
	}
	// AcceptConnection(target, requester) creates accepted(requester->target); here
	// caller is the requester, so this is accepted(caller->target).
	if err := h.Connections.AcceptConnection(r.Context(), req.Target, uid); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not link")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type connDTO struct {
	Requester string `json:"requester"`
	Target    string `json:"target"`
	State     string `json:"state"`
	UpdatedAt int64  `json:"updatedAt"`
}

// listConnections (GET /v1/connections) returns the caller's incoming (pending,
// awaiting their accept) and outgoing (pending/rejected) requests so a client can
// reconcile its UI on connect.
func (h *Handlers) listConnections(w http.ResponseWriter, r *http.Request) {
	uid, ok := auth.UserID(r.Context())
	if !ok || uid == "" {
		httpx.Error(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	incoming, err := h.Connections.IncomingRequests(r.Context(), uid)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not list connections")
		return
	}
	outgoing, err := h.Connections.OutgoingRequests(r.Context(), uid)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not list connections")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"incoming": connDTOs(incoming),
		"outgoing": connDTOs(outgoing),
	})
}

func connDTOs(rs []store.ConnectionReq) []connDTO {
	out := make([]connDTO, 0, len(rs))
	for _, r := range rs {
		out = append(out, connDTO{Requester: r.Requester, Target: r.Target, State: r.State, UpdatedAt: r.UpdatedMs})
	}
	return out
}
