package api

import (
	"context"
	"net/http"
	"time"

	"ring/server/internal/httpx"
)

// health reports liveness and database reachability.
func (h *Handlers) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if err := h.Store.Ping(ctx); err != nil {
		httpx.JSON(w, http.StatusServiceUnavailable, map[string]string{"status": "degraded", "db": "down"})
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"status": "ok", "db": "up"})
}
