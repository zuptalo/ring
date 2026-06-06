package httpx

import (
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Limiter is a per-key token-bucket rate limiter (in-memory, single-process).
// It throttles the public, unauthenticated auth endpoints (register, recovery)
// per client IP to blunt brute-force and abuse. Idle buckets are swept
// opportunistically so the map can't grow without bound.
type Limiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	rate    float64 // tokens added per second
	burst   float64 // max tokens (and the allowed burst)
	swept   time.Time
}

type bucket struct {
	tokens float64
	seen   time.Time
}

// NewLimiter permits up to `perMinute` requests per key per minute, allowing a
// burst of up to `perMinute` before throttling to the steady rate.
func NewLimiter(perMinute int) *Limiter {
	return &Limiter{
		buckets: make(map[string]*bucket),
		rate:    float64(perMinute) / 60.0,
		burst:   float64(perMinute),
	}
}

// allow consumes a token for `key`, reporting whether the request is permitted.
func (l *Limiter) allow(key string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	// Drop buckets idle for over a minute (they've fully refilled anyway).
	if now.Sub(l.swept) > time.Minute {
		for k, b := range l.buckets {
			if now.Sub(b.seen) > time.Minute {
				delete(l.buckets, k)
			}
		}
		l.swept = now
	}

	b := l.buckets[key]
	if b == nil {
		b = &bucket{tokens: l.burst, seen: now}
		l.buckets[key] = b
	} else {
		b.tokens += now.Sub(b.seen).Seconds() * l.rate
		if b.tokens > l.burst {
			b.tokens = l.burst
		}
		b.seen = now
	}
	if b.tokens >= 1 {
		b.tokens--
		return true
	}
	return false
}

// Middleware rejects requests over the limit with 429 (keyed by client IP).
func (l *Limiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r)
		if !l.allow(ip, time.Now()) {
			slog.Warn("rate limited", "ip", ip, "method", r.Method, "path", r.URL.Path)
			w.Header().Set("Retry-After", "60")
			Error(w, http.StatusTooManyRequests, "too many attempts, please wait a minute and try again")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// clientIP extracts the caller's IP, honoring a leftmost X-Forwarded-For (the
// dev Vite proxy and the prod tunnel set it) and falling back to RemoteAddr.
func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if i := strings.IndexByte(xff, ','); i >= 0 {
			return strings.TrimSpace(xff[:i])
		}
		return strings.TrimSpace(xff)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
