package acme

import (
	"bytes"
	"context"
	"errors"
	"strings"
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
func (f *fakeStore) DeleteACMEExcept(_ context.Context, keepPrefix string) (int64, error) {
	var n int64
	for k := range f.m {
		if !strings.HasPrefix(k, keepPrefix) {
			delete(f.m, k)
			n++
		}
	}
	return n, nil
}

func TestCacheRoundTrip(t *testing.T) {
	ctx := context.Background()
	aead, _ := secrets.NewAEAD("acme-test-key")
	c := NewCache(newFakeStore(), aead, "")

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
	c := NewCache(store, aead, "")

	secret := []byte("super-secret-account-key")
	if err := c.Put(ctx, "k", secret); err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(store.m[c.ns("k")], secret) {
		t.Fatalf("stored blob contains plaintext; expected ciphertext")
	}

	// A different SECRETS_KEY cannot decrypt the stored value.
	other, _ := secrets.NewAEAD("different-key")
	if _, err := NewCache(store, other, "").Get(ctx, "k"); err == nil {
		t.Fatalf("wrong key decrypted the cache; expected an error")
	}
}

func TestEnvironmentNamespaces(t *testing.T) {
	cases := map[string]string{
		"":           "le-prod",
		leProduction: "le-prod",
		leStaging:    "le-staging",
	}
	for url, want := range cases {
		if got := Environment(url); got != want {
			t.Fatalf("Environment(%q) = %q, want %q", url, got, want)
		}
	}
	// A custom directory gets a stable, distinct hashed namespace.
	custom := Environment("https://acme.example.test/dir")
	if !strings.HasPrefix(custom, "acme-") || custom == "le-prod" || custom == "le-staging" {
		t.Fatalf("custom namespace = %q, want acme-<hash>", custom)
	}
	if custom != Environment("https://acme.example.test/dir") {
		t.Fatalf("custom namespace not stable")
	}
}

// Switching environments (staging -> prod) must be a clean re-issue: the prod
// cache sees a miss for a host the staging cache had, and Sweep drops staging.
func TestSwitchingEnvironmentSweepsStale(t *testing.T) {
	ctx := context.Background()
	store := newFakeStore()
	aead, _ := secrets.NewAEAD("acme-test-key")

	staging := NewCache(store, aead, leStaging)
	if err := staging.Put(ctx, "m.example.com", []byte("staging-cert")); err != nil {
		t.Fatal(err)
	}
	if err := staging.Put(ctx, "acme_account+key", []byte("staging-acct")); err != nil {
		t.Fatal(err)
	}

	prod := NewCache(store, aead, leProduction)

	// Before sweeping, the prod cache must not see the staging cert (no stale serve).
	if _, err := prod.Get(ctx, "m.example.com"); !errors.Is(err, autocert.ErrCacheMiss) {
		t.Fatalf("prod read staging cert: want ErrCacheMiss, got %v", err)
	}

	n, err := prod.Sweep(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Fatalf("sweep removed %d, want 2 (staging cert + account)", n)
	}
	if len(store.m) != 0 {
		t.Fatalf("staging entries survived sweep: %v", store.m)
	}

	// A prod cert written after the switch is kept by a subsequent sweep.
	if err := prod.Put(ctx, "m.example.com", []byte("prod-cert")); err != nil {
		t.Fatal(err)
	}
	if n, _ := prod.Sweep(ctx); n != 0 {
		t.Fatalf("sweep removed prod entries: %d", n)
	}
	got, err := prod.Get(ctx, "m.example.com")
	if err != nil || !bytes.Equal(got, []byte("prod-cert")) {
		t.Fatalf("prod cert lost: got %q err %v", got, err)
	}
}
