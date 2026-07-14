package api

import (
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"syscall"
	"time"

	"ring/server/internal/httpx"
)

// Link-preview relay. A PWA sender cannot read a third-party page cross-origin
// (CORS taints even a canvas read of an og:image), so it can't unfurl a shared
// link on its own. This endpoint fetches the raw bytes on the sender's behalf
// and streams them back UNPARSED: the sender's device extracts og:title /
// description / image and builds the preview locally, then embeds it E2EE so the
// recipient never touches the URL. The server only ever sees the URL transiently
// at fetch time - it never parses page content, never learns the recipient, and
// stores nothing. This also keeps the user's IP off the third-party site (the
// server originates the request).
//
// Because the URL is fully user-supplied (unlike the fixed-base emoji proxy),
// this is a prime SSRF vector. The guards below reject non-http(s) schemes and -
// critically - validate the *resolved IP* of every dialed address (initial host
// and every redirect hop) against private/loopback/link-local/metadata ranges,
// so a public hostname that resolves (or redirects) to an internal address is
// blocked at dial time.

const (
	unfurlTimeout = 10 * time.Second
	// HTML cap (spec 2035): og tags nominally live in <head>, but heavyweight pages
	// push them deep — YouTube's watch pages carry og:image around byte ~641K, so the
	// old 512 KiB cap silently starved the client of the real thumbnail and it fell
	// back to a favicon (rendered as a blurry stretched hero). 1.5 MiB covers the
	// major offenders with headroom while staying firmly bounded.
	unfurlMaxHTML   = 1536 << 10 // 1.5 MiB
	unfurlMaxImage  = 2 << 20    // 2 MiB cap on a preview image
	unfurlMaxHops   = 5          // redirect cap
	unfurlUserAgent = "RingLinkPreview/1.0 (+https://github.com/zuptalo/ring)"
)

// errBlockedAddr is returned by the dialer Control hook when a resolved address
// falls in a blocked range; it surfaces as a transport error (→ 502/400).
var errBlockedAddr = errors.New("unfurl: blocked address")

// isBlockedIP reports whether dialing ip would reach a non-public destination we
// must never proxy to. Covers loopback, RFC1918/ULA private, link-local (incl.
// the 169.254.169.254 cloud-metadata endpoint), unspecified, broadcast, CGNAT
// 100.64/10, and all multicast. IPv4-mapped IPv6 (::ffff:a.b.c.d) is normalized
// via To4() so a mapped private address can't slip through as "IPv6".
func isBlockedIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	if v4 := ip.To4(); v4 != nil {
		ip = v4
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() ||
		ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() {
		return true
	}
	if v4 := ip.To4(); v4 != nil {
		// IPv4 limited broadcast.
		if v4.Equal(net.IPv4bcast) {
			return true
		}
		// Carrier-grade NAT 100.64.0.0/10 (RFC 6598) - not covered by IsPrivate.
		if v4[0] == 100 && v4[1]&0xc0 == 64 {
			return true
		}
	}
	return false
}

// unfurlIsBlocked is the live IP guard, indirected through a var so happy-path
// tests (whose httptest servers listen on loopback, which the real guard rejects)
// can relax it; production always uses isBlockedIP.
var unfurlIsBlocked = isBlockedIP

// safeControl is a net.Dialer Control hook: it runs after DNS resolution with the
// concrete ip:port the stack is about to connect to, so it catches both the
// initial host and any redirect target without re-resolving.
func safeControl(_ string, address string, _ syscall.RawConn) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return errBlockedAddr
	}
	ip := net.ParseIP(host)
	if unfurlIsBlocked(ip) {
		return errBlockedAddr
	}
	return nil
}

// unfurlClient is the SSRF-guarded outbound client. The Control hook validates
// every dialed IP; CheckRedirect caps hops and re-checks each target's scheme
// (its IP is re-validated at dial time by Control - defense in depth).
var unfurlClient = &http.Client{
	Timeout: unfurlTimeout,
	Transport: &http.Transport{
		DialContext: (&net.Dialer{
			Timeout: unfurlTimeout,
			Control: safeControl,
		}).DialContext,
		// Don't reuse connections across distinct upstreams; this is one-shot proxying.
		DisableKeepAlives: true,
	},
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= unfurlMaxHops {
			return fmt.Errorf("unfurl: too many redirects")
		}
		if req.URL.Scheme != "http" && req.URL.Scheme != "https" {
			return fmt.Errorf("unfurl: redirect to non-http scheme")
		}
		return nil
	},
}

// unfurl (POST /v1/unfurl?url=...) relays the raw bytes of a user-supplied URL.
// With ?as=image the response is required to be an image (the resolved og:image,
// fetched in a second call after the client parses the HTML); otherwise it must
// be HTML. The body is capped and streamed back verbatim - never parsed here.
func (h *Handlers) unfurl(w http.ResponseWriter, r *http.Request) {
	raw := r.URL.Query().Get("url")
	asImage := r.URL.Query().Get("as") == "image"

	target, err := url.Parse(raw)
	if err != nil || (target.Scheme != "http" && target.Scheme != "https") || target.Host == "" {
		httpx.Error(w, http.StatusBadRequest, "invalid url")
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, target.String(), nil)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid url")
		return
	}
	req.Header.Set("User-Agent", unfurlUserAgent)
	if asImage {
		req.Header.Set("Accept", "image/*")
	} else {
		req.Header.Set("Accept", "text/html,application/xhtml+xml")
	}

	resp, err := unfurlClient.Do(req)
	if err != nil {
		// A blocked-address dial or transport failure both land here; don't leak
		// which to the caller beyond a generic upstream error.
		if errors.Is(err, errBlockedAddr) {
			httpx.Error(w, http.StatusBadRequest, "blocked url")
			return
		}
		httpx.Error(w, http.StatusBadGateway, "upstream unreachable")
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		httpx.Error(w, http.StatusNotFound, "not found")
		return
	}
	if resp.StatusCode != http.StatusOK {
		httpx.Error(w, http.StatusBadGateway, "upstream error")
		return
	}

	// Content-Type gate: only relay the kind of content we asked for, so the proxy
	// can't be used to exfiltrate arbitrary bytes from reachable hosts.
	ct := resp.Header.Get("Content-Type")
	if asImage {
		if !strings.HasPrefix(ct, "image/") {
			httpx.Error(w, http.StatusUnsupportedMediaType, "not an image")
			return
		}
	} else if !isHTMLContentType(ct) {
		httpx.Error(w, http.StatusUnsupportedMediaType, "not html")
		return
	}

	limit := int64(unfurlMaxHTML)
	if asImage {
		limit = int64(unfurlMaxImage)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, limit))
	if err != nil {
		httpx.Error(w, http.StatusBadGateway, "upstream read error")
		return
	}

	w.Header().Set("Content-Type", ct)
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}

// isHTMLContentType reports whether a Content-Type header is an HTML document
// (ignoring any ;charset= parameter and case).
func isHTMLContentType(ct string) bool {
	ct = strings.ToLower(strings.TrimSpace(ct))
	if i := strings.IndexByte(ct, ';'); i >= 0 {
		ct = strings.TrimSpace(ct[:i])
	}
	return ct == "text/html" || ct == "application/xhtml+xml"
}
