# Checklist: Zero-Knowledge & Privacy (requirements quality)

**Feature**: Instant rich notifications (bounded encrypted preview in push) · spec 1055
**Created**: 2026-07-20
**Purpose**: Validate that the spec's requirements pin down the zero-knowledge boundary and privacy
properties precisely, completely, and testably — BEFORE implementation. These test the requirements, not
the code. Constitution Principle I (zero-knowledge) is non-negotiable; any CHK that cannot be answered
"yes" is a spec gap to fix before `/speckit-implement`.

## Preview-key construction & forward secrecy

- [ ] CHK001 Is the preview key derivation fully specified (input, KDF, domain-separation label) rather than
  left as "a key"? [Clarity, Spec §FR-002]
- [ ] CHK002 Is it explicitly required that the preview key derive from the per-message ratchet key `mk_N`
  (not a root key, session key, or standing secret), so forward secrecy is inherited? [Completeness, §FR-002/FR-010]
- [ ] CHK003 Is the forward-secrecy property stated as a testable outcome — a captured preview push is
  undecryptable once `mk_N` is consumed on authoritative processing? [Measurability, §FR-010, §SC-006]
- [ ] CHK004 Does the spec explicitly PROHIBIT any standing/long-lived notification content key? [Completeness, §FR-010]
- [x] CHK005 Is the associated-data binding (ratchet header bound to the preview AEAD) required, so a preview
  cannot be swapped/replayed onto a different frame? [Coverage, §FR-002 — now a MUST: header bound as AD, open fails on mismatch]
- [ ] CHK006 Is the interaction between the outer RFC-8291 push encryption (long-lived subscription keys) and
  the inner forward-secret preview AEAD described, so the FS claim is not silently defeated by the outer layer?
  [Consistency, §ZK Impact]

## Peek-decrypt consumes nothing

- [ ] CHK007 Is it required that preview decryption writes NO ratchet state (no `saveSession`), stores no
  message, and sends no ack — i.e. consumes nothing? [Completeness, §FR-004]
- [ ] CHK008 Is "operate on a freshly loaded session copy, never a shared live state object" captured as a
  requirement or only as a plan note? [Ambiguity, plan risks §]
- [ ] CHK009 Is the single-authoritative-consume invariant stated — exactly one decrypt+store+ack (warm or open)
  ever advances/persists the ratchet, so session desync is impossible? [Completeness, §FR-006/FR-009]

## What the push provider can observe

- [ ] CHK010 Is payload SIZE named as the ONE new observable versus the constant tickle, and is constant-size
  padding required to neutralize it? [Completeness, §FR-003, §SC-004]
- [ ] CHK011 Is "constant byte length across all message lengths AND kinds" a measurable acceptance criterion
  (not "small" or "bounded")? [Measurability, §SC-004]
- [ ] CHK012 Is it required that sender/message identifiers (`from`, `id`) live INSIDE the push-encrypted body,
  never in cleartext headers? [Completeness, §FR-003]
- [ ] CHK013 Is the removal of the cleartext `Topic` header on preview pushes required, and is the burst-collapse
  consequence of a shared Topic documented so it is not re-added? [Clarity, plan wire §; is it a requirement?]
- [ ] CHK014 Are the observables the provider RETAINS (endpoint, timing, constant size) explicitly enumerated so
  the claim "learns nothing about length/content" is scoped and honest? [Clarity, §ZK Impact]

## What Ring's server can observe / store

- [ ] CHK015 Is it required that the server stores NO new plaintext and adds no readable field — the preview is
  opaque ciphertext forwarded transiently at push time? [Completeness, §FR-007]
- [ ] CHK016 Is the `notified_at` addition characterized as a ZK-neutral timestamp (no content), and its purpose
  (which queued frames are seen-but-not-downloaded) stated? [Clarity, §FR-013, §ZK Impact]
- [ ] CHK017 Is it required that the preview blob is NOT persisted in the relay row (used transiently), so the
  "no schema change beyond a timestamp" claim holds? [Consistency, plan server §4/§6]
- [ ] CHK018 Does the spec confirm the server cannot read the preview any more than it can read the full message
  (same E2EE trust boundary), i.e. no new decryption capability is implied? [Completeness, §ZK Impact]

## Receipt side-channels (notified / delivered)

- [ ] CHK019 Is it required that the `notified` receipt fires on DECRYPT (device received), NOT on the visible
  display outcome, so mute/hidden cannot be inferred from receipt presence or timing? [Completeness, §FR-015]
- [ ] CHK020 Is `notified` vs `delivered` reveal-equivalence stated — `notified` exposes only what `delivered`
  already does (recipient reachability + timing), no content? [Clarity, §ZK Impact]
- [x] CHK021 Is the muted-chat receipt path defined so muted deliveries are indistinguishable from "recipient
  offline" (both flip on open), leaking no mute signal to the sender? [Coverage, edge cases — now explicit: muted stays
  `sent`, no server-fabricated receipt, WS still delivers when online, offline-indistinguishable]
- [ ] CHK022 Is the decrypt-failure case specified (no `notified`; later `delivered` covers it) so a gap is not
  misread as a leak or a lost receipt? [Edge Case, §FR-015]

## Muting, hidden chats, and preferences

- [ ] CHK023 Is server-side drop (spec 1050 `AllowPush` / `MutedPrids`) required as the PRIMARY muting mechanism,
  with the preview push passing the IDENTICAL gate as the tickle? [Completeness, §FR-016, §SC-011]
- [ ] CHK024 Is it required that a muted `prid` yields NO push at all (tickle OR preview), so a muted device is
  never woken and never risks a silent-wake strike? [Completeness, §FR-016]
- [ ] CHK025 Is the client-side mute suppression scoped as a revocation-safe FALLBACK (mute-sync gap) that on iOS
  ends with a silent generic — explicitly NOT relied on for true muting? [Clarity, §FR-016, edge cases]
- [ ] CHK026 Is hidden-chat handling required to render a content-free generic (no sender/avatar/body) via the
  same `noteForPayload` choke point, with the recipient's local hidden set — never the sealed content? [Completeness, §FR-014]
- [ ] CHK027 Is it stated that hidden chats are structurally absent from `MutedPrids` (so they DO push and the
  client generalizes), consistent with spec 1019? [Consistency, edge cases]
- [ ] CHK028 Is "Show preview" off required to hide BOTH body AND sender, and per-chat content-none / master-off
  handled, with parity to the fetch path as a measurable criterion? [Measurability, §FR-014, §SC-010]
- [ ] CHK029 Is it required that `previewInline` SOURCES the recipient's hidden set + prefs (never defaults them
  empty/permissive), i.e. the privacy defaults fail closed? [Completeness, §FR-014]

## Fallbacks, legacy, and no-silent-wake

- [ ] CHK030 Is every preview-path outcome (rich, generic-fallback on decrypt failure, hidden-generic, silent
  generic when suppressed) required to end the wake VISIBLY or with licensed silence — never a silent wake? [Coverage, §FR-005/FR-008]
- [ ] CHK031 Is the legacy-iOS (≤16) path required to NOT attempt preview decryption (lite path stands), so the
  new crypto never runs where SW IndexedDB is unreliable? [Completeness, §FR-008, edge cases]
- [ ] CHK032 Is the "notified-but-never-downloaded past 35-day retention" data-loss edge acknowledged and deemed
  acceptable, so it is a known bounded outcome rather than an unstated risk? [Edge Case, edge cases]

## Scope & consistency

- [ ] CHK033 Are the eligible frame kinds (1:1, reaction, group via pairwise 1:1; post/wall via `K_post`; calls
  excluded) enumerated consistently across spec and plan, so no unintended frame inlines content? [Consistency, §FR-001]
- [ ] CHK034 Does the ZK Impact section's "server unchanged / provider strictly-less / FS preserved" claim trace
  to specific FRs and SCs (not asserted narratively only)? [Traceability, §ZK Impact]
