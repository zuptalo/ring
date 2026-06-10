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

	"github.com/pion/webrtc/v4"
	"golang.org/x/crypto/acme"
	"golang.org/x/crypto/acme/autocert"

	acmepkg "ring/server/internal/acme"
	"ring/server/internal/api"
	"ring/server/internal/config"
	"ring/server/internal/db"
	"ring/server/internal/push"
	"ring/server/internal/secrets"
	sfupkg "ring/server/internal/sfu"
	"ring/server/internal/store"
	turnpkg "ring/server/internal/turn"
	"ring/server/internal/ws"
)

// version is the build version, stamped at link time via
// -ldflags "-X main.version=...". Defaults to "dev" for plain `go build`/`go run`.
var version = "dev"

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
		// These spare codes let you register additional test accounts.
		codes := []string{
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
			"NAVTERM1",
		}
		if err := st.SeedDevInvites(ctx, codes); err != nil {
			return err
		}
		slog.Info("seeded dev invitation codes", "count", len(codes))
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

	// Embedded TURN/STUN relay for WebRTC calls. Media is relayed opaquely (the
	// server never sees DTLS keys). In dev it runs plaintext on TurnListen; in
	// prod it terminates TLS (TURNS) for the SNI host the L4 proxy routes to us.
	var turnURLs []string
	if cfg.EnableCalls {
		turnCfg := turnpkg.Config{
			Realm:        cfg.TurnRealm,
			RelayIP:      cfg.RelayIP,
			ListenAddr:   cfg.TurnListen,
			SharedSecret: secs.TurnSharedSecret,
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
		turnSrv, sfuTurnAddr, err := turnpkg.Start(turnCfg)
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
			"urls", turnURLs, "tls", turnCfg.TLSConfig != nil)

		// Group-call SFU. It forwards RTP it cannot decrypt (clients E2EE the
		// payload via insertable streams). The send callback delivers the SFU's
		// offers/candidates to a participant over the WS signalling channel. The
		// ICE func mints fresh ephemeral credentials per PeerConnection so the SFU
		// gathers relay candidates at the public RelayIP via the co-located TURN's
		// loopback endpoint - reachable by relay-only clients under the 443
		// constraint.
		sfuTurnURL := "turn:" + sfuTurnAddr + "?transport=udp"
		sfuICE := func() []webrtc.ICEServer {
			user, pass, err := turnpkg.MintCredentials(secs.TurnSharedSecret, "sfu", time.Hour)
			if err != nil {
				slog.Error("sfu mint turn creds", "err", err)
				return nil
			}
			return []webrtc.ICEServer{{URLs: []string{sfuTurnURL}, Username: user, Credential: pass}}
		}
		sfuInst := sfupkg.New(func(sig sfupkg.Signal) {
			hub.SendCallSignal(sig.UserID, sig.T, sig.RoomID, sig.Data)
		}, sfuICE)
		hub.SetSFU(sfuInst)
		slog.Info("group-call SFU ready", "relayVia", sfuTurnURL)
	}

	handler := api.NewRouter(&api.Handlers{
		Store: st, Directory: st, Contacts: st, Connections: st, Blocks: st, Keys: st, Relay: st, Hub: hub, Blobs: st, Sync: st, Push: st,
		Invites: st, Notifier: notifier, RequireConnection: cfg.RequireConnection,
		PublicURL: cfg.PublicURL, VapidPublicKey: secs.VapidPublicKey, MaxBlobBytes: cfg.MaxBlobBytes,
		Version:      version,
		CallsEnabled: cfg.EnableCalls, TurnSharedSecret: secs.TurnSharedSecret,
		TurnURLs:      turnURLs,
		Emoji:     st,
		StaticDir: cfg.StaticDir,
		DevMode:   cfg.IsDev(),
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
		tlsSrv = &http.Server{
			Addr:              ":" + cfg.TLSPort,
			Handler:           handler,
			TLSConfig:         certMgr.TLSConfig(),
			ReadHeaderTimeout: 10 * time.Second,
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
				cancel()
				if derr != nil {
					slog.Error("deliveries sweep", "err", derr)
				} else if dn > 0 {
					slog.Info("deliveries sweep", "removed", dn)
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
