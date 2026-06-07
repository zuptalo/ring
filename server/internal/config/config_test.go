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
