# Phase 0 Research: Friends-only messaging & settings refinements

## R1 — Will a friends-only message gate break group calls between non-mutual contacts?

**Decision**: No. Place the gate on the direct-message receive path only; leave call signalling
untouched. This is safe because the two are already separate inbound paths.

**Rationale**:
- Inbound WebSocket frames are dispatched by type in `src/services/sync.ts::handleIncomingFrame`:
  `'msg'` → `receiveIncoming` → `handleIncoming` (the gated path); `call-offer/answer/ice/...` →
  `useCall.handleCallFrame` (a separate path).
- Group calls mesh between every pair of participants. Two co-invitees who are not each other's
  contacts have no 1:1 ratchet, so `src/services/call/signalling.ts::meshSessionChatId` bootstraps an
  **ephemeral, call-scoped** Double-Ratchet session (`callsess:` prefix) with no contact row and no
  chat-list entry, torn down when the call ends. The server permits the prekey fetch only for the
  shared call room.
- Therefore call setup never flows through `handleIncoming`, and a message gate there cannot drop it.

**Alternatives considered**:
- Gate at a shared choke point below both paths → rejected: would drop call signalling for
  non-contacts and break the documented mesh behavior.
- Server-side enforcement → impossible under the zero-knowledge boundary (the server can't read who
  is whose contact) and rejected on principle.

**Evidence**: `sync.ts:123` (`'msg'`), `sync.ts:133-155` (`call-*` → `handleCallFrame`),
`signalling.ts:22-45` (ephemeral `callsess:` sessions), `queries.ts` `handleIncoming` gate.

## R2 — Is the removed "Block unknown" toggle truly redundant?

**Decision**: Yes. Making its behavior the unconditional default removes the toggle without losing a
capability.

**Rationale**: The toggle only ever wrapped exactly the check we now always run
(`!getContact(from) && !isPeerConnected(from) → drop`). With friends-only as the default, the toggle
would be a permanent no-op if left in place.

**Alternatives considered**: Keep the toggle defaulted-on → rejected as confusing dead UI.

## R3 — Is "Disable link previews" actually wired before we promote it?

**Decision**: Yes — it is safe to surface on the Privacy page.

**Rationale**: `src/db/queries.ts` gates preview generation on
`getSetting('privacy.disableLinkPreviews')` before calling `attachLinkPreview` (the sender's device
builds previews; when the setting is on, none are built). Confirmed wired end-to-end.

## R4 — How should Help how-tos be built given Ionic-First (Principle XI)?

**Decision**: Author each guide as a schema node of static `note` items in
`src/settings/schema.ts`, linked from the Help node and rendered by the existing
`SettingDetailPage.vue`. No new component.

**Rationale**: The settings tree is the sanctioned way to add screens (data edit, not code). `note`
items already render as wrapped paragraphs; `link` items already navigate to nodes by id, and the
flat settings search index picks up the new topics for free.

**Alternatives considered**: A bespoke Help/article Vue component → rejected under Principle XI (would
be new non-Ionic UI for content the schema renders natively).

## R5 — Root cause of the broken-image "?" emoji

**Decision**: In `Emoji.vue`, only take the "retry without the FE0F variation selector" step when the
emoji actually contains an FE0F; otherwise skip straight to the native glyph.

**Rationale**: For an emoji with no FE0F, dropping FE0F yields an identical image URL, so the browser
never refetches, the second `error` never fires, the attempt counter sticks below the native-fallback
threshold, and the broken-image placeholder stays forever. Guarding the retry on the presence of a
variation selector guarantees the native-glyph fallback is always reached.

## Open questions

None. All Technical Context items are resolved; the retroactive implementation confirms each decision.
