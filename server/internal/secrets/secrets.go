// Package secrets loads-or-generates the server's long-lived secret material on
// first run and persists it to the data directory, so the operator never has to
// supply or rotate it by hand. Everything here is auto-generatable; the only
// thing an operator must provide is the public URL (see internal/config).
//
// Adding a new secret is forward-compatible: add a field + a generator below,
// and it's filled in (and the file rewritten) on the next boot for existing
// installs.
package secrets

import (
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

const fileName = "secrets.json"

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

// LoadOrCreate reads the secrets file from dir, generating (and persisting) any
// missing pieces. Idempotent: subsequent calls return the same values.
func LoadOrCreate(dir string) (Secrets, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return Secrets{}, fmt.Errorf("create data dir: %w", err)
	}
	path := filepath.Join(dir, fileName)

	var s Secrets
	if data, err := os.ReadFile(path); err == nil {
		if err := json.Unmarshal(data, &s); err != nil {
			return Secrets{}, fmt.Errorf("parse %s: %w", path, err)
		}
	} else if !os.IsNotExist(err) {
		return Secrets{}, fmt.Errorf("read %s: %w", path, err)
	}

	changed := false
	if s.VapidPublicKey == "" || s.VapidPrivateKey == "" {
		pub, priv, err := generateVAPID()
		if err != nil {
			return Secrets{}, err
		}
		s.VapidPublicKey, s.VapidPrivateKey = pub, priv
		changed = true
	}
	if s.TokenSigningKey == "" {
		key, err := randomKey(32)
		if err != nil {
			return Secrets{}, err
		}
		s.TokenSigningKey = key
		changed = true
	}
	if s.TurnSharedSecret == "" {
		key, err := randomKey(32)
		if err != nil {
			return Secrets{}, err
		}
		s.TurnSharedSecret = key
		changed = true
	}

	if changed {
		if err := writeAtomic(path, s); err != nil {
			return Secrets{}, err
		}
	}
	return s, nil
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

func writeAtomic(path string, s Secrets) error {
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return fmt.Errorf("write secrets: %w", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		return fmt.Errorf("finalize secrets: %w", err)
	}
	return nil
}
