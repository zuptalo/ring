package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// Self-hosted Noto emoji proxy. The client fetches emoji art (animated Lottie +
// static WebP) from this server only - never from Google directly - so a user's
// IP and which emoji they view never leak to a third party. The server fetches
// each asset from Google once and caches it on disk, so it's pulled at most once
// across all users.
const notoBase = "https://fonts.gstatic.com/s/e/notoemoji/latest/"

// Strictly: hex codepoints joined by '_', then /lottie.json or /512.webp. This
// prevents the proxy from being used to fetch arbitrary URLs (no SSRF).
var emojiPathRe = regexp.MustCompile(`^[0-9a-f]+(_[0-9a-f]+)*/(lottie\.json|512\.webp)$`)

var emojiClient = &http.Client{Timeout: 15 * time.Second}

func (h *Handlers) emojiProxy(w http.ResponseWriter, r *http.Request) {
	path := r.PathValue("path")
	if !emojiPathRe.MatchString(path) {
		http.Error(w, "bad emoji path", http.StatusBadRequest)
		return
	}
	contentType := "application/json"
	if strings.HasSuffix(path, ".webp") {
		contentType = "image/webp"
	}

	// Serve from the on-disk cache if present.
	var cacheFile string
	if h.EmojiCacheDir != "" {
		cacheFile = emojiCachePath(h.EmojiCacheDir, path)
		if data, err := os.ReadFile(cacheFile); err == nil {
			serveEmoji(w, contentType, data)
			return
		}
	}

	// Otherwise fetch from Google once, cache it, and serve.
	resp, err := emojiClient.Get(notoBase + path)
	if err != nil {
		http.Error(w, "emoji unavailable", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		http.Error(w, "emoji not found", http.StatusNotFound)
		return
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20)) // 4 MiB cap per asset
	if err != nil {
		http.Error(w, "emoji read failed", http.StatusBadGateway)
		return
	}
	if cacheFile != "" {
		if err := os.MkdirAll(h.EmojiCacheDir, 0o755); err == nil {
			tmp := cacheFile + ".tmp"
			if os.WriteFile(tmp, data, 0o644) == nil {
				_ = os.Rename(tmp, cacheFile)
			}
		}
	}
	serveEmoji(w, contentType, data)
}

func serveEmoji(w http.ResponseWriter, contentType string, data []byte) {
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	_, _ = w.Write(data)
}

// emojiCachePath is the on-disk cache file for an upstream emoji path. Shared by
// the proxy and the warm-up so their filenames always match.
func emojiCachePath(dir, path string) string {
	sum := sha256.Sum256([]byte(path))
	return filepath.Join(dir, hex.EncodeToString(sum[:])+filepath.Ext(path))
}

// emojiCodepoints maps an emoji to the Noto path segment (lowercase hex runes
// joined by '_'), optionally dropping the FE0F variation selector.
func emojiCodepoints(emoji string, dropVariationSelector bool) string {
	parts := make([]string, 0, 4)
	for _, r := range emoji {
		if dropVariationSelector && r == 0xfe0f {
			continue
		}
		parts = append(parts, fmt.Sprintf("%x", r))
	}
	return strings.Join(parts, "_")
}

// WarmEmojiCache pre-fetches a curated common set into the cache (one-time, on a
// fresh deploy) so popular emoji never trigger an outbound fetch when a user
// first views them. Already-cached assets are skipped; runs to completion or
// until ctx is cancelled.
func WarmEmojiCache(ctx context.Context, dir string) {
	if dir == "" {
		return
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		slog.Warn("emoji warm: cannot create cache dir", "err", err)
		return
	}
	formats := []string{"lottie.json", "512.webp"}
	fetched, present, missing := 0, 0, 0
	for _, emoji := range CommonEmoji {
		for _, format := range formats {
			if ctx.Err() != nil {
				slog.Info("emoji warm: cancelled", "fetched", fetched, "cached", present)
				return
			}
			full := emojiCodepoints(emoji, false) + "/" + format
			noVS := emojiCodepoints(emoji, true) + "/" + format
			switch warmOne(ctx, dir, full) {
			case warmFetched:
				fetched++
			case warmPresent:
				present++
			case warmMissing:
				// Some emoji's Noto path omits FE0F - try that variant.
				if noVS != full && warmOne(ctx, dir, noVS) == warmFetched {
					fetched++
				} else {
					missing++
				}
			}
		}
	}
	slog.Info("emoji warm: done", "fetched", fetched, "alreadyCached", present, "unavailable", missing)
}

type warmResult int

const (
	warmFetched warmResult = iota // downloaded + cached now
	warmPresent                   // already in the cache
	warmMissing                   // upstream 404 / error
)

func warmOne(ctx context.Context, dir, path string) warmResult {
	cacheFile := emojiCachePath(dir, path)
	if _, err := os.Stat(cacheFile); err == nil {
		return warmPresent
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, notoBase+path, nil)
	if err != nil {
		return warmMissing
	}
	resp, err := emojiClient.Do(req)
	if err != nil {
		return warmMissing
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return warmMissing
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return warmMissing
	}
	tmp := cacheFile + ".tmp"
	if os.WriteFile(tmp, data, 0o644) == nil {
		_ = os.Rename(tmp, cacheFile)
	}
	return warmFetched
}
