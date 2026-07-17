package api

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// writeStaticTree lays down a minimal built-PWA directory for the SPA handler.
func writeStaticTree(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "index.html"), "<!doctype html><title>Ring</title>")
	mustWrite(t, filepath.Join(dir, "assets", "app.abc123.js"), "console.log('app')")
	mustWrite(t, filepath.Join(dir, "sw.js"), "self.addEventListener('push', () => {})")
	mustWrite(t, filepath.Join(dir, "manifest.webmanifest"), "{}")
	return dir
}

func mustWrite(t *testing.T, p, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", p, err)
	}
	if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
		t.Fatalf("write %s: %v", p, err)
	}
}

func TestSPAHandler(t *testing.T) {
	dir := writeStaticTree(t)
	h := spaHandler(dir)

	cases := []struct {
		name      string
		path      string
		wantCode  int
		wantBody  string // substring; empty = skip
		wantCache string // exact Cache-Control; empty = skip
	}{
		{name: "root serves index", path: "/", wantCode: 200, wantBody: "Ring", wantCache: "no-cache"},
		{name: "hashed asset immutable", path: "/assets/app.abc123.js", wantCode: 200, wantBody: "app",
			wantCache: "public, max-age=31536000, immutable"},
		{name: "service worker revalidates", path: "/sw.js", wantCode: 200, wantCache: "no-cache"},
		{name: "manifest revalidates", path: "/manifest.webmanifest", wantCode: 200, wantCache: "no-cache"},
		// A client-side route (no such file) falls back to the app shell, not a 404.
		{name: "spa fallback", path: "/tabs/chats", wantCode: 200, wantBody: "Ring", wantCache: "no-cache"},
		// API paths must never be shadowed by the app shell.
		{name: "unknown api 404", path: "/v1/nope", wantCode: 404},
		{name: "healthz not shadowed", path: "/healthz", wantCode: 404},
		// A raw ".." path is rejected outright by http.ServeFile's dot-dot guard
		// (400), never escaping the tree. In production the stdlib mux also cleans
		// the path before the handler runs, so a real traversal can't leak a file.
		{name: "traversal rejected", path: "/assets/../../../etc/passwd", wantCode: 400},
		// Spec 2032: a MISSING fingerprinted asset is a dead chunk from a superseded
		// deploy, never a client-side route — it must 404, not fall back to the app
		// shell. Serving index.html as JavaScript is how a stale installed PWA (old
		// shell cache-first, precache partially evicted, dist since rebuilt) ends up
		// with silently dead features: the module loader receives HTML and the whole
		// chunk's handlers never wire up.
		{name: "missing hashed asset 404s", path: "/assets/gone.def456.js", wantCode: 404},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, tc.path, nil))
			if rec.Code != tc.wantCode {
				t.Fatalf("%s: got %d, want %d", tc.path, rec.Code, tc.wantCode)
			}
			if tc.wantBody != "" && !contains(rec.Body.String(), tc.wantBody) {
				t.Fatalf("%s: body %q missing %q", tc.path, rec.Body.String(), tc.wantBody)
			}
			if tc.wantCache != "" && rec.Header().Get("Cache-Control") != tc.wantCache {
				t.Fatalf("%s: Cache-Control %q, want %q", tc.path, rec.Header().Get("Cache-Control"), tc.wantCache)
			}
		})
	}
}

// TestNewRouterStaticMount confirms the catch-all is only mounted when StaticDir
// is set: with it empty, an unknown non-API path 404s (API-only surface intact);
// with it set, the same path serves the app shell.
func TestNewRouterStaticMount(t *testing.T) {
	dir := writeStaticTree(t)

	apiOnly := NewRouter(&Handlers{}, nil)
	rec := httptest.NewRecorder()
	apiOnly.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/some/spa/route", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("api-only: got %d for /some/spa/route, want 404", rec.Code)
	}

	withStatic := NewRouter(&Handlers{StaticDir: dir}, nil)
	rec = httptest.NewRecorder()
	withStatic.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/some/spa/route", nil))
	if rec.Code != http.StatusOK || !contains(rec.Body.String(), "Ring") {
		t.Fatalf("with-static: got %d body %q, want 200 app shell", rec.Code, rec.Body.String())
	}
}

func contains(s, sub string) bool {
	return len(sub) == 0 || (len(s) >= len(sub) && indexOf(s, sub) >= 0)
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
