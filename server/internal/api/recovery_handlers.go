package api

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"ring/server/internal/auth"
	"ring/server/internal/httpx"
)

// New-device restore (recovery code), unauthenticated. A returning user proves
// they hold the recovery code WITHOUT the server ever learning it:
//
//  1. /v1/recovery/begin {lookup} - the client sends a one-way hash of the code.
//     The server finds the account, returns the opaque recovery wrap + a fresh
//     random challenge. (A leaked lookup reveals nothing usable on its own.)
//  2. The client unwraps the wrap with the code (Argon2id) to recover the
//     identity key, and signs the challenge.
//  3. /v1/recovery/complete {userId, challenge, signature} - the server verifies
//     the signature against the account's published Ed25519 key, then issues a
//     device token. Without the code you cannot unwrap → cannot sign → no token.
//
// Challenges live in memory with a short TTL (single-process server; a restart
// mid-flow just means the user retries).

const (
	recoveryChallengeTTL  = 2 * time.Minute
	recoveryChallengeSize = 32
)

type recoveryChallenge struct {
	nonce string
	exp   time.Time
}

type recoveryChallengeStore struct {
	mu sync.Mutex
	m  map[string]recoveryChallenge // key: userID
}

func newRecoveryChallengeStore() *recoveryChallengeStore {
	return &recoveryChallengeStore{m: make(map[string]recoveryChallenge)}
}

func (s *recoveryChallengeStore) issue(userID, nonce string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.m[userID] = recoveryChallenge{nonce: nonce, exp: time.Now().Add(recoveryChallengeTTL)}
}

// consume returns true iff a live (unexpired) challenge for userID matches nonce,
// and removes it (single use). Constant-time compare on the nonce.
func (s *recoveryChallengeStore) consume(userID, nonce string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.m[userID]
	if !ok {
		return false
	}
	delete(s.m, userID)
	if time.Now().After(c.exp) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(c.nonce), []byte(nonce)) == 1
}

// Package-level store: the API runs as a single process, so an in-memory map is
// sufficient and avoids threading new state through Handlers construction.
var recoveryChallenges = newRecoveryChallengeStore()

type recoveryBeginRequest struct {
	Lookup string `json:"lookup"`
}

type recoveryBeginResponse struct {
	UserID    string          `json:"userId"`
	Salt      string          `json:"salt"`
	Envelope  json.RawMessage `json:"envelope"`
	Challenge string          `json:"challenge"` // b64url random nonce to sign
}

// recoveryBegin (POST /v1/recovery/begin) - public. Resolves a recovery-code
// lookup hash to its account and returns the wrap + a challenge to sign.
func (h *Handlers) recoveryBegin(w http.ResponseWriter, r *http.Request) {
	var req recoveryBeginRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Lookup == "" {
		httpx.Error(w, http.StatusBadRequest, "missing lookup")
		return
	}

	userID, salt, envelope, found, err := h.Sync.FindByRecoveryLookup(r.Context(), req.Lookup)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not look up recovery")
		return
	}
	if !found {
		httpx.Error(w, http.StatusNotFound, "no account for that recovery code")
		return
	}

	nonceBytes := make([]byte, recoveryChallengeSize)
	if _, err := rand.Read(nonceBytes); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not create challenge")
		return
	}
	nonce := base64.RawURLEncoding.EncodeToString(nonceBytes)
	recoveryChallenges.issue(userID, nonce)

	httpx.JSON(w, http.StatusOK, recoveryBeginResponse{
		UserID:    userID,
		Salt:      salt,
		Envelope:  json.RawMessage(envelope),
		Challenge: nonce,
	})
}

type recoveryCompleteRequest struct {
	UserID    string `json:"userId"`
	Challenge string `json:"challenge"`
	Signature string `json:"signature"` // b64url Ed25519 signature over the challenge bytes
}

type recoveryCompleteResponse struct {
	Token  string `json:"token"`
	UserID string `json:"userId"`
}

// recoveryComplete (POST /v1/recovery/complete) - public. Verifies the signed
// challenge against the account's published Ed25519 key, then mints a device
// token for the account.
func (h *Handlers) recoveryComplete(w http.ResponseWriter, r *http.Request) {
	var req recoveryCompleteRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.UserID == "" || req.Challenge == "" || req.Signature == "" {
		httpx.Error(w, http.StatusBadRequest, "missing fields")
		return
	}

	// The challenge must be one we just issued for this account (unexpired,
	// single-use). This also rate-limits guessing and prevents replay.
	if !recoveryChallenges.consume(req.UserID, req.Challenge) {
		httpx.Error(w, http.StatusUnauthorized, "challenge expired or invalid")
		return
	}

	edPubB64, found, err := h.Keys.EdPub(r.Context(), req.UserID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not read account key")
		return
	}
	if !found {
		httpx.Error(w, http.StatusBadRequest, "account cannot be restored")
		return
	}

	edPub, err1 := base64.RawURLEncoding.DecodeString(edPubB64)
	challenge, err2 := base64.RawURLEncoding.DecodeString(req.Challenge)
	sig, err3 := base64.RawURLEncoding.DecodeString(req.Signature)
	if err1 != nil || err2 != nil || err3 != nil || len(edPub) != ed25519.PublicKeySize {
		httpx.Error(w, http.StatusBadRequest, "malformed recovery proof")
		return
	}
	if !ed25519.Verify(ed25519.PublicKey(edPub), challenge, sig) {
		httpx.Error(w, http.StatusUnauthorized, "invalid recovery proof")
		return
	}

	token, err := auth.NewToken()
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not mint token")
		return
	}
	if err := h.Store.AddToken(r.Context(), req.UserID, auth.HashToken(token)); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not issue token")
		return
	}

	httpx.JSON(w, http.StatusOK, recoveryCompleteResponse{Token: token, UserID: req.UserID})
}
