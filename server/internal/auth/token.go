// Package auth handles bearer-token issuance, hashing, and request
// authentication. The server stores only token hashes; the plaintext token is
// the device's credential.
package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
)

// NewToken returns a fresh 256-bit token as a 64-char hex string (matching the
// client's existing token shape).
func NewToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// HashToken returns SHA-256(token). This is the only form of the token the
// server persists or compares against.
func HashToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}

// EqualHash compares two token hashes in constant time.
func EqualHash(a, b []byte) bool {
	return subtle.ConstantTimeCompare(a, b) == 1
}
