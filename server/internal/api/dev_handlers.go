package api

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"ring/server/internal/httpx"
	"ring/server/internal/ws"
)

// devMintInvite mints a fresh single-use invitation code and returns {"code"}.
// Dev/test only: the route is mounted only when Handlers.DevMode is set (ENV=dev),
// so production never exposes unauthenticated code minting. It lets the e2e harness
// register every account (and every Playwright retry) with a code that is fresh,
// avoiding consumed-code / username-collision failures on re-runs.
func (h *Handlers) devMintInvite(w http.ResponseWriter, r *http.Request) {
	code, err := h.Invites.MintInvite(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not mint invite")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"code": code})
}

// devPushTest fires a MESSAGE-tickle Web Push at every subscription of the given
// user, through the exact production sender (same TTL/topic/urgency/sealing) —
// the definitive device-side probe when "pushes accepted upstream but nothing
// shows on the phone" needs isolating (Ring pipeline vs the OS notification
// leg). Dev/test only. Body: {"userId": "<uuid>", "ttl": <optional int>}.
//
// Passing "ttl" (e.g. 0) sends via NotifyDebug — a caller-chosen TTL with NO
// collapse topic ("deliver now or discard" at ttl:0) — to rule the message TTL
// and collapse settings in or out: if an online device shows nothing even for a
// ttl:0 push, TTL is not the cause and the loss is on the device.
func (h *Handlers) devPushTest(w http.ResponseWriter, r *http.Request) {
	var b struct {
		UserID string `json:"userId"`
		TTL    *int   `json:"ttl"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil || b.UserID == "" {
		httpx.Error(w, http.StatusBadRequest, "userId required")
		return
	}
	if b.TTL != nil {
		if dbg, ok := h.Notifier.(interface {
			NotifyDebug(ctx context.Context, userID string, ttl int)
		}); ok {
			dbg.NotifyDebug(r.Context(), b.UserID, *b.TTL)
		} else {
			httpx.Error(w, http.StatusNotImplemented, "notifier has no debug send")
			return
		}
	} else {
		h.Notifier.Notify(r.Context(), b.UserID)
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// devCallConfig sets the call tunables (participant caps + ring/recovery cadence) at runtime
// so the e2e suite can exercise the cap-refusal and re-ring paths with a handful of browser
// contexts and in seconds, instead of 9 participants and a 60s reminder window. Dev/test only
// (mounted only when DevMode is set). Absolute values; omitted fields reset to the production
// defaults, so POST {} restores everything. The suite runs serially (workers:1), so mutating
// these process globals per test is safe.
func (h *Handlers) devCallConfig(w http.ResponseWriter, r *http.Request) {
	var b struct {
		VideoMax        *int `json:"videoMax"`
		AudioMax        *int `json:"audioMax"`
		RingCount       *int `json:"ringCount"`
		RingIntervalMs  *int `json:"ringIntervalMs"`
		RecoveryGraceMs *int `json:"recoveryGraceMs"`
	}
	_ = json.NewDecoder(r.Body).Decode(&b) // a bad/empty body just means "all defaults"
	val := func(p *int, def int) int {
		if p != nil {
			return *p
		}
		return def
	}
	ws.ApplyTestCallConfig(
		val(b.VideoMax, 4),
		val(b.AudioMax, 8),
		val(b.RingCount, 6),
		time.Duration(val(b.RingIntervalMs, 10000))*time.Millisecond,
		time.Duration(val(b.RecoveryGraceMs, 18000))*time.Millisecond,
	)
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}
