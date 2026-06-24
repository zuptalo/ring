// Package turn embeds a self-hosted TURN/STUN relay (pion/turn) inside ringd so
// WebRTC calls need no external servers. Media is relayed opaquely: the server
// never holds DTLS keys, so it cannot decrypt 1:1 call media it forwards.
//
// Auth uses ephemeral, time-windowed credentials (the coturn "TURN REST" scheme,
// draft-uberti-behave-turn-rest-00): the HTTP endpoint mints a username/password
// from the shared secret and the relay validates them with the same secret. Both
// sides use pion's helpers so the derivation is identical by construction.
package turn

import (
	"crypto/tls"
	"fmt"
	"net"
	"time"

	"github.com/pion/logging"
	"github.com/pion/turn/v4"
)

// Config configures the embedded relay.
type Config struct {
	Realm string // TURN realm (matches what clients send; usually the public host)
	// RelayIP is the address peers are told to send relayed media to - the
	// server's public IP in prod, 127.0.0.1 in local dev.
	RelayIP string
	// ListenAddr is the bind address (e.g. ":3478"). The L4 proxy forwards the
	// SNI-matched 443 TLS stream here in prod; UDP on this port serves local dev.
	ListenAddr string
	// SharedSecret is the HMAC key (base64url string) for ephemeral credentials.
	// Used verbatim as a string on both sides - do NOT decode it.
	SharedSecret string
	// TLSConfig, when non-nil, enables a TURNS (TURN-over-TLS) listener - required
	// for the 443-only public path. It is either a static cert config or an
	// autocert config (GetCertificate + acme-tls/1 ALPN, so the same listener also
	// answers ACME TLS-ALPN-01 challenges). When nil (dev), a plaintext UDP + TCP
	// relay is started instead so local browsers can reach it.
	TLSConfig *tls.Config
}

// Server wraps the pion TURN server plus the listeners it owns.
type Server struct {
	turn      *turn.Server
	listeners []net.Listener
	conns     []net.PacketConn
}

// Start brings up the relay. Caller must Close it on shutdown. It returns the
// loopback plaintext UDP address (host:port) the co-located SFU should use to
// reach this TURN - so the SFU can gather relay candidates at RelayIP that
// relay-only clients can reach, without the TLS/cert complications of dialing
// the public TURNS endpoint over loopback.
func Start(cfg Config) (srv *Server, err error) {
	relayIP := cfg.RelayIP
	if relayIP == "" {
		relayIP = "127.0.0.1"
	}
	ip := net.ParseIP(relayIP)
	if ip == nil {
		return nil, fmt.Errorf("turn: invalid RELAY_IP %q", cfg.RelayIP)
	}

	relayGen := &turn.RelayAddressGeneratorStatic{
		RelayAddress: ip,
		Address:      "0.0.0.0",
	}
	auth := turn.LongTermTURNRESTAuthHandler(cfg.SharedSecret, logging.NewDefaultLoggerFactory().NewLogger("turn"))

	srvCfg := turn.ServerConfig{
		Realm:       cfg.Realm,
		AuthHandler: auth,
	}

	s := &Server{}

	if cfg.TLSConfig != nil {
		// Production: TURNS over TLS. The L4 proxy hands us the SNI-matched 443
		// TLS stream here; we terminate it (with a static cert or via autocert).
		ln, lerr := tls.Listen("tcp", cfg.ListenAddr, cfg.TLSConfig)
		if lerr != nil {
			s.closeListeners()
			return nil, fmt.Errorf("turn: tls listen %s: %w", cfg.ListenAddr, lerr)
		}
		s.listeners = append(s.listeners, ln)
		srvCfg.ListenerConfigs = append(srvCfg.ListenerConfigs, turn.ListenerConfig{
			Listener:              ln,
			RelayAddressGenerator: relayGen,
		})
	} else {
		// Dev/local: plaintext UDP + TCP so localhost browsers can relay without
		// a certificate. Never expose these publicly.
		pc, perr := net.ListenPacket("udp4", cfg.ListenAddr)
		if perr != nil {
			s.closeListeners()
			return nil, fmt.Errorf("turn: udp listen %s: %w", cfg.ListenAddr, perr)
		}
		s.conns = append(s.conns, pc)
		srvCfg.PacketConnConfigs = append(srvCfg.PacketConnConfigs, turn.PacketConnConfig{
			PacketConn:            pc,
			RelayAddressGenerator: relayGen,
		})

		ln, lerr := net.Listen("tcp", cfg.ListenAddr)
		if lerr != nil {
			s.closeListeners()
			return nil, fmt.Errorf("turn: tcp listen %s: %w", cfg.ListenAddr, lerr)
		}
		s.listeners = append(s.listeners, ln)
		srvCfg.ListenerConfigs = append(srvCfg.ListenerConfigs, turn.ListenerConfig{
			Listener:              ln,
			RelayAddressGenerator: relayGen,
		})
	}

	server, err := turn.NewServer(srvCfg)
	if err != nil {
		s.closeListeners()
		return nil, fmt.Errorf("turn: new server: %w", err)
	}
	s.turn = server
	return s, nil
}

// MintCredentials returns an ephemeral username/password for the given user,
// valid for ttl. Used by the HTTP credentials endpoint and the SFU's self-auth.
func MintCredentials(sharedSecret, userID string, ttl time.Duration) (username, password string, err error) {
	return turn.GenerateLongTermTURNRESTCredentials(sharedSecret, userID, ttl)
}

// Close shuts down the relay and its listeners.
func (s *Server) Close() error {
	var err error
	if s.turn != nil {
		err = s.turn.Close()
	}
	s.closeListeners()
	return err
}

func (s *Server) closeListeners() {
	for _, ln := range s.listeners {
		ln.Close()
	}
	for _, pc := range s.conns {
		pc.Close()
	}
}
