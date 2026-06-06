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

	c, err := Load()
	if err != nil {
		t.Fatalf("prod Load with both set should not error: %v", err)
	}
	if c.DatabaseURL == "" || c.PublicURL != "https://ring.example" {
		t.Fatalf("unexpected config: %+v", c)
	}
}
