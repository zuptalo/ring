package api

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// Self-hosted Noto emoji proxy. The client fetches emoji art (animated Lottie +
// static WebP) from this server only - never from Google directly - so a user's
// IP and which emoji they view never leak to a third party. The server fetches
// each asset from Google once and caches it in Postgres, so it's pulled at most
// once across all users.
const notoBase = "https://fonts.gstatic.com/s/e/notoemoji/latest/"

// Strictly: hex codepoints joined by '_', then one of the four Noto assets. This
// prevents the proxy from being used to fetch arbitrary URLs (no SSRF).
//
// Four assets, because size matters enormously at the sizes we actually draw
// (spec 1066): the animated 512.webp is ~600 KB for a glyph we render at ~23 px
// in a reaction pill, and it re-decodes every frame at full 512x512 on the main
// thread. emoji.svg is the same artwork as vector at ~1/80th the bytes, and it
// exists for emoji that have NO animated WebP at all (flags, ZWJ sequences), so
// the static path also widens coverage rather than narrowing it.
var emojiPathRe = regexp.MustCompile(`^[0-9a-f]+(_[0-9a-f]+)*/(lottie\.json|512\.webp|512\.png|emoji\.svg)$`)

var emojiClient = &http.Client{Timeout: 15 * time.Second}

// contentTypeFor returns the MIME type for a validated emoji path.
func contentTypeFor(path string) string {
	switch {
	case strings.HasSuffix(path, ".webp"):
		return "image/webp"
	case strings.HasSuffix(path, ".png"):
		return "image/png"
	case strings.HasSuffix(path, ".svg"):
		return "image/svg+xml"
	default:
		return "application/json"
	}
}

func (h *Handlers) emojiProxy(w http.ResponseWriter, r *http.Request) {
	path := r.PathValue("path")
	if !emojiPathRe.MatchString(path) {
		http.Error(w, "bad emoji path", http.StatusBadRequest)
		return
	}
	ctx := r.Context()

	// Serve from the cache if present.
	if h.Emoji != nil {
		if data, ct, found, err := h.Emoji.GetEmoji(ctx, path); err == nil && found {
			serveEmoji(w, ct, data)
			return
		}
	}

	// Otherwise fetch from Google once, cache it, and serve.
	contentType := contentTypeFor(path)
	data, ok := fetchEmoji(ctx, path)
	if !ok {
		http.Error(w, "emoji unavailable", http.StatusBadGateway)
		return
	}
	if data == nil {
		http.Error(w, "emoji not found", http.StatusNotFound)
		return
	}
	if h.Emoji != nil {
		if err := h.Emoji.PutEmoji(ctx, path, contentType, data); err != nil {
			slog.Warn("emoji cache write failed", "path", path, "err", err)
		}
	}
	serveEmoji(w, contentType, data)
}

// fetchEmoji pulls one asset from the upstream Noto CDN. ok=false on a transport
// error (caller should 502); ok=true with data=nil means upstream 404.
func fetchEmoji(ctx context.Context, path string) (data []byte, ok bool) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, notoBase+path, nil)
	if err != nil {
		return nil, false
	}
	resp, err := emojiClient.Do(req)
	if err != nil {
		return nil, false
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil, true
	}
	if resp.StatusCode != http.StatusOK {
		return nil, false
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20)) // 4 MiB cap per asset
	if err != nil {
		return nil, false
	}
	return b, true
}

func serveEmoji(w http.ResponseWriter, contentType string, data []byte) {
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	// Emoji art is inert data. nosniff keeps a mistyped asset from being reinterpreted,
	// and the sandbox/none CSP means even a hostile SVG fetched directly as a document
	// (not via <img>, where script never runs) can neither execute nor phone home.
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
	_, _ = w.Write(data)
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
func WarmEmojiCache(ctx context.Context, st EmojiStore) {
	if st == nil {
		return
	}
	// emoji.svg first: it is what every pill-sized surface draws (spec 1066), it is
	// ~1/80th the bytes of the animated WebP, and it exists for emoji the animated
	// set omits entirely — so warming it is both the cheapest and the widest win.
	formats := []string{"emoji.svg", "lottie.json", "512.webp"}
	fetched, present, missing := 0, 0, 0
	for _, emoji := range CommonEmoji {
		for _, format := range formats {
			if ctx.Err() != nil {
				slog.Info("emoji warm: cancelled", "fetched", fetched, "cached", present)
				return
			}
			full := emojiCodepoints(emoji, false) + "/" + format
			noVS := emojiCodepoints(emoji, true) + "/" + format
			switch warmOne(ctx, st, full) {
			case warmFetched:
				fetched++
			case warmPresent:
				present++
			case warmMissing:
				// Some emoji's Noto path omits FE0F - try that variant.
				if noVS != full && warmOne(ctx, st, noVS) == warmFetched {
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

func warmOne(ctx context.Context, st EmojiStore, path string) warmResult {
	if _, _, found, err := st.GetEmoji(ctx, path); err == nil && found {
		return warmPresent
	}
	data, ok := fetchEmoji(ctx, path)
	if !ok || data == nil {
		return warmMissing
	}
	if err := st.PutEmoji(ctx, path, contentTypeFor(path), data); err != nil {
		return warmMissing
	}
	return warmFetched
}
