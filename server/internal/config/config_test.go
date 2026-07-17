package config

import (
	"strings"
	"testing"
)

func TestDevFillsDefaults(t *testing.T) {
	t.Setenv("ENV", "dev")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("PUBLIC_URL", "")

	c, err := Load()
	if err != nil {
		t.Fatalf("dev Load should not error: %v", err)
	}
	if c.DatabaseURL == "" || c.PublicURL == "" {
		t.Fatalf("dev defaults not applied: %+v", c)
	}
}

func TestProdRequiresDatabaseAndPublicURL(t *testing.T) {
	t.Setenv("ENV", "prod")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("PUBLIC_URL", "")

	_, err := Load()
	if err == nil {
		t.Fatal("prod Load should error when DATABASE_URL and PUBLIC_URL are unset")
	}
	if !strings.Contains(err.Error(), "DATABASE_URL") || !strings.Contains(err.Error(), "PUBLIC_URL") {
		t.Fatalf("error should name both missing vars: %v", err)
	}
}

func TestProdWithRequiredSet(t *testing.T) {
	t.Setenv("ENV", "prod")
	t.Setenv("DATABASE_URL", "postgres://u:p@db:5432/ring")
	t.Setenv("PUBLIC_URL", "https://ring.example")
	t.Setenv("SECRETS_KEY", "prod-secrets-key")

	c, err := Load()
	if err != nil {
		t.Fatalf("prod Load with required set should not error: %v", err)
	}
	if c.DatabaseURL == "" || c.PublicURL != "https://ring.example" || c.SecretsKey == "" {
		t.Fatalf("unexpected config: %+v", c)
	}
}

func TestProdRequiresSecretsKey(t *testing.T) {
	t.Setenv("ENV", "prod")
	t.Setenv("DATABASE_URL", "postgres://u:p@db:5432/ring")
	t.Setenv("PUBLIC_URL", "https://ring.example")
	t.Setenv("SECRETS_KEY", "")

	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "SECRETS_KEY") {
		t.Fatalf("prod Load should require SECRETS_KEY, got: %v", err)
	}
}

func TestProdCallsWithoutCertOrAcmeFails(t *testing.T) {
	t.Setenv("ENV", "prod")
	t.Setenv("DATABASE_URL", "postgres://u:p@db:5432/ring")
	t.Setenv("PUBLIC_URL", "https://ring.example")
	t.Setenv("SECRETS_KEY", "k")
	t.Setenv("ENABLE_CALLS", "true")

	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "TURNS certificate") {
		t.Fatalf("calls without a cert or ACME should fail, got: %v", err)
	}
}

func TestProdCallsWithAcmeOK(t *testing.T) {
	t.Setenv("ENV", "prod")
	t.Setenv("DATABASE_URL", "postgres://u:p@db:5432/ring")
	t.Setenv("PUBLIC_URL", "https://ring.example")
	t.Setenv("SECRETS_KEY", "k")
	t.Setenv("ENABLE_CALLS", "true")
	t.Setenv("ACME", "true")

	c, err := Load()
	if err != nil {
		t.Fatalf("ACME should satisfy the calls cert requirement: %v", err)
	}
	if !c.Acme || c.TLSPort == "" {
		t.Fatalf("acme config not populated: %+v", c)
	}
}

/* ---- optional UDP endpoint for direct call paths (spec 1043) ---- */

func TestTurnUDPListenDerivesStunDefaults(t *testing.T) {
	t.Setenv("ENV", "dev")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("PUBLIC_URL", "https://ring.example")
	t.Setenv("TURN_UDP_LISTEN", ":3478")
	t.Setenv("STUN_PUBLIC_HOST", "")
	t.Setenv("STUN_PUBLIC_PORT", "")
	t.Setenv("TURN_PUBLIC_HOST", "")
	t.Setenv("TURN_HOST", "")

	c, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if c.TurnUDPListen != ":3478" {
		t.Fatalf("TurnUDPListen = %q", c.TurnUDPListen)
	}
	// Port defaults from the listen address; host from the derived TURN host
	// (turn.<PUBLIC_URL host> when nothing more specific is set).
	if c.StunPublicPort != "3478" {
		t.Fatalf("StunPublicPort = %q, want 3478", c.StunPublicPort)
	}
	if c.StunPublicHost != "turn.ring.example" {
		t.Fatalf("StunPublicHost = %q, want turn.ring.example", c.StunPublicHost)
	}
}

func TestTurnUDPListenExplicitStunOverrides(t *testing.T) {
	t.Setenv("ENV", "dev")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("PUBLIC_URL", "https://ring.example")
	t.Setenv("TURN_UDP_LISTEN", "0.0.0.0:3999")
	t.Setenv("STUN_PUBLIC_HOST", "media.ring.example")
	t.Setenv("STUN_PUBLIC_PORT", "443")

	c, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if c.StunPublicHost != "media.ring.example" || c.StunPublicPort != "443" {
		t.Fatalf("explicit stun advertisement not honored: %+v", c)
	}
}

func TestTurnUDPListenPrefersTurnPublicHost(t *testing.T) {
	t.Setenv("ENV", "dev")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("PUBLIC_URL", "https://ring.example")
	t.Setenv("TURN_UDP_LISTEN", ":3478")
	t.Setenv("TURN_PUBLIC_HOST", "edge.ring.example")
	t.Setenv("STUN_PUBLIC_HOST", "")
	t.Setenv("STUN_PUBLIC_PORT", "")

	c, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if c.StunPublicHost != "edge.ring.example" {
		t.Fatalf("StunPublicHost = %q, want edge.ring.example (TURN_PUBLIC_HOST wins)", c.StunPublicHost)
	}
}

func TestTurnUDPListenInvalidFailsFast(t *testing.T) {
	t.Setenv("ENV", "dev")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("PUBLIC_URL", "https://ring.example")
	t.Setenv("TURN_UDP_LISTEN", "not-a-bind-address")

	if _, err := Load(); err == nil {
		t.Fatal("an unparseable TURN_UDP_LISTEN must fail fast (a listener that silently never opened)")
	}
}

func TestNoTurnUDPListenLeavesStunUnset(t *testing.T) {
	t.Setenv("ENV", "dev")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("PUBLIC_URL", "https://ring.example")
	t.Setenv("TURN_UDP_LISTEN", "")
	t.Setenv("STUN_PUBLIC_HOST", "")
	t.Setenv("STUN_PUBLIC_PORT", "")

	c, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if c.TurnUDPListen != "" || c.StunPublicHost != "" || c.StunPublicPort != "" {
		t.Fatalf("zero-config deployment must not grow stun settings: %+v", c)
	}
}
