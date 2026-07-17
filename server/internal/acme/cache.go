// Package acme backs Go's autocert.Manager with a Postgres-stored, encrypted
// cache, so ringd can provision + renew its own TLS certs (Let's Encrypt) while
// staying stateless (no certs/account key on disk). Each cached value is
// AES-256-GCM encrypted with the SECRETS_KEY-derived key, so a database dump
// alone cannot use the ACME account key or the issued certs.
//
// Cache keys are namespaced by ACME environment ("le-prod", "le-staging", or a
// hash of a custom directory URL). autocert caches issued certs under the bare
// hostname, so without this a staging cert would keep being served for ~60 days
// after switching to production. Namespacing makes the switch a cache miss (a
// clean re-issue), and Sweep() drops the now-stale other-environment entries.
package acme

import (
	"context"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/hex"

	"golang.org/x/crypto/acme/autocert"

	"ring/server/internal/secrets"
)

// Let's Encrypt's well-known directory endpoints, special-cased to readable
// namespaces so `SELECT key FROM acme_cache` plainly shows staging vs production.
const (
	leProduction = "https://acme-v02.api.letsencrypt.org/directory"
	leStaging    = "https://acme-staging-v02.api.letsencrypt.org/directory"
)

// Environment returns a short, stable namespace for an ACME directory URL. An
// empty URL means autocert's default (Let's Encrypt production).
func Environment(directoryURL string) string {
	switch directoryURL {
	case "", leProduction:
		return "le-prod"
	case leStaging:
		return "le-staging"
	default:
		sum := sha256.Sum256([]byte(directoryURL))
		return "acme-" + hex.EncodeToString(sum[:4])
	}
}

// Store is the persistence the cache needs. *store.Store satisfies it.
type Store interface {
	GetACME(ctx context.Context, key string) ([]byte, bool, error)
	PutACME(ctx context.Context, key string, data []byte) error
	DeleteACME(ctx context.Context, key string) error
	DeleteACMEExcept(ctx context.Context, keepPrefix string) (int64, error)
}

// Cache implements autocert.Cache over a Store, encrypting values at rest and
// namespacing every key by ACME environment.
type Cache struct {
	store     Store
	aead      cipher.AEAD
	namespace string
}

// Compile-time check that Cache satisfies the autocert.Cache interface.
var _ autocert.Cache = (*Cache)(nil)

// NewCache returns a cache that stores autocert state in store, encrypted with aead
// (build it from secrets.NewAEAD(cfg.SecretsKey)), under the namespace for
// directoryURL (empty = Let's Encrypt production).
func NewCache(store Store, aead cipher.AEAD, directoryURL string) *Cache {
	return &Cache{store: store, aead: aead, namespace: Environment(directoryURL)}
}

// Namespace is the environment prefix this cache reads/writes under.
func (c *Cache) Namespace() string { return c.namespace }

func (c *Cache) prefix() string { return c.namespace + "/" }

func (c *Cache) ns(key string) string { return c.prefix() + key }

func (c *Cache) Get(ctx context.Context, key string) ([]byte, error) {
	blob, found, err := c.store.GetACME(ctx, c.ns(key))
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, autocert.ErrCacheMiss
	}
	return secrets.Decrypt(c.aead, blob)
}

func (c *Cache) Put(ctx context.Context, key string, data []byte) error {
	blob, err := secrets.Encrypt(c.aead, data)
	if err != nil {
		return err
	}
	return c.store.PutACME(ctx, c.ns(key), blob)
}

func (c *Cache) Delete(ctx context.Context, key string) error {
	return c.store.DeleteACME(ctx, c.ns(key))
}

// Sweep removes cached account keys + certs from any other ACME environment
// (e.g. a staging cert left behind after switching to production), returning how
// many entries were dropped. Call it once at startup.
func (c *Cache) Sweep(ctx context.Context) (int64, error) {
	return c.store.DeleteACMEExcept(ctx, c.prefix())
}
