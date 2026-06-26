# Implementation Plan: Hidden Chats Locked Behind a PIN

**Branch**: `feat/1019-hidden-chats-pin` | **Date**: 2026-06-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/1019-hidden-chats-pin/spec.md`

## Summary

Add a client-only privacy layer that lets a user take specific conversations out
of every visible surface (Chats tab, search, pickers, Calls tab / call history,
notification previews) and reveal them only by entering a **separate dedicated
PIN** in the chat-list search field, with optional biometric unlock. A hidden
chat is a **distinct conversation** — modeled on the existing group mechanism (a
2-person "group" reusing sender-key crypto) so it can coexist with the normal 1:1
with the same person. Revealing is "sticky" within a short, configurable grace
window across brief backgrounding but **always re-locks on a full app close**.
Resetting the PIN permanently wipes the hidden conversations on this device and
blocks them from re-syncing from the server.

**Technical approach (grounded in the codebase):**

- **Membership, not a column.** The set of hidden conversation ids is held as a
  *separate, local-only, master-key-wrapped* blob in the `settings` store — never
  a field on the synced `chats` row (rows are sealed and synced whole via
  `ownsync.ts`, so a `hidden` column would propagate to other devices and violate
  "hiding is local per device"). The single choke point `listChats()`
  (`src/db/queries.ts`) and the `calls`/notification paths consult this set to
  exclude hidden conversations everywhere.
- **Separate PIN** mirrors the existing app-PIN pattern (`identity.ts`
  `wrapSecret`/`verifyPin`): an Argon2id-derived key over a random salt, stored as
  a wrapped verifier; "verify" is decryption success (AEAD tag), no plaintext PIN
  at rest. Entering it starts an in-memory **reveal session**.
- **Reveal session + grace window** reuse the `useAutoLock.ts` pattern
  (`visibilitychange` + elapsed-time check). The revealed state lives only in
  memory and is never persisted in a form that survives a cold start, so a full
  close always re-locks.
- **Distinct conversation** uses `createGroup('', [contactId])` (no minimum size
  enforced) to mint a coexisting hidden thread; the counterpart sees a normal
  separate conversation (confirmed acceptable).
- **Reset wipe + block re-sync** reuses the **tombstone** mechanism, but with a
  new *local-only* variant that blocks ingest in `pullOwnData()` without uploading
  a deletion frame (so other devices keep their copy).
- **No server changes, no new IndexedDB store, no DB_VERSION bump.** Everything
  rides existing stores (`settings`, `keystore`, `chats`, `messages`, `sessions`,
  `senderkeys`, `calls`) and existing client paths.

## Technical Context

**Language/Version**: TypeScript (ES modules, `@/`→`src/`), Vue 3 `<script setup>`
+ Ionic; Go 1.26 server (untouched by this feature).

**Primary Dependencies**: Ionic Vue, libsodium-wrappers-sumo (existing crypto
core: X3DH, Double Ratchet, sender keys), IndexedDB via `src/db/idb.ts`.

**Storage**: IndexedDB (offline-first source of truth). Reused stores: `settings`
(wrapped hidden-set, hidden-PIN verifier, local-only block list, grace/biometric
prefs), `keystore` (PIN-derived wrapping), `chats`/`messages`/`sessions`/
`senderkeys` (the distinct hidden conversation), `calls` (history filtering),
`tombstones` (extended with a local-only flavor). **No new store; no DB_VERSION
bump** (current `DB_VERSION` = 9, unchanged).

**Testing**: `npm run build` (vue-tsc typecheck) + vitest unit tests for the pure
pieces (set wrap/unwrap, PIN verify, filter exclusion, reset wipe/block logic);
Playwright e2e under `e2e/` for hide → reveal → coexist → notification → call-log
suppression; `drive/` for manual multi-user inspection.

**Target Platform**: Installable PWA (mobile-first, iPhone-under-chromium parity);
custom service worker (`src/sw.ts`) for Web Push.

**Project Type**: Client-only feature within the Vue PWA (no `server/` changes).

**Performance Goals**: No perceptible regression to chat-list/search render; the
hidden-set lookup is an in-memory Set membership check. Reveal/lock transitions
feel instant (<100ms perceived).

**Constraints**: Zero-knowledge boundary intact (no new wire data); offline-first;
"no observable signal when unused" (FR-014/SC-005); must not regress the existing
notification burst-coalescing (spec 2017) or the Locked-chats feature.

**Scale/Scope**: Per-device set of hidden conversations (tens, realistically);
touches ~6 client subsystems (data layer, crypto, chat-list/search UI, settings,
notifications/SW, calls, sync). ~7 user stories, P1→P3 sliceable.

## Constitution Check

*GATE: re-checked after Phase 1 design — still PASS.*

| Principle | Assessment |
|---|---|
| **I. Zero-Knowledge (NON-NEGOTIABLE)** | PASS. No new request/field/log crosses the wire. The hidden conversation is just another opaque group to the server (membership already encrypted). The hidden-set, PIN verifier and block-list never leave the device. Spec carries the mandatory **Zero-Knowledge Impact** section. |
| **II. Spec-Driven** | PASS. Spec written, clarified (2026-06-26 session, 0 open markers), now planning. Branch/commits traceable to `1019`. |
| **III. TDD** | PASS (enforced in tasks). `tasks.md` will order failing unit tests (set wrap/unwrap, separate-PIN verify, `listChats` exclusion, calls exclusion, reset wipe+block, generic-notification builder) and an e2e spec before implementation. |
| **IV. Crypto Discipline** | PASS. Reuses libsodium primitives (`seal/open/sealJson/openJson`, `argon2id`) and the `wrapSecret`/`verifyPin` pattern; reuses sender keys for the 2-person group. **No new primitives or schemes.** Requires a **security review** and a **`/speckit-checklist`** (crypto/ZK spec) before implement. |
| **V. Offline-First** | PASS. IndexedDB stays source of truth; reactivity via the existing change-bus + `useLiveQuery`. **No new object store / no `onupgradeneeded` change** — all state in existing stores. |
| **VI. Stateless Server & Migrations** | PASS (trivially). No server code, no SQL migration, no `SECRETS_KEY` impact. |
| **VII. Quality Gates** | PASS at done: `npm run build`, server build/vet/test (unaffected), vitest + e2e green. Release-note subject will be plain-language. |
| **VIII. Traceable Delivery** | PASS. `taskstoissues` → one issue per task; feature→`develop` PR lists `Closes #N`. |
| **IX. Privacy & Data Minimization** | PASS (the feature *strengthens* privacy; collects nothing new). |
| **X. Accessibility & i18n** | PASS. Settings via the declarative schema; reveal/PIN UI from Ionic primitives; bidi-correct. |
| **XI. Ionic-First UI** | PASS. Reuses `ion-searchbar` (reveal), `ChatActionsSheet`/`ChatListItem` (Hide action), `SettingDetailPage` schema (controls), Ionic alerts for the destructive reset warning. No bespoke widgets. |

**Result: PASS — no violations. Complexity Tracking left empty.**

Two mandated follow-ups before `/speckit-implement` (per Principles III/IV):
1. Run **`/speckit-checklist`** (crypto / zero-knowledge spec).
2. Plan for a **security review** of the at-rest wrapping, the separate-PIN
   handling, and the reveal-session lifecycle.

## Project Structure

### Documentation (this feature)

```text
specs/1019-hidden-chats-pin/
├── spec.md              # Feature spec (done)
├── plan.md              # This file
├── research.md          # Phase 0 — decisions & rationale
├── data-model.md        # Phase 1 — entities, stores, fields, lifecycle
├── quickstart.md        # Phase 1 — how to build/verify the slices
├── contracts/
│   └── internal-api.md   # Phase 1 — client-internal API surface (no wire changes)
├── checklists/
│   └── requirements.md  # Spec quality checklist (done) + crypto checklist (TODO via /speckit-checklist)
└── tasks.md             # Phase 2 — created by /speckit-tasks (NOT here)
```

### Source Code (repository root) — client only

```text
src/
├── db/
│   ├── queries.ts            # + hidden-set get/add/remove; listChats() exclusion;
│   │                         #   listCallGroups() exclusion; reset wipe+block;
│   │                         #   startHiddenChat() (createGroup wrapper)
│   ├── tombstones.ts         # + local-only "do-not-resync" block variant
│   └── types.ts              # (no synced Chat field; types for hidden-set/prefs)
├── services/
│   ├── hidden-chats.ts       # NEW — hidden-set wrap/unwrap, separate-PIN
│   │                         #   verify/enable/change/reset, block-list mgmt
│   ├── ownsync.ts            # + consult local-only block list on pull ingest
│   ├── sw-inbox.ts           # + generic notification + /tabs/chats url for hidden
│   └── crypto/               # (reused as-is: envelope, identity, senderkeys)
├── composables/
│   ├── useHiddenChats.ts     # NEW — reveal session + grace window (mirrors useAutoLock)
│   └── useCall.ts            # + generic caller identity when chat is hidden
├── components/
│   ├── ChatActionsSheet.vue  # + "Hide chat" / "Unhide" action
│   └── (reveal handling in ChatsPage)
├── views/
│   ├── tabs/ChatsPage.vue     # + PIN-in-searchbar reveal gesture; revealed list state
│   ├── tabs/CallsPage.vue     # (auto via listCallGroups exclusion)
│   └── detail/SettingDetail…  # (schema-driven; no per-screen code)
├── settings/schema.ts        # + privacy-hidden-chats screen (enable, PIN, reset, biometric, grace)
└── sw.ts                     # (uses sw-inbox changes; notificationclick already routes by url)

e2e/
└── hidden-chats.spec.ts      # NEW — hide/reveal/coexist/notif/call-log/reset
```

**Structure Decision**: Single-project client feature. New code is concentrated
in one new service (`src/services/hidden-chats.ts`) and one new composable
(`src/composables/useHiddenChats.ts`), with surgical edits to the existing choke
points identified in research (`listChats`, `listCallGroups`, `sw-inbox`,
`ownsync`/`tombstones`, `useCall`, `ChatActionsSheet`, `ChatsPage`, `schema.ts`).
No server, no new IndexedDB store.

## Complexity Tracking

> No Constitution violations — section intentionally empty.
