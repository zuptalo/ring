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
		"ZZZ/lottie.json", "1f600/512.jpg", "/lottie.json", "1f600",
		"1f600/emoji.svg/../x", "1f600/EMOJI.SVG", "1f600/lottie.json?x=1",
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

// The static assets added in spec 1066 are accepted and typed correctly. They are
// what reaction pills and the quick-react bar draw, so a regression here silently
// sends the 600 KB animated WebP back down to a 23 px slot.
func TestEmojiProxyAcceptsStaticAssets(t *testing.T) {
	cases := []struct{ path, wantCT string }{
		{"1f602/emoji.svg", "image/svg+xml"},
		{"1f602/512.png", "image/png"},
		{"1f602/512.webp", "image/webp"},
		{"1f602/lottie.json", "application/json"},
		{"1f1f8_1f1ea/emoji.svg", "image/svg+xml"},
	}
	for _, c := range cases {
		if got := contentTypeFor(c.path); got != c.wantCT {
			t.Errorf("contentTypeFor(%q) = %q, want %q", c.path, got, c.wantCT)
		}
		if !emojiPathRe.MatchString(c.path) {
			t.Errorf("path %q should be accepted by emojiPathRe", c.path)
		}
	}
}

// Emoji responses are inert: long-lived, non-sniffable, and unable to execute.
func TestEmojiProxySetsHardeningHeaders(t *testing.T) {
	st := newFakeEmojiStore()
	if err := st.PutEmoji(context.Background(), "1f602/emoji.svg", "image/svg+xml", []byte("<svg/>")); err != nil {
		t.Fatalf("seed: %v", err)
	}
	h := &Handlers{Emoji: st}
	req := httptest.NewRequest(http.MethodGet, "/v1/emoji/1f602/emoji.svg", nil)
	req.SetPathValue("path", "1f602/emoji.svg")
	rec := httptest.NewRecorder()
	h.emojiProxy(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if got := rec.Header().Get("Content-Type"); got != "image/svg+xml" {
		t.Errorf("Content-Type = %q, want image/svg+xml", got)
	}
	if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Errorf("X-Content-Type-Options = %q, want nosniff", got)
	}
	if got := rec.Header().Get("Content-Security-Policy"); got == "" {
		t.Error("Content-Security-Policy must be set on emoji responses")
	}
	if got := rec.Header().Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
		t.Errorf("Cache-Control = %q", got)
	}
}
