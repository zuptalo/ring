package turn

import (
	"bytes"
	"fmt"
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
