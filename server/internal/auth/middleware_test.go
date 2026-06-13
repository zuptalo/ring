package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

// fakeVerifier resolves exactly one token hash to a user id; everything else is
// "not found". An optional err forces the lookup-failure path.
type fakeVerifier struct {
	wantHash []byte
	userID   string
	err      error
}

func (f fakeVerifier) UserIDForToken(_ context.Context, hash []byte) (string, bool, error) {
	if f.err != nil {
		return "", false, f.err
	}
	if f.wantHash != nil && EqualHash(hash, f.wantHash) {
		return f.userID, true, nil
	}
	return "", false, nil
}

func TestMiddlewareAuthenticatesValidToken(t *testing.T) {
	const token = "deadbeef"
	v := fakeVerifier{wantHash: HashToken(token), userID: "user-1"}

	var gotUID string
	var gotHashOK bool
	h := Middleware(v)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUID, _ = UserID(r.Context())
		h, ok := TokenHash(r.Context())
		gotHashOK = ok && EqualHash(h, HashToken(token))
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if gotUID != "user-1" {
		t.Fatalf("UserID = %q, want user-1", gotUID)
	}
	if !gotHashOK {
		t.Fatal("token hash not present/incorrect in context")
	}
}

func TestMiddlewareRejects(t *testing.T) {
	const token = "deadbeef"
	okVerifier := fakeVerifier{wantHash: HashToken(token), userID: "user-1"}

	cases := []struct {
		name       string
		header     string // "" means no Authorization header at all
		setHeader  bool
		verifier   TokenVerifier
		wantStatus int
	}{
		{name: "no header", setHeader: false, verifier: okVerifier, wantStatus: http.StatusUnauthorized},
		{name: "empty header", setHeader: true, header: "", verifier: okVerifier, wantStatus: http.StatusUnauthorized},
		{name: "wrong scheme", setHeader: true, header: "Basic " + token, verifier: okVerifier, wantStatus: http.StatusUnauthorized},
		{name: "bearer no token", setHeader: true, header: "Bearer ", verifier: okVerifier, wantStatus: http.StatusUnauthorized},
		{name: "bearer whitespace token", setHeader: true, header: "Bearer    ", verifier: okVerifier, wantStatus: http.StatusUnauthorized},
		{name: "unknown token", setHeader: true, header: "Bearer not-the-right-token", verifier: okVerifier, wantStatus: http.StatusUnauthorized},
		{name: "lookup error", setHeader: true, header: "Bearer " + token, verifier: fakeVerifier{err: errors.New("db down")}, wantStatus: http.StatusInternalServerError},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			called := false
			h := Middleware(tc.verifier)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				called = true
				w.WriteHeader(http.StatusOK)
			}))
			req := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
			if tc.setHeader {
				req.Header.Set("Authorization", tc.header)
			}
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)

			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d", rec.Code, tc.wantStatus)
			}
			if called {
				t.Fatal("next handler was called despite auth failure")
			}
		})
	}
}

func TestMiddlewareAcceptsCaseInsensitiveScheme(t *testing.T) {
	const token = "deadbeef"
	v := fakeVerifier{wantHash: HashToken(token), userID: "user-1"}
	h := Middleware(v)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
	req.Header.Set("Authorization", "bearer "+token) // lowercase scheme
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (scheme match should be case-insensitive)", rec.Code)
	}
}

func TestContextAccessorsAbsent(t *testing.T) {
	if _, ok := UserID(context.Background()); ok {
		t.Fatal("UserID should be absent on a bare context")
	}
	if _, ok := TokenHash(context.Background()); ok {
		t.Fatal("TokenHash should be absent on a bare context")
	}
}
