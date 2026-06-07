// Package acme backs Go's autocert.Manager with a Postgres-stored, encrypted
// cache, so ringd can provision + renew its own TLS certs (Let's Encrypt) while
// staying stateless (no certs/account key on disk). Each cached value is
// AES-256-GCM encrypted with the SECRETS_KEY-derived key, so a database dump
// alone cannot use the ACME account key or the issued certs.
package acme

import (
	"context"
	"crypto/cipher"

	"golang.org/x/crypto/acme/autocert"

	"ring/server/internal/secrets"
)

// Store is the persistence the cache needs. *store.Store satisfies it.
type Store interface {
	GetACME(ctx context.Context, key string) ([]byte, bool, error)
	PutACME(ctx context.Context, key string, data []byte) error
	DeleteACME(ctx context.Context, key string) error
}

// Cache implements autocert.Cache over a Store, encrypting values at rest.
type Cache struct {
	store Store
	aead  cipher.AEAD
}

// Compile-time check that Cache satisfies the autocert.Cache interface.
var _ autocert.Cache = (*Cache)(nil)

// NewCache returns a cache that stores autocert state in store, encrypted with aead
// (build it from secrets.NewAEAD(cfg.SecretsKey)).
func NewCache(store Store, aead cipher.AEAD) *Cache {
	return &Cache{store: store, aead: aead}
}

func (c *Cache) Get(ctx context.Context, key string) ([]byte, error) {
	blob, found, err := c.store.GetACME(ctx, key)
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
	return c.store.PutACME(ctx, key, blob)
}

func (c *Cache) Delete(ctx context.Context, key string) error {
	return c.store.DeleteACME(ctx, key)
}
