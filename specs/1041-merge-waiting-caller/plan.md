# Implementation Plan: Merge a Waiting Caller into the Ongoing Call

**Branch**: `feat/1041-merge-waiting-caller` | **Date**: 2026-07-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/1041-merge-waiting-caller/spec.md`

## Summary

The merge machinery already shipped (spec 1028 `joinroom` promotion, spec 1030
add-to-call, the second-incoming "Add to call" button, capacity gates, e2e
coverage) — but it auto-joins the waiting caller with **no consent**: the
sealed `joinroom` signal converts their outgoing attempt straight into the
mesh room (`useCall.ts:3457-3461`). This feature adds the consent layer the
spec demands and nothing more wire-wise: three new inner signal types
(`joinreq` / `joinreq-accept` / `joinreq-reject`, plus `joinreq-cancel` for
withdrawal) riding the existing sealed-inside-`call-ice` channel, a consent
prompt on the waiting caller's screen (join with the media of their OWN
attempt — clarification A), rejection-final-per-call bookkeeping on the
callee, a "bring into this call" action for an already-held party, and reuse
of every existing timeout so an ignored attempt still ends in "No answer".
Separately, the call-tile avatar ellipse is fixed at its root: `.tile-avatar`
overrides only `width`, so `UserAvatar`'s internal `height:100%` survives and
defeats `aspect-ratio:1` — one `height:auto` declaration restores the circle.

## Technical Context

**Language/Version**: TypeScript 5 (Vue 3 `<script setup>` + Ionic 8),
client-only change (`server/` untouched — the server's `JoinIfRoom` gates on
capacity only and needs no knowledge of consent)

**Primary Dependencies**: existing sealed call signalling
(`sendSealedSignal('call-ice', …)` inner-type dispatch, `signalling.ts` /
`useCall.ts:3423-3482`), promotion/merge machinery (`ensureActiveIsRoom`,
`convertActiveToRoom`, `MeshSession`, `withAddInFlight`), call-waiting state
(`incomingSecond`, `heldCall`/`heldSlot`), capacity (`canAdd`/
`remainingSlots`), `CallActivePage.vue` prompt/held-bar UI, `UserAvatar.vue`

**Storage**: none new — rejection blocks are in-memory per call; no
IndexedDB change, no `DB_VERSION` bump

**Testing**: vitest for a new pure decision module (request lifecycle +
rejection-block rules); Playwright e2e extending the existing
`call-merge*.spec.ts` family (consent prompt accept/reject/withdraw paths,
no-answer invariant); visual assertion of avatar roundness via bounding-box
measurement in an existing call e2e

**Target Platform**: installable PWA — Chrome/Android, Safari/iOS (WebKit
single-getUserMedia constraint honored by reusing the accepter's capture)

**Project Type**: web app (client of the monorepo)

**Performance Goals**: request→prompt latency = one sealed signal hop (same
as hold/resume today); accept→merged uses the existing join path (SC-002's
10s bound is generous)

**Constraints**: zero-knowledge boundary (no new frame types visible to the
server — spec's Zero-Knowledge Impact section); capture consent (accepting
never enables media the caller didn't offer — clarification A); WebKit
no-second-getUserMedia (reuse the attempt's captured stream); call-waiting
semantics of specs 0005/2009 unchanged for reject/hold/swap

**Scale/Scope**: ~5 client files (`crypto/message.ts` type union,
`call/signalling.ts` senders, `useCall.ts` request flow + dispatch + blocks,
`CallActivePage.vue` prompt/held-bar/avatar CSS, `call/join-request.ts` NEW
pure module) + testhook additions + vitest + e2e

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Zero-Knowledge Boundary** — PASS. Spec carries the Zero-Knowledge
  Impact section. The four new inner types are sealed inside existing
  `call-ice` frames (the established hold/resume/qos/joinroom trick); the
  server relays opaque bytes and learns nothing new. No server change at all.
- **II. Spec-Driven Development** — PASS. Spec 1041 (ad-hoc band), pipeline:
  specify → clarify (1 Q) → plan → tasks → analyze → taskstoissues →
  implement.
- **III. Test-Driven Development** — PASS (planned). New pure module
  (request/block decision rules) lands vitest-first; consent/reject/withdraw
  flows land as failing e2e first; the avatar fix gets a failing roundness
  assertion first (it reproduces today).
- **IV. Crypto Discipline** — PASS, checklist not mandated: no new sealing
  code, no ratchet change, no new payload SURFACE class — four more values in
  the existing `CallSignal.type` union opened by unchanged code, exactly like
  spec 1028's `joinroom` and spec 1039 (which skipped `/speckit-checklist` on
  the same reasoning). The spec's ZK Impact section covers the boundary
  review.
- **V. Offline-First Data Integrity** — PASS. No persisted state; call-log
  behavior rides existing paths (an accepted merge ends the 1:1 attempt
  without a missed record — the live paths + spec 1040 markers already
  encode "handled").
- **VI. Stateless Server & Forward-Only Migrations** — PASS (server
  untouched).
- **VII. Quality Gates** — PASS (planned): `npm run build`, vitest, go gates
  (unchanged but run), e2e for the changed behavior.
- **VIII. Traceability** — PASS: branch `feat/1041-…`, issues via
  taskstoissues, PR lists `Closes #N`.
- **IX. Privacy & Data Minimization** — PASS. The request carries roomId +
  kind only; names resolve on-device.
- **X–XI. A11y & Ionic-First** — PASS. The consent prompt reuses the existing
  `cw-prompt` alertdialog idiom and stock buttons; the held-bar action
  extends the existing bar; no bespoke widget. Copy follows the app voice.

## Project Structure

### Documentation (this feature)

```text
specs/1041-merge-waiting-caller/
├── spec.md
├── plan.md              # This file
├── research.md          # Phase 0 (R1–R8)
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   └── join-request.md  # sealed joinreq/accept/reject/cancel contract
├── checklists/
│   └── requirements.md
├── avatar-stretch.png   # user's bug screenshot (US4)
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── services/
│   ├── crypto/message.ts          # CallSignal.type union: + joinreq/-accept/-reject/-cancel
│   ├── call/signalling.ts         # sendJoinRequest / sendJoinRequestReply / sendJoinRequestCancel
│   └── call/join-request.ts       # NEW pure module: request lifecycle + rejection-block rules
├── composables/
│   └── useCall.ts                 # merge entry points send joinreq (not bare joinroom);
│                                  # call-ice dispatch branches; accepter prompt state;
│                                  # rejection blocks; teardown withdrawal; held-bar merge
├── views/detail/
│   └── CallActivePage.vue         # accepter consent prompt; held-bar "bring into call";
│                                  # merge buttons honor the rejection block; .tile-avatar height:auto
└── services/testhook.ts           # hooks: joinRequestVisible/acceptJoinRequest/rejectJoinRequest…

src/services/call/join-request.test.ts   # vitest (pure rules)
e2e/call-merge-consent.spec.ts           # accept / reject-final / withdraw / no-answer invariant
e2e/… (avatar roundness assertion in an existing call spec)
```

**Structure Decision**: single web-app monorepo as-is; one new pure module
(`call/join-request.ts`) mirroring the glare/invite-plan/capacity convention
of pure, vitest-covered call policy modules.

## Complexity Tracking

No constitution violations to justify. Compatibility note: old receivers
ignore unknown inner signal types, so a request to an old client silently
degrades to today's behavior (their attempt keeps ringing; the callee's
request expires with the attempt) — the spec's stated degrade. Old CALLEES
still send bare `joinroom` merges (pre-consent) until updated; the new
receiver closes the consent hole for those too by gating on its OWN state:
a `joinroom` while connected in the call with that peer is the legitimate
promote (auto-follow, as today), but a `joinroom` while still DIALING that
peer raises the same consent prompt and converts only on accept. An old
sender that assumed the auto-join may briefly show a stale merge state if
the user declines — a rare transitional blemish, deliberately preferred over
honoring a consentless join (documented in the contract).
