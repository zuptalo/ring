# Data Model: Tech Stack Uplift

Not applicable. This spec introduces no new entities, fields, relationships, or
state transitions — it changes dependency versions, build tooling, base images,
and CI configuration only. `IndexedDB` object stores (client) and the PostgreSQL
schema (server) are untouched: no `DB_VERSION` bump, no new migration.

The one item that could plausibly affect stored data is the
`libsodium-wrappers-sumo` bump (Phase C), and the spec's constraint on it (FR-005)
is precisely that it must **not** change wire format, key derivation, or
ciphertext compatibility for anything already persisted — i.e. the data model is
required to stay identical, not evolve.
