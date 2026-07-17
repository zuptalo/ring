package secrets

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"testing"
)

// fakeStore is an in-memory SecretsStore.
type fakeStore struct{ blob []byte }

func (f *fakeStore) GetServerSecret(context.Context) ([]byte, bool, error) {
	if f.blob == nil {
		return nil, false, nil
	}
	return f.blob, true, nil
}
func (f *fakeStore) PutServerSecret(_ context.Context, b []byte) error { f.blob = b; return nil }

const testKey = "test-secrets-key"

func TestLoadOrCreateGeneratesAndPersists(t *testing.T) {
	ctx := context.Background()
	st := &fakeStore{}

	s1, err := LoadOrCreate(ctx, st, testKey)
	if err != nil {
		t.Fatalf("first LoadOrCreate: %v", err)
	}
	if s1.VapidPublicKey == "" || s1.VapidPrivateKey == "" || s1.TokenSigningKey == "" || s1.TurnSharedSecret == "" {
		t.Fatalf("expected all secrets populated, got %+v", s1)
	}
	if st.blob == nil {
		t.Fatalf("expected the encrypted blob persisted to the store")
	}
	// Persisted blob is ciphertext, not the plaintext JSON.
	if json.Valid(st.blob) {
		t.Fatalf("stored blob looks like plaintext JSON; expected ciphertext")
	}

	// VAPID public key is the uncompressed P-256 point: 65 bytes starting 0x04.
	pub, err := base64.RawURLEncoding.DecodeString(s1.VapidPublicKey)
	if err != nil {
		t.Fatalf("vapid public not base64url: %v", err)
	}
	if len(pub) != 65 || pub[0] != 0x04 {
		t.Fatalf("vapid public malformed: len=%d first=0x%02x", len(pub), pub[0])
	}

	// Idempotent: a second load decrypts and returns identical values.
	s2, err := LoadOrCreate(ctx, st, testKey)
	if err != nil {
		t.Fatalf("second LoadOrCreate: %v", err)
	}
	if s2 != s1 {
		t.Fatalf("secrets not stable across loads:\n %+v\n %+v", s1, s2)
	}
}

// A wrong/rotated key must fail loudly, never silently regenerate.
func TestLoadOrCreateWrongKeyFails(t *testing.T) {
	ctx := context.Background()
	st := &fakeStore{}
	if _, err := LoadOrCreate(ctx, st, testKey); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if _, err := LoadOrCreate(ctx, st, "a-different-key"); err == nil {
		t.Fatalf("expected a decryption error with the wrong key, got nil")
	}
}

// Forward-compat: a stored value missing a field gets it regenerated while the
// existing fields are preserved.
func TestLoadOrCreateFillsMissingField(t *testing.T) {
	ctx := context.Background()
	st := &fakeStore{}

	// Persist a Secrets with only VAPID set (simulating an older schema).
	aead, _ := NewAEAD(testKey)
	partial := Secrets{VapidPublicKey: "pub", VapidPrivateKey: "priv"}
	plain, _ := json.Marshal(partial)
	blob, _ := Encrypt(aead, plain)
	st.blob = blob

	got, err := LoadOrCreate(ctx, st, testKey)
	if err != nil {
		t.Fatalf("LoadOrCreate: %v", err)
	}
	if got.VapidPublicKey != "pub" || got.VapidPrivateKey != "priv" {
		t.Fatalf("existing fields not preserved: %+v", got)
	}
	if got.TokenSigningKey == "" || got.TurnSharedSecret == "" {
		t.Fatalf("missing fields not filled: %+v", got)
	}
}

// Import seeds the store from a legacy plaintext value only when empty.
func TestImportSeedsThenIgnores(t *testing.T) {
	ctx := context.Background()
	st := &fakeStore{}
	legacy := Secrets{
		VapidPublicKey: "lp", VapidPrivateKey: "lk",
		TokenSigningKey: "tk", TurnSharedSecret: "ts",
	}
	got, err := Import(ctx, st, testKey, legacy)
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	if got != legacy {
		t.Fatalf("import did not preserve legacy values: %+v", got)
	}
	// A second import is a no-op: existing values win.
	again, err := Import(ctx, st, testKey, Secrets{VapidPublicKey: "different"})
	if err != nil {
		t.Fatalf("second import: %v", err)
	}
	if again != legacy {
		t.Fatalf("second import overwrote existing secrets: %+v", again)
	}
}
