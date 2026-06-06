package api

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// Only well-formed Noto emoji paths are accepted (no SSRF / traversal).
func TestEmojiProxyRejectsBadPaths(t *testing.T) {
	bad := []string{
		"../secret", "1f600/evil.txt", "http://evil.com/x", "1f600/../../etc/passwd",
		"ZZZ/lottie.json", "1f600/512.png", "/lottie.json", "1f600",
	}
	h := &Handlers{} // no cache dir → never reaches the network for these
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

// A cached asset is served from disk without hitting the network.
func TestEmojiProxyServesFromCache(t *testing.T) {
	dir := t.TempDir()
	h := &Handlers{EmojiCacheDir: dir}
	const path = "1f600/lottie.json"
	want := []byte(`{"v":"5.0"}`)

	sum := sha256.Sum256([]byte(path))
	cacheFile := filepath.Join(dir, hex.EncodeToString(sum[:])+".json")
	if err := os.WriteFile(cacheFile, want, 0o644); err != nil {
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
