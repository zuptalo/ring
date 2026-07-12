package turn

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"fmt"
	"math/big"
	"net"
	"testing"
	"time"

	"github.com/pion/turn/v4"
)

// The HTTP endpoint mints credentials with MintCredentials; the relay validates
// them with turn.LongTermTURNRESTAuthHandler using the same secret. This proves
// the two agree (and that the password the client receives is the one the relay
// recomputes), and that expired credentials are rejected.
func TestEphemeralCredentialRoundTrip(t *testing.T) {
	const secret = "test-shared-secret-base64urlish"
	const realm = "ring.example"
	const user = "user-123"

	username, password, err := MintCredentials(secret, user, time.Hour)
	if err != nil {
		t.Fatalf("MintCredentials: %v", err)
	}

	handler := turn.LongTermTURNRESTAuthHandler(secret, nil)
	addr := &net.UDPAddr{IP: net.ParseIP("127.0.0.1"), Port: 1234}

	key, ok := handler(username, realm, addr)
	if !ok {
		t.Fatalf("handler rejected a freshly-minted credential (username=%q)", username)
	}
	// The relay derives its key from the password it recomputes; it must match
	// the key derived from the password the client was handed.
	want := turn.GenerateAuthKey(username, realm, password)
	if !bytes.Equal(key, want) {
		t.Fatalf("auth key mismatch: relay and client-issued password disagree")
	}
}

// A TLS-mode relay with UDPListen set must answer STUN Binding requests on the
// UDP socket (spec 1043: srflx discovery for direct call paths); without
// UDPListen it must not open a UDP socket at all (zero-deployment-change
// safety: upgrading never opens a new port unasked).
func TestTLSModeOptionalUDPListener(t *testing.T) {
	cert := selfSignedCert(t)
	base := Config{
		Realm:        "ring.example",
		RelayIP:      "127.0.0.1",
		ListenAddr:   "127.0.0.1:0",
		SharedSecret: "test-shared-secret-base64urlish",
		TLSConfig:    &tls.Config{Certificates: []tls.Certificate{cert}},
	}

	t.Run("without UDPListen no UDP socket opens", func(t *testing.T) {
		srv, err := Start(base)
		if err != nil {
			t.Fatalf("Start: %v", err)
		}
		defer srv.Close()
		if n := len(srv.conns); n != 0 {
			t.Fatalf("packet conns = %d, want 0", n)
		}
	})

	t.Run("with UDPListen STUN binding gets an answer", func(t *testing.T) {
		cfg := base
		cfg.UDPListen = "127.0.0.1:0"
		srv, err := Start(cfg)
		if err != nil {
			t.Fatalf("Start: %v", err)
		}
		defer srv.Close()
		if n := len(srv.conns); n != 1 {
			t.Fatalf("packet conns = %d, want 1", n)
		}
		addr := srv.conns[0].LocalAddr().String()

		conn, err := net.Dial("udp4", addr)
		if err != nil {
			t.Fatalf("dial udp: %v", err)
		}
		defer conn.Close()
		client, err := turn.NewClient(&turn.ClientConfig{
			STUNServerAddr: addr,
			Conn:           turn.NewSTUNConn(conn),
		})
		if err != nil {
			t.Fatalf("turn client: %v", err)
		}
		defer client.Close()
		if err := client.Listen(); err != nil {
			t.Fatalf("client listen: %v", err)
		}
		if _, err := client.SendBindingRequest(); err != nil {
			t.Fatalf("STUN binding request over the UDP listener: %v", err)
		}
	})
}

// selfSignedCert mints a throwaway localhost cert so the TLS listener can start.
func selfSignedCert(t *testing.T) tls.Certificate {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("gen key: %v", err)
	}
	tmpl := x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "127.0.0.1"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
	}
	der, err := x509.CreateCertificate(rand.Reader, &tmpl, &tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatalf("create cert: %v", err)
	}
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}
}

func TestExpiredCredentialRejected(t *testing.T) {
	const secret = "test-shared-secret-base64urlish"
	const realm = "ring.example"

	// Username with a timestamp one hour in the past.
	past := time.Now().Add(-time.Hour).Unix()
	username := fmt.Sprintf("%d:%s", past, "user-123")

	handler := turn.LongTermTURNRESTAuthHandler(secret, nil)
	addr := &net.UDPAddr{IP: net.ParseIP("127.0.0.1"), Port: 1234}

	if _, ok := handler(username, realm, addr); ok {
		t.Fatal("handler accepted an expired credential")
	}
}
