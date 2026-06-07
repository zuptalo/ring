// Package secrets loads-or-generates the server's long-lived secret material on
// first run and persists it, encrypted, in Postgres, so the operator never has to
// supply or rotate it by hand and the container stays stateless (one DB backup
// restores everything).
//
// At rest the secrets are AES-256-GCM ciphertext, encrypted with a key derived
// from the SECRETS_KEY env var, so a database dump on its own cannot use them.
//
// Adding a new secret is forward-compatible: add a field + a generator below, and
// it is filled in (and the row re-encrypted) on the next boot for existing installs.
package secrets

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

// SecretsStore is the persistence the secrets package needs: read/write a single
// encrypted blob. *store.Store satisfies it (GetServerSecret/PutServerSecret).
type SecretsStore interface {
	GetServerSecret(ctx context.Context) ([]byte, bool, error)
	PutServerSecret(ctx context.Context, secret []byte) error
}

// Secrets holds the auto-generated server secret material.
type Secrets struct {
	// VAPID keypair for Web Push (ECDSA P-256). The public key is handed to
	// browsers for PushManager.subscribe; the private key signs push requests.
	VapidPublicKey  string `json:"vapidPublicKey"`
	VapidPrivateKey string `json:"vapidPrivateKey"`
	// Symmetric key reserved for signing tokens (e.g. future JWTs). The current
	// auth uses opaque DB-stored tokens; this is generated so it's ready.
	TokenSigningKey string `json:"tokenSigningKey"`
	// HMAC-SHA1 shared secret for ephemeral (coturn-REST-style) TURN credentials.
	// The HTTP endpoint mints time-limited username/password pairs from it, and
	// the embedded TURN relay validates them with the same secret. Never leaves
	// the server.
	TurnSharedSecret string `json:"turnSharedSecret"`
}

// LoadOrCreate reads the encrypted secrets row from the store and decrypts it
// with key, generating (and persisting) any missing pieces. Idempotent. A
// decryption failure means a wrong or rotated SECRETS_KEY and is returned as a
// hard error (never silently regenerated, which would invalidate every device
// token + push subscription).
func LoadOrCreate(ctx context.Context, st SecretsStore, key string) (Secrets, error) {
	aead, err := newAEAD(key)
	if err != nil {
		return Secrets{}, err
	}

	var s Secrets
	blob, found, err := st.GetServerSecret(ctx)
	if err != nil {
		return Secrets{}, fmt.Errorf("read server secrets: %w", err)
	}
	if found {
		plain, err := decrypt(aead, blob)
		if err != nil {
			return Secrets{}, fmt.Errorf("decrypt server secrets (wrong or rotated SECRETS_KEY?): %w", err)
		}
		if err := json.Unmarshal(plain, &s); err != nil {
			return Secrets{}, fmt.Errorf("parse server secrets: %w", err)
		}
	}

	changed, err := fillMissing(&s)
	if err != nil {
		return Secrets{}, err
	}
	if !found || changed {
		if err := persist(ctx, st, aead, s); err != nil {
			return Secrets{}, err
		}
	}
	return s, nil
}

// Import seeds the encrypted store from a plaintext Secrets value (e.g. a legacy
// secrets.json read off disk during a one-time migration), only when the store
// has none yet. Returns the resulting secrets. A no-op if the store already has a row.
func Import(ctx context.Context, st SecretsStore, key string, legacy Secrets) (Secrets, error) {
	aead, err := newAEAD(key)
	if err != nil {
		return Secrets{}, err
	}
	if _, found, err := st.GetServerSecret(ctx); err != nil {
		return Secrets{}, err
	} else if found {
		return LoadOrCreate(ctx, st, key) // already initialized; ignore the legacy file
	}
	if _, err := fillMissing(&legacy); err != nil {
		return Secrets{}, err
	}
	if err := persist(ctx, st, aead, legacy); err != nil {
		return Secrets{}, err
	}
	return legacy, nil
}

// fillMissing generates any absent secret field, reporting whether anything changed.
func fillMissing(s *Secrets) (bool, error) {
	changed := false
	if s.VapidPublicKey == "" || s.VapidPrivateKey == "" {
		pub, priv, err := generateVAPID()
		if err != nil {
			return false, err
		}
		s.VapidPublicKey, s.VapidPrivateKey = pub, priv
		changed = true
	}
	if s.TokenSigningKey == "" {
		k, err := randomKey(32)
		if err != nil {
			return false, err
		}
		s.TokenSigningKey = k
		changed = true
	}
	if s.TurnSharedSecret == "" {
		k, err := randomKey(32)
		if err != nil {
			return false, err
		}
		s.TurnSharedSecret = k
		changed = true
	}
	return changed, nil
}

func persist(ctx context.Context, st SecretsStore, aead cipher.AEAD, s Secrets) error {
	plain, err := json.Marshal(s)
	if err != nil {
		return err
	}
	blob, err := encrypt(aead, plain)
	if err != nil {
		return err
	}
	if err := st.PutServerSecret(ctx, blob); err != nil {
		return fmt.Errorf("write server secrets: %w", err)
	}
	return nil
}

// newAEAD derives a 32-byte AES-256 key from the operator-supplied SECRETS_KEY
// (any passphrase; recommend `openssl rand -hex 32`) and returns a GCM cipher.
func newAEAD(key string) (cipher.AEAD, error) {
	if key == "" {
		return nil, errors.New("SECRETS_KEY is empty")
	}
	sum := sha256.Sum256([]byte(key))
	block, err := aes.NewCipher(sum[:])
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// encrypt returns nonce || GCM-ciphertext.
func encrypt(aead cipher.AEAD, plain []byte) ([]byte, error) {
	nonce := make([]byte, aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	return aead.Seal(nonce, nonce, plain, nil), nil
}

// decrypt parses nonce || GCM-ciphertext.
func decrypt(aead cipher.AEAD, blob []byte) ([]byte, error) {
	ns := aead.NonceSize()
	if len(blob) < ns {
		return nil, errors.New("ciphertext too short")
	}
	return aead.Open(nil, blob[:ns], blob[ns:], nil)
}

// generateVAPID returns a P-256 keypair as base64url: the public key is the
// uncompressed point (0x04||X||Y, 65 bytes) browsers expect, the private key is
// the 32-byte scalar.
func generateVAPID() (pub, priv string, err error) {
	k, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		return "", "", fmt.Errorf("generate vapid key: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(k.PublicKey().Bytes()),
		base64.RawURLEncoding.EncodeToString(k.Bytes()), nil
}

func randomKey(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
