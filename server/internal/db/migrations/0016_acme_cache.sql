-- Built-in ACME (Let's Encrypt) state for ringd's autocert manager.
--
-- When ACME=true, ringd provisions and renews its own TLS certs for the app
-- (HTTPS) and TURNS listeners. autocert needs a Cache for the account key, the
-- issued certs, and challenge state; storing it here keeps the container
-- stateless (no disk). The values are AES-256-GCM encrypted with the SECRETS_KEY
-- before they are written (the ACME account key is sensitive), so a database dump
-- alone cannot use them. Keys are autocert's cache keys (e.g. "acme_account+key",
-- "<host>", "<host>+token").

CREATE TABLE acme_cache (
    key        text  PRIMARY KEY,
    data       bytea NOT NULL,               -- nonce(12) || AES-256-GCM(value)
    updated_at timestamptz NOT NULL DEFAULT now()
);
