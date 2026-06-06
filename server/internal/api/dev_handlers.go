package api

import (
	"net/http"

	"ring/server/internal/httpx"
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
