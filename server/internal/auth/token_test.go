package auth

import "testing"

func TestNewTokenShape(t *testing.T) {
	tok, err := NewToken()
	if err != nil {
		t.Fatalf("NewToken: %v", err)
	}
	if len(tok) != 64 { // 32 bytes hex-encoded
		t.Fatalf("token length = %d, want 64", len(tok))
	}
	other, _ := NewToken()
	if tok == other {
		t.Fatal("two tokens collided; not random")
	}
}

func TestHashTokenDeterministic(t *testing.T) {
	a := HashToken("hello")
	b := HashToken("hello")
	if !EqualHash(a, b) {
		t.Fatal("same input produced different hashes")
	}
	if len(a) != 32 {
		t.Fatalf("hash length = %d, want 32", len(a))
	}
	if EqualHash(a, HashToken("world")) {
		t.Fatal("different inputs produced equal hashes")
	}
}
