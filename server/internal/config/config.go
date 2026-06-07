// Package config loads runtime configuration from the environment with sane
// development defaults, so `go run ./cmd/ringd` works out of the box once a
// local Postgres is up.
package config

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Port           string
	DatabaseURL    string
	AllowedOrigins []string
	Env            string
	// PublicURL is the canonical externally-reachable URL of this server. It's
	// the one thing an operator should need to set in production: clients use it
	// to reach the backend, and it builds invitation share links. Everything
	// else (secrets, first-run invite) is auto-generated.
	PublicURL string
	// SecretsKey (SECRETS_KEY) encrypts the server's secret material at rest in
	// Postgres (AES-256-GCM). Required outside dev; in dev it falls back to a fixed
	// development key so the server runs configless. Must stay stable: changing it
	// makes the stored secrets unrecoverable (they would be regenerated, which
	// invalidates every device token + push subscription).
	SecretsKey string
	// StaticDir, when set (STATIC_DIR), is a directory of built PWA assets that
	// ringd serves at / with SPA fallback, so one container serves both the app
	// and the API on the same origin. Empty in dev (Vite serves the client and
	// proxies the API); set in the Docker image to the copied-in dist/.
	StaticDir string
	// WarmEmoji, when set (WARM_EMOJI=1), pre-populates the self-hosted Noto emoji
	// cache with a curated common set on startup (one-time, in the background) so
	// common emoji never trigger an outbound fetch to Google.
	WarmEmoji bool
	// VapidSubject is the VAPID "sub" claim for Web Push. Apple's push service
	// REQUIRES a mailto: URI (an https URL is rejected), so we default to a
	// mailto derived from PUBLIC_URL's host.
	VapidSubject string
	// MaxBlobBytes caps a single encrypted media upload (bytes). Set via MAX_BLOB_MB
	// (megabytes); default 256 MiB. Because each upload is buffered whole in server
	// RAM and stored as a Postgres bytea, raising this trades memory/DB pressure for
	// larger attachments - keep it within a few hundred MB until uploads stream to
	// object storage. Advertised at GET /v1/config so clients pre-validate.
	MaxBlobBytes int

	// RequireConnection enables the server-enforced connect-request gate (a peer's
	// prekey bundle is only fetchable with an accepted connection). Off by default
	// (open network); enable once clients use the connect-request flow.
	RequireConnection bool

	// --- Calling (WebRTC) ---
	// EnableCalls turns on the embedded TURN relay + SFU. Off unless explicitly
	// enabled in prod (calls need a public relay IP and a TLS cert); on by
	// default in dev so the signalling/credentials path can be exercised.
	EnableCalls bool
	// TurnRealm is the TURN authentication realm (defaults to PublicURL's host).
	TurnRealm string
	// TurnHost is the SNI hostname clients use to reach the TURNS relay on 443
	// (e.g. turn.ring-dev.zuptalo.com). The L4 proxy routes this SNI to ringd.
	// Defaults to "turn." + PublicURL's host.
	TurnHost string
	// TurnPublicHost / TurnPublicPort override the host:port advertised to
	// clients in the ICE config - the address they actually connect to. Distinct
	// from RELAY_IP (internal). Set these for a dedicated-port deployment
	// (e.g. a router forwarding a public port to ringd's TURN), where clients
	// reach turn:<TurnPublicHost>:<TurnPublicPort>. When unset, the advertised
	// host falls back to TurnHost (TLS) or RELAY_IP/127.0.0.1 (plaintext/local).
	TurnPublicHost string
	TurnPublicPort string
	// TurnPublicTransport is the transport clients use to reach the relay in
	// plaintext mode: "udp" (default) or "tcp". Set "tcp" when only a TCP port is
	// forwarded. (TLS mode is always tcp.)
	TurnPublicTransport string
	// TurnListen is the local address the TURNS listener binds (default ":3478").
	// The L4 proxy forwards the SNI-matched 443 stream here; or set ":443" to
	// bind 443 directly when nothing else owns it.
	TurnListen string
	// RelayIP is the public IP peers see for relayed media (required when calls
	// are enabled outside dev).
	RelayIP string
	// TurnTLSCert / TurnTLSKey are PEM paths for the TURNS listener's certificate
	// (SAN must cover TurnHost). Required when calls are enabled outside dev,
	// unless Acme is on (autocert provisions the cert instead).
	TurnTLSCert string
	TurnTLSKey  string

	// --- Built-in TLS (ACME / Let's Encrypt) ---
	// Acme (ACME=true) makes ringd provision + renew its own TLS certs via autocert
	// (TLS-ALPN-01) for the HTTPS app listener and the TURNS listener, instead of
	// static cert files. State is cached encrypted in Postgres (stateless). The
	// hosts' public :443 must pass through to ringd un-terminated (an SNI-passthrough
	// proxy, not a TLS-terminating one) for the challenge to succeed.
	Acme bool
	// AcmeEmail (ACME_EMAIL) is the optional contact for the Let's Encrypt account.
	AcmeEmail string
	// AcmeDirectoryURL (ACME_DIRECTORY_URL) overrides the ACME server, e.g. the
	// Let's Encrypt staging URL while testing (avoids prod rate limits). Empty = LE prod.
	AcmeDirectoryURL string
	// TLSPort (TLS_PORT, default 8443) is the port ringd serves the HTTPS app on
	// when Acme is enabled (a passthrough proxy routes the app host's :443 here).
	TLSPort string
}

// Load reads configuration from the environment. The two inputs that can't be
// derived - DATABASE_URL (an external Postgres) and PUBLIC_URL - are required in
// non-dev environments and error fast if missing. In dev they fall back to
// local defaults so the server runs with zero configuration. Everything else
// (secrets, the first-run invite) is auto-generated at boot.
func Load() (Config, error) {
	envName := env("ENV", "dev")
	dev := envName == "dev"

	c := Config{
		Port:                env("PORT", "8080"),
		DatabaseURL:         os.Getenv("DATABASE_URL"),
		AllowedOrigins:      splitComma(env("ALLOWED_ORIGINS", "http://localhost:5173")),
		Env:                 envName,
		PublicURL:           os.Getenv("PUBLIC_URL"),
		SecretsKey:          os.Getenv("SECRETS_KEY"),
		StaticDir:           os.Getenv("STATIC_DIR"),
		WarmEmoji:           envBool("WARM_EMOJI", false),
		EnableCalls:         envBool("ENABLE_CALLS", dev),
		RequireConnection:   envBool("REQUIRE_CONNECTION", false),
		TurnRealm:           os.Getenv("TURN_REALM"),
		TurnHost:            os.Getenv("TURN_HOST"),
		TurnListen:          env("TURN_LISTEN", ":3478"),
		RelayIP:             os.Getenv("RELAY_IP"),
		TurnPublicHost:      os.Getenv("TURN_PUBLIC_HOST"),
		TurnPublicPort:      os.Getenv("TURN_PUBLIC_PORT"),
		TurnPublicTransport: env("TURN_PUBLIC_TRANSPORT", "udp"),
		TurnTLSCert:         os.Getenv("TURN_TLS_CERT"),
		TurnTLSKey:          os.Getenv("TURN_TLS_KEY"),
		Acme:                envBool("ACME", false),
		AcmeEmail:           os.Getenv("ACME_EMAIL"),
		AcmeDirectoryURL:    os.Getenv("ACME_DIRECTORY_URL"),
		TLSPort:             env("TLS_PORT", "8443"),
		MaxBlobBytes:        maxInt(envInt("MAX_BLOB_MB", 256), 1) << 20, // floor 1 MiB
	}

	if dev {
		if c.DatabaseURL == "" {
			c.DatabaseURL = "postgres://ring:ring@localhost:5432/ring?sslmode=disable"
		}
		if c.PublicURL == "" {
			c.PublicURL = "http://localhost:8080"
		}
		if c.SecretsKey == "" {
			c.SecretsKey = "dev-secrets-key-not-for-production"
		}
	}

	var missing []string
	if c.DatabaseURL == "" {
		missing = append(missing, "DATABASE_URL")
	}
	if c.PublicURL == "" {
		missing = append(missing, "PUBLIC_URL")
	}
	if c.SecretsKey == "" {
		missing = append(missing, "SECRETS_KEY")
	}
	if len(missing) > 0 {
		return Config{}, fmt.Errorf(
			"missing required configuration: %s - set these (only needed when ENV!=dev). "+
				"The database can be empty; the server creates all tables on boot",
			strings.Join(missing, ", "))
	}

	// Derive TURN realm/host from PUBLIC_URL when unset.
	host := ""
	if u, err := url.Parse(c.PublicURL); err == nil {
		host = u.Hostname()
	}
	if c.TurnRealm == "" {
		c.TurnRealm = host
	}
	if c.TurnHost == "" && host != "" {
		c.TurnHost = "turn." + host
	}

	// RELAY_IP defaults to loopback: all media relays internally within the
	// single co-located TURN (both peers tunnel in over TURNS:443; the
	// relay-to-relay hop never leaves the host), so the relay address only needs
	// to be locally deliverable - it does NOT have to be the public IP.
	if c.RelayIP == "" {
		c.RelayIP = "127.0.0.1"
	}

	// Calls outside dev need a TLS cert for the TURNS listener; fail fast
	// (consistent with the DATABASE_URL/PUBLIC_URL checks).
	if c.EnableCalls && !dev && !c.Acme && (c.TurnTLSCert == "" || c.TurnTLSKey == "") {
		return Config{}, fmt.Errorf(
			"calls enabled (ENABLE_CALLS=true) but no TURNS certificate: set " +
				"TURN_TLS_CERT+TURN_TLS_KEY (SAN covers TURN_HOST), or ACME=true for " +
				"automatic certs, or ENABLE_CALLS=false")
	}

	c.VapidSubject = env("VAPID_SUBJECT", defaultVapidSubject(c.PublicURL))
	return c, nil
}

// defaultVapidSubject builds a mailto: from PUBLIC_URL's host (Apple Web Push
// rejects non-mailto subjects), falling back to a generic address.
func defaultVapidSubject(publicURL string) string {
	if u, err := url.Parse(publicURL); err == nil && u.Hostname() != "" {
		return "mailto:push@" + u.Hostname()
	}
	return "mailto:admin@localhost"
}

// IsDev reports whether the server is running in the development environment
// (gates dev-only behavior such as seeding invitation codes).
func (c Config) IsDev() bool { return c.Env == "dev" }

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// envInt parses an integer env var, falling back to def when unset/invalid.
func envInt(key string, def int) int {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// envBool parses a boolean env var (1/true/yes/on), falling back to def.
func envBool(key string, def bool) bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	if v == "" {
		return def
	}
	switch v {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func splitComma(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
