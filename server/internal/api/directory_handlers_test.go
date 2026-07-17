package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// registerNamed drives the real register handler with a chosen username and
// returns (token, userID, statusCode).
func registerNamed(t *testing.T, srv http.Handler, username string) (string, string, int) {
	t.Helper()
	body := `{"invitationCode":"RING01","username":"` + username + `"}`
	rr := do(t, srv, http.MethodPost, "/v1/register", "", body)
	if rr.Code != http.StatusOK {
		return "", "", rr.Code
	}
	var reg registerResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &reg); err != nil {
		t.Fatalf("decode register: %v", err)
	}
	if reg.Username != username {
		t.Fatalf("register username = %q, want %q", reg.Username, username)
	}
	return reg.Token, reg.UserID, rr.Code
}

func TestRegisterRequiresValidUsername(t *testing.T) {
	srv := newTestServer()
	for _, u := range []string{"", "ab", "x", ".bad", "bad.", "no..dots", "admin", "has space"} {
		body := `{"invitationCode":"RING01","username":"` + u + `"}`
		rr := do(t, srv, http.MethodPost, "/v1/register", "", body)
		if rr.Code != http.StatusBadRequest {
			t.Fatalf("username %q: status = %d, want 400", u, rr.Code)
		}
	}
}

func TestRegisterDuplicateUsernameConflicts(t *testing.T) {
	srv := newTestServer()
	if _, _, code := registerNamed(t, srv, "alice"); code != http.StatusOK {
		t.Fatalf("first alice register = %d", code)
	}
	// Same handle, any case → 409 (case-folded uniqueness).
	body := `{"invitationCode":"RING01","username":"ALICE"}`
	rr := do(t, srv, http.MethodPost, "/v1/register", "", body)
	if rr.Code != http.StatusConflict {
		t.Fatalf("duplicate username status = %d, want 409", rr.Code)
	}
	// A different handle still works.
	if _, _, code := registerNamed(t, srv, "bob"); code != http.StatusOK {
		t.Fatalf("bob register = %d", code)
	}
}

func TestMeIncludesUsername(t *testing.T) {
	srv := newTestServer()
	tok, _, _ := registerNamed(t, srv, "carol")
	rr := do(t, srv, http.MethodGet, "/v1/me", tok, "")
	var me selfResponse
	_ = json.Unmarshal(rr.Body.Bytes(), &me)
	if me.Username != "carol" {
		t.Fatalf("me username = %q, want carol", me.Username)
	}
}

func TestDirectoryListAndGet(t *testing.T) {
	srv := newTestServer()
	tokA, _, _ := registerNamed(t, srv, "alice")
	_, idB, _ := registerNamed(t, srv, "bob")

	// A lists the directory: sees bob, never itself.
	rr := do(t, srv, http.MethodGet, "/v1/users", tokA, "")
	var list struct {
		Users []directoryUserDTO `json:"users"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &list)
	if len(list.Users) != 1 || list.Users[0].Username != "bob" {
		t.Fatalf("A directory = %+v, want [bob]", list.Users)
	}

	// A fetches bob's single profile.
	rr = do(t, srv, http.MethodGet, "/v1/users/"+idB, tokA, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("get bob = %d", rr.Code)
	}
	var bob directoryUserDTO
	_ = json.Unmarshal(rr.Body.Bytes(), &bob)
	if bob.ID != idB || bob.Username != "bob" {
		t.Fatalf("get bob = %+v", bob)
	}
}

func TestDirectorySearch(t *testing.T) {
	srv := newTestServer()
	tokA, _, _ := registerNamed(t, srv, "alice")
	registerNamed(t, srv, "bob")
	registerNamed(t, srv, "bobby")

	rr := do(t, srv, http.MethodGet, "/v1/users?q=bob", tokA, "")
	var list struct {
		Users []directoryUserDTO `json:"users"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &list)
	if len(list.Users) != 2 {
		t.Fatalf("search bob = %+v, want bob+bobby", list.Users)
	}
}

func TestDirectoryHidesBlockedBothWays(t *testing.T) {
	srv := newTestServer()
	tokA, idA, _ := registerNamed(t, srv, "alice")
	tokB, idB, _ := registerNamed(t, srv, "bob")

	// A blocks B.
	if rr := do(t, srv, http.MethodPut, "/v1/blocks/"+idB, tokA, ""); rr.Code != http.StatusNoContent {
		t.Fatalf("A block B = %d", rr.Code)
	}

	// B vanishes from A's directory + single fetch (the blocker's view).
	rr := do(t, srv, http.MethodGet, "/v1/users", tokA, "")
	if strings.Contains(rr.Body.String(), idB) {
		t.Fatalf("A still sees B after blocking: %s", rr.Body.String())
	}
	if rr := do(t, srv, http.MethodGet, "/v1/users/"+idB, tokA, ""); rr.Code != http.StatusNotFound {
		t.Fatalf("A get B after block = %d, want 404", rr.Code)
	}

	// And A vanishes from B's view (mutual hide).
	rr = do(t, srv, http.MethodGet, "/v1/users", tokB, "")
	if strings.Contains(rr.Body.String(), idA) {
		t.Fatalf("B still sees A after being blocked: %s", rr.Body.String())
	}
	if rr := do(t, srv, http.MethodGet, "/v1/users/"+idA, tokB, ""); rr.Code != http.StatusNotFound {
		t.Fatalf("B get A after block = %d, want 404", rr.Code)
	}
}

func TestUpdateProfileReflectedInDirectory(t *testing.T) {
	srv := newTestServer()
	tokA, idA, _ := registerNamed(t, srv, "alice")
	tokB, _, _ := registerNamed(t, srv, "bob")

	body := `{"displayName":"Alice Liddell","avatar":"data:image/png;base64,AAAA","about":"down the rabbit hole"}`
	if rr := do(t, srv, http.MethodPut, "/v1/me/profile", tokA, body); rr.Code != http.StatusNoContent {
		t.Fatalf("update profile = %d", rr.Code)
	}
	rr := do(t, srv, http.MethodGet, "/v1/users/"+idA, tokB, "")
	var a directoryUserDTO
	_ = json.Unmarshal(rr.Body.Bytes(), &a)
	if a.DisplayName != "Alice Liddell" || a.About != "down the rabbit hole" {
		t.Fatalf("profile not reflected: %+v", a)
	}
}

func TestUpdateProfileNeverChangesUsername(t *testing.T) {
	srv := newTestServer()
	tokA, _, _ := registerNamed(t, srv, "alice")
	// No username field is accepted by the profile endpoint; the handle stays.
	_ = do(t, srv, http.MethodPut, "/v1/me/profile", tokA, `{"displayName":"x","username":"eve"}`)
	rr := do(t, srv, http.MethodGet, "/v1/me", tokA, "")
	var me selfResponse
	_ = json.Unmarshal(rr.Body.Bytes(), &me)
	if me.Username != "alice" {
		t.Fatalf("username changed to %q, want alice (immutable)", me.Username)
	}
}
