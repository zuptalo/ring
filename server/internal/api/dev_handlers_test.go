package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"ring/server/internal/ws"
)

// TestDevMintInvite confirms the dev mint route works when DevMode is on and is
// entirely absent (404) otherwise, so production never exposes unauthenticated
// invite minting.
func TestDevMintInvite(t *testing.T) {
	as := newFakeStore()
	devSrv := NewRouter(&Handlers{
		Store: as, Directory: as, Contacts: as, Blocks: as, Relay: as,
		Hub: ws.NewHub(), Keys: newFakeKeysStore(), Blobs: newFakeBlobStore(),
		Sync: newFakeSyncStore(), Push: newFakePushStore(), Invites: as,
		DevMode: true,
	}, []string{"http://localhost:5173"})

	rr := httptest.NewRecorder()
	devSrv.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/v1/dev/invite", nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("dev mint (DevMode on): got %d, want 200", rr.Code)
	}
	var body struct{ Code string }
	if err := json.NewDecoder(rr.Body).Decode(&body); err != nil || body.Code == "" {
		t.Fatalf("dev mint: bad body %q (err %v)", rr.Body.String(), err)
	}

	// DevMode off (newTestServer) must not register the route at all.
	rr2 := httptest.NewRecorder()
	newTestServer().ServeHTTP(rr2, httptest.NewRequest(http.MethodPost, "/v1/dev/invite", nil))
	if rr2.Code != http.StatusNotFound {
		t.Fatalf("dev mint (DevMode off): got %d, want 404 (route must be absent)", rr2.Code)
	}
}
