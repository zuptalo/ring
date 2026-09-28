module ring/server

go 1.27

require (
	github.com/SherClockHolmes/webpush-go v1.4.0
	github.com/gorilla/websocket v1.5.3
	github.com/jackc/pgx/v5 v5.11.0
	github.com/pion/logging v0.2.4
	github.com/pion/turn/v4 v4.1.4
	golang.org/x/crypto v0.57.0
)

require (
	github.com/golang-jwt/jwt/v5 v5.3.1 // indirect
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	github.com/jackc/puddle/v2 v2.2.2 // indirect
	github.com/pion/dtls/v3 v3.1.4 // indirect
	github.com/pion/randutil v0.1.0 // indirect
	github.com/pion/stun/v3 v3.1.5 // indirect
	github.com/pion/transport/v4 v4.0.2 // indirect
	github.com/wlynxg/anet v0.0.5 // indirect
	golang.org/x/net v0.59.0 // indirect
	golang.org/x/sync v0.23.0 // indirect
	golang.org/x/sys v0.48.0 // indirect
	golang.org/x/text v0.42.0 // indirect
)

// Patched fork fixing a retry-exhaustion bug in verifyRFC (acme/autocert) that breaks TLS-ALPN-01
// cert issuance when only one challenge type is configured (our case). See /patches/x-crypto/PATCH.md.
replace golang.org/x/crypto => ../patches/x-crypto
