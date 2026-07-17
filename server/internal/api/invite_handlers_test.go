package api

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestCreateInvitation(t *testing.T) {
	srv := newTestServer()
	token, _ := registerUser(t, srv)

	rr := do(t, srv, http.MethodPost, "/v1/invitations", token, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("create invitation status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var resp map[string]string
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	if resp["code"] != "NEWCODE1" || resp["publicUrl"] == "" {
		t.Fatalf("unexpected invitation response: %+v", resp)
	}

	// Requires auth.
	if rr := do(t, srv, http.MethodPost, "/v1/invitations", "", ""); rr.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated create status = %d, want 401", rr.Code)
	}
}

func TestExtendInvitation(t *testing.T) {
	srv := newTestServer()
	token, _ := registerUser(t, srv)

	rr := do(t, srv, http.MethodPost, "/v1/invitations/NEWCODE1/extend", token, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("extend status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var resp map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	if resp["code"] != "NEWCODE1" || resp["expiresAt"] == nil {
		t.Fatalf("unexpected extend response: %+v", resp)
	}

	// Unknown / not-yours / already-used → 404.
	if rr := do(t, srv, http.MethodPost, "/v1/invitations/MISSING1/extend", token, ""); rr.Code != http.StatusNotFound {
		t.Fatalf("extend missing status = %d, want 404", rr.Code)
	}
	// Requires auth.
	if rr := do(t, srv, http.MethodPost, "/v1/invitations/NEWCODE1/extend", "", ""); rr.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated extend status = %d, want 401", rr.Code)
	}
}

func TestCancelInvitation(t *testing.T) {
	srv := newTestServer()
	token, _ := registerUser(t, srv)

	rr := do(t, srv, http.MethodDelete, "/v1/invitations/NEWCODE1", token, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("cancel status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var resp map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	if resp["cancelled"] != true {
		t.Fatalf("unexpected cancel response: %+v", resp)
	}

	// Unknown / not-yours / already-used → 404.
	if rr := do(t, srv, http.MethodDelete, "/v1/invitations/MISSING1", token, ""); rr.Code != http.StatusNotFound {
		t.Fatalf("cancel missing status = %d, want 404", rr.Code)
	}
	// Requires auth.
	if rr := do(t, srv, http.MethodDelete, "/v1/invitations/NEWCODE1", "", ""); rr.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated cancel status = %d, want 401", rr.Code)
	}
}
