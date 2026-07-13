package api

import (
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// devProxyHandler reverse-proxies all non-API requests to a running dev server
// (Vite), used only in dev hot-reload mode (DEV_PROXY). httputil.ReverseProxy
// transparently carries WebSocket upgrades, so the Vite HMR socket tunnels
// through too - giving the public dev URL true HMR while ringd keeps owning the
// TLS cert, /v1, /v1/ws and TURN. API paths still 404 here (they're matched by
// more specific routes before this catch-all; an unknown /v1/* must not be sent
// to the dev server). Never mounted in production.
func devProxyHandler(target string) http.Handler {
	u, err := url.Parse(target)
	if err != nil || u.Scheme == "" || u.Host == "" {
		slog.Error("DEV_PROXY is not a valid URL; dev proxy disabled", "value", target, "err", err)
		return http.HandlerFunc(http.NotFound)
	}
	proxy := httputil.NewSingleHostReverseProxy(u)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/healthz" || strings.HasPrefix(r.URL.Path, "/v1/") {
			http.NotFound(w, r)
			return
		}
		proxy.ServeHTTP(w, r)
	})
}

// spaHandler serves the built PWA from dir. Real files are served directly with
// sensible cache headers; any other (non-API) route falls back to index.html so
// the client-side router can take over. It is only mounted when STATIC_DIR is
// set, so development (where Vite serves the client) is unaffected.
//
// API paths are never shadowed: an unknown /v1/* or /healthz request returns 404
// rather than the app shell, so a typo'd endpoint fails honestly instead of
// looking like a 200 page.
func spaHandler(dir string) http.Handler {
	indexPath := filepath.Join(dir, "index.html")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/healthz" || strings.HasPrefix(r.URL.Path, "/v1/") {
			http.NotFound(w, r)
			return
		}

		// path.Clean on a rooted path collapses any "." / ".." segments, so the
		// result can never escape dir once joined - no directory traversal.
		clean := path.Clean("/" + r.URL.Path)
		full := filepath.Join(dir, filepath.FromSlash(clean))

		if info, err := os.Stat(full); err == nil && !info.IsDir() {
			setStaticCache(w, clean)
			http.ServeFile(w, r, full)
			return
		}

		// A missing fingerprinted asset is NEVER a client-side route — it's a chunk
		// from a superseded deploy that this dist no longer carries. Falling back to
		// index.html here (the pre-spec-2032 behavior) served HTML as JavaScript with
		// a 200: a stale installed PWA (old shell served cache-first by its SW, its
		// precache partially evicted by the OS, dist since rebuilt) would import an
		// old-hash chunk, receive the app shell instead, and every feature in that
		// chunk died silently — dead buttons, no error, no update prompt. A 404 makes
		// the failure honest so the client's chunk-error handling can recover.
		if strings.HasPrefix(clean, "/assets/") {
			http.NotFound(w, r)
			return
		}

		// SPA fallback: hand the route to index.html. It must always revalidate so
		// a fresh deploy (new asset hashes) is picked up on the next load.
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, indexPath)
	})
}

// setStaticCache marks fingerprinted build assets immutable and leaves the app
// shell, service worker, and manifest revalidating so a new deploy rolls out
// immediately rather than being pinned by a stale cache.
func setStaticCache(w http.ResponseWriter, p string) {
	switch {
	case strings.HasPrefix(p, "/assets/"):
		// Vite emits content-hashed filenames under /assets, safe to cache forever.
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	case p == "/index.html" || p == "/sw.js" || p == "/registerSW.js" ||
		strings.HasSuffix(p, ".webmanifest") || strings.HasSuffix(p, "manifest.json"):
		w.Header().Set("Cache-Control", "no-cache")
	default:
		w.Header().Set("Cache-Control", "public, max-age=3600")
	}
}
