package api

import (
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

// allowLoopback relaxes the SSRF IP guard for the duration of a test so an
// httptest server (which listens on 127.0.0.1) is reachable. The real guard is
// exercised separately by TestUnfurlBlocksPrivate and TestIsBlockedIP.
func allowLoopback(t *testing.T) {
	t.Helper()
	prev := unfurlIsBlocked
	unfurlIsBlocked = func(net.IP) bool { return false }
	t.Cleanup(func() { unfurlIsBlocked = prev })
}

func doUnfurl(t *testing.T, rawURL string, asImage bool) *httptest.ResponseRecorder {
	t.Helper()
	q := "/v1/unfurl?url=" + url.QueryEscape(rawURL)
	if asImage {
		q += "&as=image"
	}
	req := httptest.NewRequest(http.MethodPost, q, nil)
	rec := httptest.NewRecorder()
	(&Handlers{}).unfurl(rec, req)
	return rec
}

// The IP classifier rejects every non-public range and accepts public addresses.
func TestIsBlockedIP(t *testing.T) {
	blocked := []string{
		"127.0.0.1", "::1", // loopback
		"10.0.0.1", "172.16.5.5", "192.168.1.1", "fc00::1", "fd12::34", // private/ULA
		"169.254.169.254", "fe80::1", // link-local (incl. cloud metadata)
		"0.0.0.0", "::", // unspecified
		"255.255.255.255",            // broadcast
		"100.64.0.1", "100.127.255.1", // CGNAT
		"224.0.0.1", "ff02::1", // multicast
		"::ffff:127.0.0.1", "::ffff:10.0.0.1", // IPv4-mapped private
	}
	for _, s := range blocked {
		if ip := net.ParseIP(s); !isBlockedIP(ip) {
			t.Errorf("%s: expected blocked", s)
		}
	}
	allowed := []string{"8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"}
	for _, s := range allowed {
		if ip := net.ParseIP(s); isBlockedIP(ip) {
			t.Errorf("%s: expected allowed", s)
		}
	}
	if !isBlockedIP(nil) {
		t.Errorf("nil ip: expected blocked")
	}
}

// A valid HTML page is relayed back verbatim (the server does not parse it).
func TestUnfurlRelaysHTML(t *testing.T) {
	allowLoopback(t)
	const page = `<html><head><meta property="og:title" content="Hi"></head></html>`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(page))
	}))
	defer srv.Close()

	rec := doUnfurl(t, srv.URL, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if rec.Body.String() != page {
		t.Errorf("body not relayed verbatim: %q", rec.Body.String())
	}
}

// as=image relays image bytes and enforces the image content-type gate.
func TestUnfurlImageMode(t *testing.T) {
	allowLoopback(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "image/jpeg")
		_, _ = w.Write([]byte{0xff, 0xd8, 0xff, 0xd9})
	}))
	defer srv.Close()

	rec := doUnfurl(t, srv.URL, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if rec.Body.Len() != 4 {
		t.Errorf("expected 4 image bytes, got %d", rec.Body.Len())
	}
}

// The content-type gate rejects HTML asked for as an image and vice-versa.
func TestUnfurlContentTypeGate(t *testing.T) {
	allowLoopback(t)
	html := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte("<html></html>"))
	}))
	defer html.Close()
	// Asking for an image but getting HTML → 415.
	if rec := doUnfurl(t, html.URL, true); rec.Code != http.StatusUnsupportedMediaType {
		t.Errorf("image-mode on HTML: expected 415, got %d", rec.Code)
	}

	pdf := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/pdf")
		_, _ = w.Write([]byte("%PDF"))
	}))
	defer pdf.Close()
	// Asking for HTML but getting a PDF → 415.
	if rec := doUnfurl(t, pdf.URL, false); rec.Code != http.StatusUnsupportedMediaType {
		t.Errorf("html-mode on PDF: expected 415, got %d", rec.Code)
	}
}

// HTML beyond the cap is truncated (not rejected) so early og tags still arrive.
func TestUnfurlTruncatesLargeHTML(t *testing.T) {
	allowLoopback(t)
	big := strings.Repeat("a", unfurlMaxHTML+5000)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte(big))
	}))
	defer srv.Close()

	rec := doUnfurl(t, srv.URL, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if rec.Body.Len() != unfurlMaxHTML {
		t.Errorf("expected body truncated to %d, got %d", unfurlMaxHTML, rec.Body.Len())
	}
}

// (spec 2035) og tags buried DEEP in a heavyweight page still reach the client:
// YouTube's watch pages carry og:image around byte ~641K, past the old 512 KiB
// cap — the client then fell back to the favicon and rendered a blurry hero.
func TestUnfurlDeepOgTagsSurviveTheCap(t *testing.T) {
	allowLoopback(t)
	const ogOffset = 700 << 10 // beyond the old 512 KiB cap, inside the new one
	page := strings.Repeat("x", ogOffset) +
		`<meta property="og:image" content="https://example.com/thumb.jpg">`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte(page))
	}))
	defer srv.Close()

	rec := doUnfurl(t, srv.URL, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "og:image") {
		t.Errorf("og tag at %d bytes was truncated away (cap %d)", ogOffset, unfurlMaxHTML)
	}
}

// Upstream 404 → 404; any other non-200 → 502.
func TestUnfurlUpstreamStatus(t *testing.T) {
	allowLoopback(t)
	for _, tc := range []struct{ up, want int }{
		{http.StatusNotFound, http.StatusNotFound},
		{http.StatusInternalServerError, http.StatusBadGateway},
		{http.StatusForbidden, http.StatusBadGateway},
	} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(tc.up)
		}))
		rec := doUnfurl(t, srv.URL, false)
		if rec.Code != tc.want {
			t.Errorf("upstream %d: expected %d, got %d", tc.up, tc.want, rec.Code)
		}
		srv.Close()
	}
}

// The real guard (no override) blocks a loopback target before any bytes flow.
func TestUnfurlBlocksPrivate(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte("<html>secret</html>"))
	}))
	defer srv.Close()

	rec := doUnfurl(t, srv.URL, false) // srv.URL is http://127.0.0.1:<port>
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for loopback, got %d", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "secret") {
		t.Errorf("private host content leaked through the guard")
	}
}

// Non-http(s) schemes and malformed URLs are rejected before any dial.
func TestUnfurlRejectsBadURL(t *testing.T) {
	for _, raw := range []string{
		"file:///etc/passwd", "ftp://example.com/x", "gopher://example.com",
		"javascript:alert(1)", "", "http://", "not a url",
	} {
		if rec := doUnfurl(t, raw, false); rec.Code != http.StatusBadRequest {
			t.Errorf("url %q: expected 400, got %d", raw, rec.Code)
		}
	}
}
