package secrets

import (
	"encoding/base64"
	"testing"
)

func TestLoadOrCreateGeneratesAndPersists(t *testing.T) {
	dir := t.TempDir()

	s1, err := LoadOrCreate(dir)
	if err != nil {
		t.Fatalf("first LoadOrCreate: %v", err)
	}
	if s1.VapidPublicKey == "" || s1.VapidPrivateKey == "" || s1.TokenSigningKey == "" {
		t.Fatalf("expected all secrets populated, got %+v", s1)
	}

	// VAPID public key is the uncompressed P-256 point: 65 bytes starting 0x04.
	pub, err := base64.RawURLEncoding.DecodeString(s1.VapidPublicKey)
	if err != nil {
		t.Fatalf("vapid public not base64url: %v", err)
	}
	if len(pub) != 65 || pub[0] != 0x04 {
		t.Fatalf("vapid public malformed: len=%d first=0x%02x", len(pub), pub[0])
	}

	// Idempotent: a second load returns identical, persisted values.
	s2, err := LoadOrCreate(dir)
	if err != nil {
		t.Fatalf("second LoadOrCreate: %v", err)
	}
	if s2 != s1 {
		t.Fatalf("secrets not stable across loads:\n %+v\n %+v", s1, s2)
	}
}
