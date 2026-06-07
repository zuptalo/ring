package acme

import (
	"bytes"
	"context"
	"errors"
	"testing"

	"golang.org/x/crypto/acme/autocert"

	"ring/server/internal/secrets"
)

type fakeStore struct{ m map[string][]byte }

func newFakeStore() *fakeStore { return &fakeStore{m: map[string][]byte{}} }
func (f *fakeStore) GetACME(_ context.Context, key string) ([]byte, bool, error) {
	b, ok := f.m[key]
	return b, ok, nil
}
func (f *fakeStore) PutACME(_ context.Context, key string, data []byte) error {
	f.m[key] = data
	return nil
}
func (f *fakeStore) DeleteACME(_ context.Context, key string) error {
	delete(f.m, key)
	return nil
}

func TestCacheRoundTrip(t *testing.T) {
	ctx := context.Background()
	aead, _ := secrets.NewAEAD("acme-test-key")
	c := NewCache(newFakeStore(), aead)

	// Miss returns autocert.ErrCacheMiss (autocert relies on this sentinel).
	if _, err := c.Get(ctx, "missing"); !errors.Is(err, autocert.ErrCacheMiss) {
		t.Fatalf("miss: want ErrCacheMiss, got %v", err)
	}

	want := []byte("a fake ACME account key")
	if err := c.Put(ctx, "acme_account+key", want); err != nil {
		t.Fatal(err)
	}
	got, err := c.Get(ctx, "acme_account+key")
	if err != nil || !bytes.Equal(got, want) {
		t.Fatalf("get: got %q err %v", got, err)
	}

	if err := c.Delete(ctx, "acme_account+key"); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Get(ctx, "acme_account+key"); !errors.Is(err, autocert.ErrCacheMiss) {
		t.Fatalf("after delete: want ErrCacheMiss, got %v", err)
	}
}

func TestCacheEncryptsAtRest(t *testing.T) {
	ctx := context.Background()
	store := newFakeStore()
	aead, _ := secrets.NewAEAD("acme-test-key")
	c := NewCache(store, aead)

	secret := []byte("super-secret-account-key")
	if err := c.Put(ctx, "k", secret); err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(store.m["k"], secret) {
		t.Fatalf("stored blob contains plaintext; expected ciphertext")
	}

	// A different SECRETS_KEY cannot decrypt the stored value.
	other, _ := secrets.NewAEAD("different-key")
	if _, err := NewCache(store, other).Get(ctx, "k"); err == nil {
		t.Fatalf("wrong key decrypted the cache; expected an error")
	}
}
