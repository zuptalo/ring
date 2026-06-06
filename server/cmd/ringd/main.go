// Command ringd is the Ring backend HTTP server (Milestone 7a: accounts).
package main

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/pion/webrtc/v4"

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
// If there are no accounts and no claimable invitation codes, it mints one;
// either way it surfaces the first-run code in the logs and writes it to
// <DataDir>/first-run-invite.txt. Once anyone has registered it removes that
// file and does nothing else.
func ensureBootstrapInvite(ctx context.Context, st *store.Store, cfg config.Config) error {
	invitePath := filepath.Join(cfg.DataDir, "first-run-invite.txt")

	users, err := st.CountUsers(ctx)
	if err != nil {
		return err
	}
	if users > 0 {
		_ = os.Remove(invitePath) // first run is over; the file (if any) is stale
		return nil
	}

	// Reuse the previously-minted first-run code if it's still a valid 8-char
	// claimable code (so restarts don't pile up codes); otherwise mint a fresh
	// one. Always a proper generated 8-char code - never a short/seed code.
	code := readInviteCodeFromFile(invitePath)
	if code != "" && len(code) == 8 {
		ok, err := st.IsInviteClaimable(ctx, code)
		if err != nil {
			return err
		}
		if !ok {
			code = ""
		}
	} else {
		code = ""
	}
	if code == "" {
		if code, err = generateInviteCode(); err != nil {
			return err
		}
		if err := st.CreateInvite(ctx, code); err != nil {
			return err
		}
	}

	writeInviteFile(invitePath, code, cfg.PublicURL)
	slog.Warn("FIRST-RUN: register the first account with this invitation code",
		"code", code, "file", invitePath, "publicUrl", cfg.PublicURL)
	return nil
}

// readInviteCodeFromFile extracts the `code: XXXXXXXX` line from a previously
// written first-run invite file (empty string if absent/unparseable).
func readInviteCodeFromFile(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(data), "\n") {
		if rest, ok := strings.CutPrefix(line, "code: "); ok {
			return strings.TrimSpace(rest)
		}
	}
	return ""
}

func writeInviteFile(path, code, publicURL string) {
	content := fmt.Sprintf(
		"Ring - first-run invitation code\n================================\n\ncode: %s\n\nRegister the first account at: %s\n(This file is removed automatically once the first account is created.)\n",
		code, publicURL)
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		slog.Warn("could not write first-run invite file", "path", path, "err", err)
	}
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

	// Auto-generate (or load) server secrets - VAPID + token-signing keys - so
	// the operator never supplies them. Persisted under DataDir.
	secs, err := secrets.LoadOrCreate(cfg.DataDir)
	if err != nil {
		return err
	}
	slog.Info("secrets ready", "dataDir", cfg.DataDir, "vapidPublicKey", secs.VapidPublicKey)

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
			"AUTOLCK1", "AUTOLCK2",
			"SWDECR01", "SWDECR02",
			"CURATED1", "CURATED2",
			"PRESTIR1", "PRESTIR2", "PRESTIR3",
			"MEDIACLN",
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
		if cfg.TurnTLSCert != "" && cfg.TurnTLSKey != "" {
			cert, err := tls.LoadX509KeyPair(cfg.TurnTLSCert, cfg.TurnTLSKey)
			if err != nil {
				return fmt.Errorf("load TURN TLS cert: %w", err)
			}
			turnCfg.TLSCert = &cert
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
		if turnCfg.TLSCert != nil {
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
			"urls", turnURLs, "tls", turnCfg.TLSCert != nil)

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

	srv := &http.Server{
		Addr: ":" + cfg.Port,
		Handler: api.NewRouter(&api.Handlers{
			Store: st, Directory: st, Contacts: st, Blocks: st, Keys: st, Relay: st, Hub: hub, Blobs: st, Sync: st, Push: st,
			Invites: st, Notifier: notifier,
			PublicURL: cfg.PublicURL, VapidPublicKey: secs.VapidPublicKey, MaxBlobBytes: cfg.MaxBlobBytes,
			CallsEnabled: cfg.EnableCalls, TurnSharedSecret: secs.TurnSharedSecret,
			TurnURLs:      turnURLs,
			EmojiCacheDir: filepath.Join(cfg.DataDir, "emoji-cache"),
			StaticDir:     cfg.StaticDir,
			DevMode:       cfg.IsDev(),
		}, cfg.AllowedOrigins),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		slog.Info("listening", "addr", srv.Addr, "env", cfg.Env)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("server error", "err", err)
			stop()
		}
	}()

	// Pre-populate the self-hosted emoji cache with a curated common set so those
	// emoji never hit Google. Runs in the background (one-time per fresh deploy).
	if cfg.WarmEmoji {
		go api.WarmEmojiCache(ctx, filepath.Join(cfg.DataDir, "emoji-cache"))
	}

	// Periodically sweep aged-out relay frames. The service worker's read-only
	// preview never acks, so a recipient who never reopens the app would otherwise
	// accumulate undelivered frames forever. Retention stays >= the message push
	// TTL (~28 days) so a long-held tickle always still has a frame to fetch.
	const (
		relaySweepInterval = time.Hour
		relayRetention     = 30 * 24 * time.Hour
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
				cancel()
				if err != nil {
					slog.Error("relay sweep", "err", err)
				} else if n > 0 {
					slog.Info("relay sweep", "removed", n)
				}
			}
		}
	}()

	<-ctx.Done()
	slog.Info("shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return srv.Shutdown(shutdownCtx)
}
