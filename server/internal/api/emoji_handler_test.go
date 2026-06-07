package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

// fakeEmojiStore is an in-memory EmojiStore for tests.
type fakeEmojiStore struct {
	m map[string]struct {
		bytes []byte
		ct    string
	}
}

func newFakeEmojiStore() *fakeEmojiStore {
	return &fakeEmojiStore{m: map[string]struct {
		bytes []byte
		ct    string
	}{}}
}

func (f *fakeEmojiStore) GetEmoji(_ context.Context, path string) ([]byte, string, bool, error) {
	v, ok := f.m[path]
	if !ok {
		return nil, "", false, nil
	}
	return v.bytes, v.ct, true, nil
}

func (f *fakeEmojiStore) PutEmoji(_ context.Context, path, ct string, bytes []byte) error {
	f.m[path] = struct {
		bytes []byte
		ct    string
	}{bytes, ct}
	return nil
}

// Only well-formed Noto emoji paths are accepted (no SSRF / traversal).
func TestEmojiProxyRejectsBadPaths(t *testing.T) {
	bad := []string{
		"../secret", "1f600/evil.txt", "http://evil.com/x", "1f600/../../etc/passwd",
		"ZZZ/lottie.json", "1f600/512.png", "/lottie.json", "1f600",
	}
	h := &Handlers{} // no store → never reaches the network for these
	for _, p := range bad {
		req := httptest.NewRequest(http.MethodGet, "/v1/emoji/"+p, nil)
		req.SetPathValue("path", p)
		rec := httptest.NewRecorder()
		h.emojiProxy(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("path %q: expected 400, got %d", p, rec.Code)
		}
	}
}

// A cached asset is served from the store without hitting the network.
func TestEmojiProxyServesFromCache(t *testing.T) {
	store := newFakeEmojiStore()
	h := &Handlers{Emoji: store}
	const path = "1f600/lottie.json"
	want := []byte(`{"v":"5.0"}`)
	if err := store.PutEmoji(context.Background(), path, "application/json", want); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/v1/emoji/"+path, nil)
	req.SetPathValue("path", path)
	rec := httptest.NewRecorder()
	h.emojiProxy(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("content-type = %q, want application/json", ct)
	}
	if rec.Body.String() != string(want) {
		t.Errorf("body = %q, want %q", rec.Body.String(), want)
	}
}
