// Command ringd is the Ring backend HTTP server (Milestone 7a: accounts).
package main

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"golang.org/x/crypto/acme"
	"golang.org/x/crypto/acme/autocert"

	acmepkg "ring/server/internal/acme"
	"ring/server/internal/api"
	"ring/server/internal/config"
	"ring/server/internal/db"
	"ring/server/internal/push"
	"ring/server/internal/secrets"
	"ring/server/internal/store"
	turnpkg "ring/server/internal/turn"
	"ring/server/internal/ws"
)

// version is the build version, stamped at link time via
// -ldflags "-X main.version=...". Defaults to "dev" for plain `go build`/`go run`.
var version = "dev"

// releaseNotesB64 is this build's changelog since the last release tag — base64-
// encoded JSON ([]api.ReleaseNote), stamped at link time via
// -ldflags "-X main.releaseNotesB64=...". base64 sidesteps quoting/space issues of
// putting JSON in ldflags. Empty for plain go build/run. Surfaced at /v1/config so
// the PWA can show a per-user "what's new". A bad value degrades to no notes.
var releaseNotesB64 = ""

func decodeReleaseNotes(b64 string) []api.ReleaseNote {
	if b64 == "" {
		return nil
	}
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		slog.Warn("release notes: invalid base64, ignoring", "err", err)
		return nil
	}
	var notes []api.ReleaseNote
	if err := json.Unmarshal(raw, &notes); err != nil {
		slog.Warn("release notes: invalid JSON, ignoring", "err", err)
		return nil
	}
	return notes
}

func main() {
	if err := run(); err != nil {
		slog.Error("fatal", "err", err)
		os.Exit(1)
	}
}

// firstNonEmpty returns the first non-empty string of its arguments.
func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

// splitCSV splits a comma-separated list, trimming spaces and dropping empties.
func splitCSV(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// devProxy returns the dev hot-reload proxy target, but only in dev mode so a
// stray DEV_PROXY can never turn a production server into a reverse proxy.
func devProxy(cfg config.Config) string {
	if cfg.IsDev() {
		return cfg.DevProxy
	}
	return ""
}

// versionSweepInterval is how often the scheduler checks for behind devices whose local
// time is the 09:00 hour (spec 1016). 15 min lands the push near 09:00 while staying cheap;
// once-per-release dedup keeps repeated ticks within the hour idempotent.
const versionSweepInterval = 15 * time.Minute

// startVersionAnnouncer runs the 9-AM-local version-announcement scheduler: every
// versionSweepInterval it sends the content-free version push to each device that is behind
// the running version and whose local time is the 09:00 hour, once per release. Replaces
// the old immediate on-boot broadcast. No-op (the sweep self-skips) for the local `dev`
// build or when push is disabled. Stops cleanly on ctx cancel.
func startVersionAnnouncer(ctx context.Context, st *store.Store, notifier *push.Notifier, version string) {
	if notifier == nil {
		return
	}
	go func() {
		ticker := time.NewTicker(versionSweepInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				sctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
				push.SweepVersionAnnouncements(sctx, st, notifier, version, time.Now().UTC())
				cancel()
			}
		}
	}()
}

// ensureBootstrapInvite guarantees an empty system can onboard its first user.
// When there are no accounts, it reuses an existing claimable invitation code or
// mints one, and surfaces it in the logs. The code lives in the invitations
// table; nothing is written to disk. Becomes a no-op once anyone registers.
func ensureBootstrapInvite(ctx context.Context, st *store.Store, cfg config.Config) error {
	users, err := st.CountUsers(ctx)
	if err != nil {
		return err
	}
	if users > 0 {
		return nil // first run is over
	}

	// Reuse an existing claimable code so restarts don't pile up codes; otherwise
	// mint a fresh 8-char one.
	codes, err := st.UnusedInviteCodes(ctx, 1)
	if err != nil {
		return err
	}
	var code string
	if len(codes) > 0 {
		code = codes[0]
	} else {
		if code, err = generateInviteCode(); err != nil {
			return err
		}
		if err := st.CreateInvite(ctx, code); err != nil {
			return err
		}
	}

	slog.Warn("FIRST-RUN: register the first account with this invitation code",
		"code", code, "publicUrl", cfg.PublicURL)
	return nil
}

// loadSecrets loads (or first-run generates) the encrypted server secrets from
// Postgres. As a one-time migration aid, if LEGACY_SECRETS_FILE points at an old
// plaintext secrets.json and the database has no secrets yet, it imports that
// file instead of generating fresh keys (so an existing instance keeps its device
// tokens + push subscriptions). Normally unset.
func loadSecrets(ctx context.Context, st *store.Store, cfg config.Config) (secrets.Secrets, error) {
	if path := os.Getenv("LEGACY_SECRETS_FILE"); path != "" {
		if data, err := os.ReadFile(path); err == nil {
			var legacy secrets.Secrets
			if err := json.Unmarshal(data, &legacy); err != nil {
				return secrets.Secrets{}, fmt.Errorf("parse %s: %w", path, err)
			}
			slog.Warn("importing legacy secrets file into the database", "file", path)
			return secrets.Import(ctx, st, cfg.SecretsKey, legacy)
		}
	}
	return secrets.LoadOrCreate(ctx, st, cfg.SecretsKey)
}

// generateInviteCode returns an 8-char code from an unambiguous uppercase
// alphabet (matches the [A-Za-z0-9]{6,8} the client/server accept).
func generateInviteCode() (string, error) {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // no 0/O/1/I
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	for i := range b {
		b[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return string(b), nil
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	slog.Info("ringd starting", "version", version, "env", cfg.Env)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	if err := db.Migrate(ctx, pool); err != nil {
		return err
	}

	st := store.New(pool)

	// Auto-generate (or load) the server's secret material - VAPID + token-signing
	// + TURN keys - encrypted at rest in Postgres with SECRETS_KEY. The operator
	// never supplies the secrets themselves, only the key that protects them.
	secs, err := loadSecrets(ctx, st, cfg)
	if err != nil {
		return err
	}
	slog.Info("secrets ready", "vapidPublicKey", secs.VapidPublicKey)

	// Built-in ACME: when enabled, ringd provisions + renews its own TLS certs
	// (autocert, TLS-ALPN-01) for the app HTTPS + TURNS listeners, cached encrypted
	// in Postgres. Otherwise certs come from files (TURN_TLS_*) or dev plaintext.
	var certMgr *autocert.Manager
	if cfg.Acme {
		certMgr, err = newCertManager(ctx, st, cfg)
		if err != nil {
			return err
		}
		slog.Info("acme ready", "hosts", acmeHosts(cfg),
			"environment", acmepkg.Environment(cfg.AcmeDirectoryURL),
			"directory", firstNonEmpty(cfg.AcmeDirectoryURL, "letsencrypt-production"))
	}

	if cfg.IsDev() {
		// 8-char codes - the register UI requires exactly 8 chars ([A-Z0-9]{8}).
		// A simple, memorable pool for signing up test accounts manually.
		codes := []string{
			"INVITE01", "INVITE02", "INVITE03", "INVITE04", "INVITE05",
			"INVITE06", "INVITE07", "INVITE08", "INVITE09", "INVITE10",
		}
		if err := st.SeedDevInvites(ctx, codes); err != nil {
			return err
		}
		slog.Info("seeded dev invitation codes", "count", len(codes))

		// Fixed per-spec codes for the e2e harness: some specs derive a
		// deterministic username (u_<code>) from a known code and assert on it
		// (e.g. directory.spec expects u_dirtst01), so those codes MUST be seeded.
		// Gated behind SEED_E2E_CODES (set by e2e/global-setup) so they don't
		// clutter a normal dev deployment - which only wants INVITE01-10 above.
		if os.Getenv("SEED_E2E_CODES") == "true" {
			e2eCodes := []string{
				"RINGDEV1", "RINGDEV2", "RINGDEV3", "RINGDEV4", "RINGDEV5",
				"RINGDEV6", "RINGDEV7", "RINGDEV8", "RINGDEV9", "TESTCODE",
				"RINGTST1", "RINGTST2", "RINGTST3", "RINGTST4", "RINGTST5",
				"RINGTST6", "RINGTST7", "RINGTST8", "RINGTST9", "TESTCOD2",
				"SHARETST", "SHARETS2",
				"REKEYTS1", "REKEYTS2",
				"GHOSTTS1", "GHOSTTS2",
				"BLOCKTS1", "BLOCKTS2",
				"DIRTST01", "DIRTST02",
				"GRPINV01", "GRPINV02", "GRPINV03",
				"GRPADD01", "GRPADD02", "GRPADD03",
				"AUTOLCK1", "AUTOLCK2",
				"SWDECR01", "SWDECR02",
				"CURATED1", "CURATED2",
				"PRESTIR1", "PRESTIR2", "PRESTIR3",
				"MEDIACLN",
				"CALLLBL1", "CALLLBL2", "CALLLBL3",
				"CALLSPK1", "CALLSPK2",
				"CHATFLT1", "CHATFLT2", "CHATFLT3",
				"NAVTERM1", "PASTECP1", "PASTECP2", "EDITDEL1", "EDITDEL2",
				"RINGSEEN1", "RINGSEEN2", "RINGSEEN3", "RINGSEEN4", "RINGSEEN5",
			}
			if err := st.SeedDevInvites(ctx, e2eCodes); err != nil {
				return err
			}
			slog.Info("seeded e2e invitation codes", "count", len(e2eCodes))
		}
	}

	// Bootstrap: an empty system has no way to register the first account
	// (registration requires an invitation code). When there are no users,
	// make sure at least one claimable code exists - minting one if needed -
	// and surface it in the logs AND a file for the operator. Runs in every
	// environment; becomes a no-op once anyone registers.
	if err := ensureBootstrapInvite(ctx, st, cfg); err != nil {
		return err
	}

	hub := ws.NewHub()

	// Web Push: VAPID-signed, content-free tickles to offline recipients. The
	// subject must be a mailto: (Apple rejects https subjects).
	slog.Info("push sender ready", "vapidSubject", cfg.VapidSubject)
	notifier := push.NewNotifier(
		push.NewSender(secs.VapidPublicKey, secs.VapidPrivateKey, cfg.VapidSubject),
		st,
	)

	// Version-announcement push (spec 1016): a periodic scheduler sends a content-free
	// "new version" tickle to each device that is behind the running version, at 09:00 in
	// that device's local time, once per release. The SW turns it into a user-friendly
	// "what's new" from the public /v1/config. (Replaces the old immediate on-boot
	// broadcast so a late-night deploy never wakes anyone overnight.)
	startVersionAnnouncer(ctx, st, notifier, version)

	// Embedded TURN/STUN relay for WebRTC calls. Media is relayed opaquely (the
	// server never sees DTLS keys). In dev it runs plaintext on TurnListen; in
	// prod it terminates TLS (TURNS) for the SNI host the L4 proxy routes to us.
	var turnURLs, stunURLs []string
	if cfg.EnableCalls {
		turnCfg := turnpkg.Config{
			Realm:        cfg.TurnRealm,
			RelayIP:      cfg.RelayIP,
			ListenAddr:   cfg.TurnListen,
			SharedSecret: secs.TurnSharedSecret,
			UDPListen:    cfg.TurnUDPListen,
		}
		// TURNS over TLS: static cert files win if set; else autocert (the listener
		// also answers TLS-ALPN-01 challenges); else nil leaves it plaintext (dev).
		if cfg.TurnTLSCert != "" && cfg.TurnTLSKey != "" {
			cert, err := tls.LoadX509KeyPair(cfg.TurnTLSCert, cfg.TurnTLSKey)
			if err != nil {
				return fmt.Errorf("load TURN TLS cert: %w", err)
			}
			turnCfg.TLSConfig = &tls.Config{
				Certificates: []tls.Certificate{cert},
				MinVersion:   tls.VersionTLS12,
			}
		} else if certMgr != nil {
			turnCfg.TLSConfig = &tls.Config{
				GetCertificate: certMgr.GetCertificate,
				NextProtos:     []string{acme.ALPNProto}, // enables TLS-ALPN-01
				MinVersion:     tls.VersionTLS12,
			}
		}
		turnSrv, err := turnpkg.Start(turnCfg)
		if err != nil {
			return fmt.Errorf("start TURN relay: %w", err)
		}
		defer turnSrv.Close()

		// Advertise the actually-reachable relay URL to clients. The host/port
		// clients connect to (TurnPublicHost/Port) is distinct from RELAY_IP
		// (which only needs to be locally deliverable for the internal relay
		// hop). Three setups:
		//   - TLS:                 turns:<host>:443      (L4 SNI passthrough)
		//   - plaintext + dediated public port:  turn:<public-host>:<public-port>
		//   - local/dev (no public host):        turn:127.0.0.1:<listen-port>
		if turnCfg.TLSConfig != nil {
			host := firstNonEmpty(cfg.TurnPublicHost, cfg.TurnHost)
			port := firstNonEmpty(cfg.TurnPublicPort, "443")
			turnURLs = []string{fmt.Sprintf("turns:%s:%s?transport=tcp", host, port)}
			// Operator-opt-in UDP endpoint (spec 1043): advertise STUN for
			// public-address discovery (direct call paths) and TURN-over-UDP as a
			// lower-latency relay fallback. Both ride the extra UDP listener; the
			// STUN entry is credential-less (Binding is unauthenticated).
			if cfg.TurnUDPListen != "" {
				turnURLs = append(turnURLs,
					fmt.Sprintf("turn:%s:%s?transport=udp", cfg.StunPublicHost, cfg.StunPublicPort))
				stunURLs = []string{fmt.Sprintf("stun:%s:%s", cfg.StunPublicHost, cfg.StunPublicPort)}
			}
		} else {
			host := firstNonEmpty(cfg.TurnPublicHost, cfg.RelayIP, "127.0.0.1")
			port := firstNonEmpty(cfg.TurnPublicPort, strings.TrimPrefix(cfg.TurnListen, ":"))
			// One entry per advertised transport (e.g. "udp,tcp" → UDP preferred,
			// TCP fallback).
			for _, tr := range splitCSV(firstNonEmpty(cfg.TurnPublicTransport, "udp")) {
				turnURLs = append(turnURLs, fmt.Sprintf("turn:%s:%s?transport=%s", host, port, tr))
			}
		}
		slog.Info("TURN relay ready", "listen", cfg.TurnListen, "realm", cfg.TurnRealm,
			"urls", turnURLs, "stun", stunURLs, "tls", turnCfg.TLSConfig != nil)
		// Calls are peer-to-peer (1:1 and mesh legs alike, native DTLS-SRTP):
		// direct when the networks allow it, through this TURN otherwise. There
		// is no server-side SFU. See server/docs/CALLING.md.
	}

	handler := api.NewRouter(&api.Handlers{
		Store: st, Directory: st, Contacts: st, Connections: st, Blocks: st, Keys: st, Relay: st, Hub: hub, Blobs: st, Sync: st, Push: st,
		Invites: st, Posts: st, Notifier: notifier, RequireConnection: cfg.RequireConnection,
		PublicURL: cfg.PublicURL, VapidPublicKey: secs.VapidPublicKey, MaxBlobBytes: cfg.MaxBlobBytes,
		Version:      version,
		ReleaseNotes: decodeReleaseNotes(releaseNotesB64),
		CallsEnabled: cfg.EnableCalls, TurnSharedSecret: secs.TurnSharedSecret,
		TurnURLs: turnURLs, StunURLs: stunURLs,
		Emoji:     st,
		StaticDir: cfg.StaticDir,
		// Dev-only hot-reload proxy: forward the app + HMR socket to the Vite dev
		// server so the public dev URL gets true HMR. Ignored outside dev.
		DevProxy: devProxy(cfg),
		DevMode:  cfg.IsDev(),
	}, cfg.AllowedOrigins)

	// Plain HTTP listener: always on. Behind a TLS-terminating proxy this is the
	// app port; it is also the healthcheck target.
	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		slog.Info("listening", "addr", srv.Addr, "env", cfg.Env)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("server error", "err", err)
			stop()
		}
	}()

	// HTTPS app listener with autocert (when ACME is on): a passthrough proxy routes
	// the app host's :443 here, and this listener also answers TLS-ALPN-01 challenges.
	var tlsSrv *http.Server
	if certMgr != nil {
		// Force HTTP/1.1 (disable HTTP/2). iOS Safari/WKWebView is prone to dropping
		// HTTP/2 connections mid-request — "the network connection was lost"
		// (NSURLErrorNetworkConnectionLost, -1005) — which manifests here as larger
		// media POSTs failing the upload and notification cold-starts showing Safari's
		// "can't open the page" interstitial. HTTP/1.1 is markedly more reliable for
		// these clients, and the WebSocket relay (/v1/ws) requires HTTP/1.1 anyway.
		// We keep "acme-tls/1" so TLS-ALPN-01 cert issuance/renewal still works.
		tlsConf := certMgr.TLSConfig()
		tlsConf.NextProtos = []string{"http/1.1", "acme-tls/1"} // drop "h2"
		tlsSrv = &http.Server{
			Addr:              ":" + cfg.TLSPort,
			Handler:           handler,
			TLSConfig:         tlsConf,
			ReadHeaderTimeout: 10 * time.Second,
			// Empty (non-nil) map disables net/http's automatic HTTP/2 handler.
			TLSNextProto: map[string]func(*http.Server, *tls.Conn, http.Handler){},
		}
		go func() {
			slog.Info("listening (https/acme)", "addr", tlsSrv.Addr)
			if err := tlsSrv.ListenAndServeTLS("", ""); err != nil && !errors.Is(err, http.ErrServerClosed) {
				slog.Error("https server error", "err", err)
				stop()
			}
		}()
	}

	// Pre-populate the self-hosted emoji cache with a curated common set so those
	// emoji never hit Google. Runs in the background (one-time per fresh deploy).
	if cfg.WarmEmoji {
		go api.WarmEmojiCache(ctx, st)
	}

	// Periodically sweep aged-out relay frames. The service worker's read-only
	// preview never acks, so a recipient who never reopens the app would otherwise
	// accumulate undelivered frames forever. Retention stays comfortably ABOVE the
	// message push TTL (28 days, see push.msgTTL) so a tickle held near its TTL by
	// the push service still finds its frame to fetch; the extra week absorbs clock
	// skew and push-service hold-time slop.
	const (
		relaySweepInterval = time.Hour
		relayRetention     = 35 * 24 * time.Hour
		// Media blobs are normally deleted by the sender the moment every recipient has
		// downloaded them (precise path); this is the BACKSTOP for media nobody ever
		// downloads. Kept at the relay retention so the invariant "a still-deliverable
		// envelope has a fetchable blob" holds. Also reclaims the entire pre-feature
		// backlog on first run. Swept in batches so a large backlog never table-locks.
		blobRetention = relayRetention
		blobSweepBatch = 500
	)
	go func() {
		ticker := time.NewTicker(relaySweepInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				sctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
				n, err := st.SweepRelayOlderThan(sctx, relayRetention)
				if err != nil {
					slog.Error("relay sweep", "err", err)
				} else if n > 0 {
					slog.Info("relay sweep", "removed", n)
				}
				// Delivery records (sender-reconcile state) age out on the same
				// schedule/retention as the relay queue they shadow.
				dn, derr := st.SweepDeliveriesOlderThan(sctx, relayRetention)
				if derr != nil {
					slog.Error("deliveries sweep", "err", derr)
				} else if dn > 0 {
					slog.Info("deliveries sweep", "removed", dn)
				}
				// Seen records (spec 1010) shadow the same relay queue with the same
				// retention — swept here for parity with deliveries.
				sn, serr := st.SweepSeenOlderThan(sctx, relayRetention)
				if serr != nil {
					slog.Error("seen sweep", "err", serr)
				} else if sn > 0 {
					slog.Info("seen sweep", "removed", sn)
				}
				// Backstop blob sweep, batched: keep removing the oldest aged-out blobs
				// until a batch comes back short (so the first run grinds through any
				// historical backlog without one giant transaction).
				var bn int64
				for {
					removed, berr := st.SweepBlobsOlderThan(sctx, blobRetention, blobSweepBatch)
					if berr != nil {
						slog.Error("blob sweep", "err", berr)
						break
					}
					bn += removed
					if removed < blobSweepBatch {
						break
					}
				}
				// (spec 2043) Zombie-fleet gauge: recipients who hold a push
				// subscription yet carry unacked relay frames older than a day - the
				// server-side signature of a subscription the push service still
				// 201-accepts but never delivers (the device never wakes to drain).
				// Emitted every sweep as the before/after handle for the client
				// self-heal; costs one indexed count query.
				const zombieStaleAge = 24 * time.Hour
				if zn, zerr := st.CountZombieFleet(sctx, zombieStaleAge); zerr != nil {
					slog.Error("push: zombie fleet", "err", zerr)
				} else {
					slog.Info("push: zombie fleet", "recipients", zn, "staleHours", 24)
				}
				cancel()
				if bn > 0 {
					slog.Info("blob sweep", "removed", bn)
				}
			}
		}
	}()

	<-ctx.Done()
	slog.Info("shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if tlsSrv != nil {
		_ = tlsSrv.Shutdown(shutdownCtx)
	}
	return srv.Shutdown(shutdownCtx)
}

// acmeHosts returns the hostnames ringd will obtain certs for: the public app host,
// plus the TURN host when calls are enabled.
func acmeHosts(cfg config.Config) []string {
	var hosts []string
	if u, err := url.Parse(cfg.PublicURL); err == nil && u.Hostname() != "" {
		hosts = append(hosts, u.Hostname())
	}
	if cfg.EnableCalls && cfg.TurnHost != "" {
		hosts = append(hosts, cfg.TurnHost)
	}
	return hosts
}

// newCertManager builds an autocert.Manager whose state is cached encrypted in
// Postgres (stateless), restricted to acmeHosts(cfg).
func newCertManager(ctx context.Context, st *store.Store, cfg config.Config) (*autocert.Manager, error) {
	aead, err := secrets.NewAEAD(cfg.SecretsKey)
	if err != nil {
		return nil, err
	}
	hosts := acmeHosts(cfg)
	if len(hosts) == 0 {
		return nil, fmt.Errorf("ACME=true but no hostnames to certify (set PUBLIC_URL, and TURN_HOST for calls)")
	}
	cache := acmepkg.NewCache(st, aead, cfg.AcmeDirectoryURL)
	// Drop any account key/certs cached for a different ACME environment so that,
	// e.g., removing ACME_DIRECTORY_URL (staging -> production) re-provisions a
	// real cert at the next handshake instead of serving the stale staging one.
	if n, err := cache.Sweep(ctx); err != nil {
		slog.Warn("acme cache sweep failed", "err", err)
	} else if n > 0 {
		slog.Info("acme cache: removed stale certs from another environment",
			"removed", n, "keeping", cache.Namespace())
	}
	m := &autocert.Manager{
		Cache:      cache,
		Prompt:     autocert.AcceptTOS,
		Email:      cfg.AcmeEmail,
		HostPolicy: autocert.HostWhitelist(hosts...),
	}
	if cfg.AcmeDirectoryURL != "" {
		m.Client = &acme.Client{DirectoryURL: cfg.AcmeDirectoryURL}
	}
	// External Account Binding: non-LE CAs (Google Trust Services, ZeroSSL) bind the
	// ACME account to credentials they pre-issue (KID + HMAC key). Use this to issue
	// from a CA whose root older Android trusts (e.g. GTS -> GlobalSign Root R1) when
	// Let's Encrypt's ISRG roots aren't in the device store. The CA hands out the HMAC
	// key as base64url; autocert HMAC-signs with the RAW bytes, so decode it here.
	if cfg.AcmeEabKid != "" && cfg.AcmeEabHmacKey != "" {
		key, derr := base64.RawURLEncoding.DecodeString(strings.TrimRight(cfg.AcmeEabHmacKey, "="))
		if derr != nil {
			return nil, fmt.Errorf("decode ACME_EAB_HMAC_KEY (expected base64url): %w", derr)
		}
		m.ExternalAccountBinding = &acme.ExternalAccountBinding{KID: cfg.AcmeEabKid, Key: key}
	}
	return m, nil
}
