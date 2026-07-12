# Data Model: Direct Peer-to-Peer Call Media with Relay Fallback (spec 1043)

No database schema changes (client `DB_VERSION` untouched; no server migration). Three small data shapes change or appear.

## 1. Client setting: `privacy.relayCalls`

| Property | Value |
|----------|-------|
| Key | `privacy.relayCalls` |
| Type | boolean |
| Default | `false` |
| Storage | existing client settings store (IndexedDB), read via `getSetting<boolean>('privacy.relayCalls', false)` |
| Sync | added to `SYNCED_PREF_KEYS` (`src/services/ownsync-keys.ts`) — encrypted own-data sync, last-write-wins on `updatedAt` |
| UI | declarative toggle in the `privacy` node of `src/settings/schema.ts`, title "Always relay calls" |
| Lifecycle | read at every peer-connection construction (1:1 create, mesh leg build, ICE-restart `setConfiguration`); a change applies from the next call |
| Constraint | the retired key `privacy.protectIp` stays on the DEAD list and MUST NOT be reused (stale synced snapshots) |

## 2. Server configuration (env)

| Env var | Type / default | Meaning |
|---------|----------------|---------|
| `TURN_UDP_LISTEN` | string, default `""` (disabled) | Bind address (e.g. `:3478`) for a plaintext UDP listener that runs **also in TLS mode**. Empty → no listener, no new port (today's behavior). pion serves STUN Binding + TURN-over-UDP on it with the existing REST credentials. |
| `STUN_PUBLIC_HOST` | string, default: the TURN public host | Hostname/IP advertised to clients for the UDP endpoint. |
| `STUN_PUBLIC_PORT` | int, default: port of `TURN_UDP_LISTEN` | Port advertised to clients for the UDP endpoint. |
| `RELAY_IP` | existing, default `127.0.0.1` | Unchanged; docs gain a note that UDP-enabled operators may set it public for one-sided relay. |

Validation: `TURN_UDP_LISTEN` set but unparseable → boot error (same style as existing listen-addr validation). `STUN_PUBLIC_*` without `TURN_UDP_LISTEN` → ignored (nothing to advertise).

## 3. `/v1/turn-credentials` response (contract detail in contracts/turn-credentials.md)

Shape is **unchanged**: `{ "iceServers": [...], "ttl": <seconds> }`. The `iceServers` array gains an optional second element (credential-less STUN/UDP-TURN advertisement) only when the UDP endpoint is configured.

## 4. Derived/computed values (no storage)

- **Effective ICE policy** (client, per connection): `relayOnly = getSetting('privacy.relayCalls', false)` → `iceTransportPolicy: relayOnly ? 'relay' : 'all'`. Computed in one helper (`callRtcConfig()` in `src/services/call/turn.ts`) shared by all call sites.
- **Advertised URL set** (server, at boot): TLS mode → `turns:<host>:443?transport=tcp` always; plus `stun:` and `turn:...?transport=udp` entries when `TURN_UDP_LISTEN` is set. Dev (no TLS) mode unchanged.
