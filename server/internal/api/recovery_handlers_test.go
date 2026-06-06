package api

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
)

// Drives the full new-device restore handshake against the real handlers:
// publish an identity, store a recovery wrap + lookup, then begin → sign → complete.
func TestRecoveryRestoreFlow(t *testing.T) {
	srv := newTestServer()
	token, userID := registerUser(t, srv)

	// Publish this account's Ed25519 identity key (what the server verifies against).
	pub, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	edPub := base64.RawURLEncoding.EncodeToString(pub)
	pubBody := fmt.Sprintf(`{"edPub":%q,"xPub":"XPUB","signedPreKey":{"id":"s1","pub":"SPK","sig":"SIG"},"oneTimePreKeys":[]}`, edPub)
	if rr := do(t, srv, http.MethodPut, "/v1/keys", token, pubBody); rr.Code != http.StatusOK {
		t.Fatalf("publish keys = %d, body=%s", rr.Code, rr.Body.String())
	}

	// Upload the recovery wrap with a lookup hash.
	const lookup = "LOOKUP-HASH-OF-CODE"
	putBody := fmt.Sprintf(`{"salt":"SALT","envelope":{"v":1,"alg":"x","nonce":"n","ct":"c"},"lookup":%q}`, lookup)
	if rr := do(t, srv, http.MethodPut, "/v1/recovery", token, putBody); rr.Code != http.StatusOK {
		t.Fatalf("put recovery = %d, body=%s", rr.Code, rr.Body.String())
	}

	// begin: unknown lookup → 404.
	if rr := do(t, srv, http.MethodPost, "/v1/recovery/begin", "", `{"lookup":"nope"}`); rr.Code != http.StatusNotFound {
		t.Fatalf("begin unknown = %d, want 404", rr.Code)
	}

	// begin: known lookup → challenge (no auth needed).
	rr := do(t, srv, http.MethodPost, "/v1/recovery/begin", "", fmt.Sprintf(`{"lookup":%q}`, lookup))
	if rr.Code != http.StatusOK {
		t.Fatalf("begin = %d, body=%s", rr.Code, rr.Body.String())
	}
	var begun recoveryBeginResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &begun); err != nil {
		t.Fatal(err)
	}
	if begun.UserID != userID || begun.Salt != "SALT" || begun.Challenge == "" {
		t.Fatalf("unexpected begin response: %+v", begun)
	}

	// Sign the challenge with the identity key (what a real client does after
	// unwrapping the recovery wrap).
	challengeBytes, _ := base64.RawURLEncoding.DecodeString(begun.Challenge)
	sig := base64.RawURLEncoding.EncodeToString(ed25519.Sign(priv, challengeBytes))

	// complete with a BAD signature → 401.
	badBody := fmt.Sprintf(`{"userId":%q,"challenge":%q,"signature":%q}`, userID, begun.Challenge,
		base64.RawURLEncoding.EncodeToString(make([]byte, ed25519.SignatureSize)))
	if rr := do(t, srv, http.MethodPost, "/v1/recovery/complete", "", badBody); rr.Code != http.StatusUnauthorized {
		// the challenge was consumed by the bad attempt; re-issue for the good one below
		t.Fatalf("complete bad sig = %d, want 401", rr.Code)
	}

	// Re-begin (the bad attempt consumed the single-use challenge).
	rr = do(t, srv, http.MethodPost, "/v1/recovery/begin", "", fmt.Sprintf(`{"lookup":%q}`, lookup))
	_ = json.Unmarshal(rr.Body.Bytes(), &begun)
	challengeBytes, _ = base64.RawURLEncoding.DecodeString(begun.Challenge)
	sig = base64.RawURLEncoding.EncodeToString(ed25519.Sign(priv, challengeBytes))

	// complete with a GOOD signature → token for the same account.
	goodBody := fmt.Sprintf(`{"userId":%q,"challenge":%q,"signature":%q}`, userID, begun.Challenge, sig)
	rr = do(t, srv, http.MethodPost, "/v1/recovery/complete", "", goodBody)
	if rr.Code != http.StatusOK {
		t.Fatalf("complete good = %d, body=%s", rr.Code, rr.Body.String())
	}
	var done recoveryCompleteResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &done); err != nil {
		t.Fatal(err)
	}
	if done.Token == "" || done.UserID != userID {
		t.Fatalf("unexpected complete response: %+v", done)
	}

	// The minted token must authenticate as the restored account.
	rr = do(t, srv, http.MethodGet, "/v1/me", done.Token, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("restored token /v1/me = %d", rr.Code)
	}
	var me struct {
		UserID string `json:"userId"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &me)
	if me.UserID != userID {
		t.Fatalf("restored token resolves to %q, want %q", me.UserID, userID)
	}

	// A replayed challenge (already consumed) → 401.
	if rr := do(t, srv, http.MethodPost, "/v1/recovery/complete", "", goodBody); rr.Code != http.StatusUnauthorized {
		t.Fatalf("replayed complete = %d, want 401", rr.Code)
	}
}

// The public auth endpoints are rate-limited per IP: after the burst, further
// attempts get 429.
func TestPublicAuthRateLimited(t *testing.T) {
	srv := newTestServer()
	got429 := false
	for i := 0; i < 70; i++ {
		rr := do(t, srv, http.MethodPost, "/v1/recovery/begin", "", `{"lookup":"nope"}`)
		if rr.Code == http.StatusTooManyRequests {
			got429 = true
			break
		}
		if rr.Code != http.StatusNotFound {
			t.Fatalf("attempt %d: status = %d, want 404 (or 429)", i, rr.Code)
		}
	}
	if !got429 {
		t.Fatal("expected a 429 after exceeding the per-IP rate limit")
	}
}
