# Implementation Plan: Push Classes, Conversation Mutes & Notification Routing

**Branch**: `feat/1050-quiet-housekeeping-frames` | **Date**: 2026-07-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/1050-quiet-housekeeping-frames/spec.md`

## Summary

One wire change, evaluated inline at push time: relay frames gain a sender-set plaintext
`class` (+ optional opaque `prid`), each push subscription gains a preference blob (class
opt-outs, muted prids, per-sender post overrides), and the hub's existing
"push-unless-active-fresh" decision grows exactly one more gate. **Nothing is stored per
frame** — the push decision happens at enqueue time, so the relay queue schema is
untouched; a "held" frame is simply a frame whose tickle never fired, delivered by the
same drain paths as today. Client side: outgoing frames are tagged (per recipient for
group fan-out), conversations mint/adopt a sealed-shared prid, the existing toggles/mutes
sync into the subscription prefs, co-reactors get the "also reacted" rich note, accepts
get a rich away-note and a presence-gated tickle, and banners swipe up to dismiss.

## Technical Context

**Language/Version**: Go 1.26 stdlib server; TypeScript 5 / Vue 3 client

**Primary Dependencies**: existing stack only — `ws/hub.go` (frame handling + notifyAsync),
`push/push.go` (Notifier kinds + debouncers), `store/push.go` + a new migration,
`connections_handlers.go`/`posts_handlers.go` (kind call sites), client `useSync` (outbox
frames), `queries.ts` (send/seal paths, reaction dispatch), `push.ts` (subscription
registration), `sw-inbox.ts`/`notify.ts` (accept note, co-reactor note),
`NotificationBanners.vue` (swipe)

**Storage**: server — migration `0028_push_prefs.sql`: `ALTER TABLE push_subscriptions ADD
prefs JSONB NOT NULL DEFAULT '{}'` (full-state replace per FR-011; dies with the row).
Client — `Chat.prid` field (existing store, no DB_VERSION bump needed unless an index is
added — plain field: none), outbox rows carry class/prid.

**Testing**: Go table tests against the fake store (hub gate, prefs CRUD, per-kind gating,
old-client defaults); vitest for class computation (pure helpers), prid adopt/converge,
prefs derivation from toggles, hidden-chat exclusion guard (SC-011); e2e for fan-out
behaviors and banner swipe; real-device for push absence (spec SCs say which half is which)

**Target Platform**: single-image PWA + ringd; iOS WebKit constraints as per spec 1048

**Project Type**: full-stack (client + server + migration)

**Performance Goals**: push gate adds one prefs lookup per tickle decision (subscription
rows are already fetched to push); prefs registration piggybacks the existing
subscription upsert cadence

**Constraints**: zero-knowledge ledger fixed by the spec (class, prid, prefs — nothing
more); interop with tag-less clients (FR-006); hidden chats structurally absent (FR-008c);
mention pierce = 1020/1048 parity (FR-008b); relay delivery semantics byte-identical
(FR-007)

**Scale/Scope**: ~6 server files + 1 migration; ~8 client files; 3 e2e specs; the checklist
gate (checklists/zk.md) is green as of f7c92a4

## Constitution Check

| Principle | Verdict | Notes |
|---|---|---|
| I. Zero-Knowledge | ✅ PASS (gated) | The ledger is spec'd, user-approved, and checklist-audited (zk.md 25/25). Payloads stay sealed; new plaintext = class, prid, prefs exactly. |
| II. Spec-Driven | ✅ PASS | 1050 clarified ×3 sessions; checklist REQUIRED and run; this plan; tasks/analyze/issues next. |
| III. TDD | ✅ PASS (plan) | Server gate + prefs land red-first against the fake store; client pure helpers red-first; hotfix rule n/a (feature). |
| IV. Crypto | ✅ PASS | prid is random bytes minted client-side, shared INSIDE sealed payloads; no new crypto, `messaging.ts` untouched beyond passing an opaque field in the payload it already seals. |
| V. Offline-First | ✅ PASS | Chat.prid via existing idb wrapper; held frames use existing drain; no store reshape. |
| VI. Stateless Server | ✅ PASS | One forward-only migration (0028); prefs live in Postgres with the subscription row. |
| VII. Quality Gates | ✅ PASS (plan) | Full client+server gates + e2e where behavior changed. |
| VIII. Traceable | ✅ PASS | taskstoissues + Closes #N. |
| IX. Data Minimization | ✅ PASS | Prefs are full-state-replace, die with the subscription (FR-011); no telemetry. |
| X/XI. A11y & Ionic-First | ✅ PASS | Swipe-dismiss keeps an SR-accessible dismissal (FR-010); the one new control (per-friend post alerts) is a schema data edit + existing contact surface. |

**Post-design re-check**: clean. Complexity Tracking stays empty — every piece rides an
existing mechanism (frame fields, subscription upsert, payload passthrough, banner gesture
zone).

## Project Structure

### Documentation (this feature)

```text
specs/1050-quiet-housekeeping-frames/
├── spec.md, plan.md, research.md, data-model.md, quickstart.md
├── contracts/push-routing.md      # the decision table + wire/API shapes
├── checklists/{requirements,zk}.md
└── tasks.md                       # /speckit-tasks output
```

### Source Code (repository root)

```text
server/internal/
├── db/migrations/0028_push_prefs.sql   # prefs JSONB on push_subscriptions
├── store/push.go                       # prefs read/replace with the subscription row
├── push/push.go                        # Notify gains (class, prid, sender) context;
│                                       #   per-subscription gate; NotifyPost(author)
├── ws/hub.go                           # frame {class, prid} fields; msg case passes
│                                       #   them to the gated notifyAsync
└── api/{router,push_handlers,connections_handlers,posts_handlers}.go
                                        # prefs endpoint; wakeConn presence-gated;
                                        #   NotifyPost carries author

src/
├── services/push.ts                    # prefs derivation (toggles+mutes+overrides,
│                                       #   HIDDEN EXCLUDED) + registration w/ replace
├── services/push-prefs.ts (new)        # pure: derive prefs from settings/chats state
├── db/queries.ts                       # class per send-site (reaction fan-out per
│                                       #   recipient, create cards housekeeping,
│                                       #   mention class per recipient); prid mint/
│                                       #   adopt; co-reactor notify; sealAndEnqueue*
│                                       #   carry class/prid per member
├── composables/useSync.ts              # outbox frame fields on the wire
├── services/crypto/message.ts          # MessagePayload.prid (sealed share; opaque)
├── services/sw-inbox.ts + notify.ts    # accept rich note; "also reacted" wording
├── components/NotificationBanners.vue  # swipe-up dismiss; ✕ → SR-only
└── settings/schema.ts                  # per-friend "Notify me about new posts" control

e2e/
├── push-routing.spec.ts (new)          # fan-out matrix via server-visible effects
├── mentions.spec.ts / reaction-notify.spec.ts   # extended for pierce + co-reactor
└── notifications-inapp.spec.ts         # swipe dismiss
```

**Structure Decision**: standard monorepo split; the only new files are the migration, a
pure client prefs-derivation module (testable without IndexedDB), and one e2e spec.

## Architecture decisions

1. **Gate at enqueue, store nothing per frame.** `case "msg"` already decides
   push-vs-not inline (hub.go:1256-1270); class/prid ride the WS frame and feed that
   decision, then are discarded. Relay schema untouched ⇒ FR-007 holds by construction.
   The debounced `Notifier.Notify` gains context: `Notify(ctx, userID, class, prid)`;
   per-subscription prefs are checked where subscriptions are already loaded to send.
2. **Classes are computed at the send site, per recipient**: reactions — author
   `reaction`, prior co-reactors `reaction`, everyone else `housekeeping`; removals —
   `housekeeping` to all; mentions/replies-to-recipient — `mention` for exactly that
   recipient (sender already computes mentions + reply target per 1048); group create
   cards — `housekeeping`; everything else defaults `message`. Pure helper in queries.ts,
   unit-tested.
3. **prid**: 16 random bytes (base64url), minted by the first up-to-date sender in a
   conversation, carried INSIDE the sealed `MessagePayload.prid` (adopt-on-receive:
   store on the chat if absent; on conflict adopt the lexicographically smaller and
   re-register prefs) AND in plaintext on the frame. Hidden chats: never minted into
   prefs; the frame still carries prid (peers aren't hidden-aware) — exclusion applies
   to the recipient's OWN pref registration only.
4. **Prefs derivation is a pure function** of (settings snapshot, chats snapshot minus
   hidden set, wall per-person mutes, per-friend post alerts): `{classesOff:[],
   mutedPrids:[], postSenders:{muted:[],always:[]}}` — full-state replace, POSTed on
   subscription upsert and on any relevant change (settings bus + chat mute writes),
   debounced. SC-011 guard test asserts hidden chats can't reach it.
5. **Connection tickles get presence-gated** (`wakeConn` consults the hub like messages
   do) — that alone fixes "push while I'm in the app"; the SW's conn wake composes the
   rich accepted note from /v1/connections state it already fetches.
6. **Posts**: `NotifyPost(recipient, author)` so the per-subscription gate can apply
   post-class + per-sender overrides; the new per-friend control writes the `always`
   override that beats a global post opt-out.
7. **Banner swipe** reuses the existing pointer-gesture zone pattern (nb-grab) extended
   to the collapsed banner body: swipe-up = dismiss; reply-mode keeps its discard
   meaning; ✕ becomes a visually-hidden but SR-focusable dismiss button (a11y).
8. **Interop**: absent class ⇒ `message`; absent prefs ⇒ `{}` ⇒ push everything (old
   server column default). No flags, no windows.

## Complexity Tracking

> No constitution violations — table intentionally empty.
