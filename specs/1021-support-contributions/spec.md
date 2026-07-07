# Feature Specification: Support the project (pay-what-you-want contributions)

**Feature Branch**: `feat/1021-support-contributions`

**Created**: 2026-06-27

**Status**: shipped
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "add all the publicly, freely available ways to get users to contribute to the project by paying whatever they think it is worth, to give back to the creator."

## Overview

Ring is AGPL-3.0 and runs as a free, self-hostable, zero-knowledge messenger. There is
no paywall and no plan to add one. This feature gives the people who value Ring an easy,
**pay-what-you-want** way to give back to the creator — entirely through established,
publicly-available funding platforms.

The defining constraint is the same one that shapes the rest of the app: **Ring never
touches money or financial data.** The app never collects a card, an amount, an email, or
a payer identity, and the Ring server is never involved in a contribution. Every
"contribute" affordance is an **outbound link** to a third-party platform that owns all
payment handling, compliance, and payouts. This keeps the zero-knowledge boundary intact
(nothing new crosses the client/server line) and keeps Ring out of PCI / money-transmitter
/ app-store-billing scope.

Because Ring ships as an installable PWA (not through the Apple App Store or Google Play),
linking out to external donation pages does **not** run afoul of native-store in-app-purchase
rules — there is no store cut and no policy against external payment links.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Contribute from inside the app (Priority: P1)

A user who likes Ring opens **Settings → Support Ring**, sees a short, honest explanation
that Ring is free and donations are optional, and a list of ways to contribute (GitHub
Sponsors, Ko-fi, Liberapay, etc.). They tap the one they prefer; Ring opens that platform's
**pay-what-you-want** page in the system browser, where they choose any amount and pay. They
return to Ring; nothing about the payment is stored in or known to Ring.

**Why this priority**: This is the whole feature — a discoverable, in-app way to give back.
It delivers value on its own with nothing else built.

**Independent Test**: Open Settings → Support Ring, tap each option, confirm each opens the
correct external URL (handle `zuptalo`) in a new browser context and that no Ring
network request or local write carries any payment/amount/identity data.

**Acceptance Scenarios**:

1. **Given** the user is in Settings, **When** they open "Support Ring", **Then** they see a
   list of contribution options each with a name, a one-line description, and the platform's
   pay-what-you-want nature made clear.
2. **Given** the Support Ring screen, **When** the user taps a platform, **Then** that
   platform's page opens externally (new tab / system browser), not embedded in Ring.
3. **Given** a contribution platform is opened, **When** the user completes (or abandons) a
   payment there, **Then** Ring's server receives nothing and Ring stores nothing about it.
4. **Given** the device is offline, **When** the user opens "Support Ring", **Then** the list
   still renders (it is static) and tapping a link fails gracefully (no crash).

---

### User Story 2 - Discover funding from the project's repository (Priority: P2)

A developer browsing `zuptalo/ring` on GitHub sees the native **"Sponsor"** button and the
funding options in the sidebar, and can contribute without ever installing the app.

**Why this priority**: Reaches contributors at the source (the open-source repo) with zero
in-app work; it is the canonical place open-source funding is discovered.

**Independent Test**: Add `.github/FUNDING.yml`; confirm GitHub renders the Sponsor button
linking to the configured platforms.

**Acceptance Scenarios**:

1. **Given** the repository on GitHub, **When** a visitor views it, **Then** a "Sponsor"
   button appears, populated from `.github/FUNDING.yml`.
2. **Given** the funding file, **When** it is parsed, **Then** it lists the same platforms /
   `zuptalo` handles offered in-app, so both surfaces stay consistent.

---

### User Story 3 - Share a single "support Ring" link (Priority: P3)

A supporter wants to tell a friend how to chip in. From the Support Ring screen they can
**copy or share** a link to the canonical funding page (e.g. the GitHub Sponsors page or a
links hub) without the friend needing Ring installed.

**Why this priority**: Word-of-mouth amplification; small, optional polish on top of US1.

**Independent Test**: Tap "Share"/"Copy link" on the Support Ring screen and confirm the
correct canonical URL is shared/copied.

**Acceptance Scenarios**:

1. **Given** the Support Ring screen, **When** the user taps Share, **Then** the system share
   sheet opens with the canonical support URL (falls back to copy-to-clipboard where Web
   Share is unavailable).

### Edge Cases

- A platform handle is not yet registered (e.g. the account hasn't been created): the link
  would 404 on the platform. Mitigation: only list a platform once its `zuptalo` page exists
  (configuration, not code — see Assumptions); a missing page never breaks Ring itself.
- Offline / no browser available: the static list renders; an outbound tap simply does nothing
  harmful.
- The user has App Lock on: Support Ring lives in Settings (already behind the unlock gate),
  so no additional gating is required.
- No analytics: taps are NOT tracked or reported anywhere (privacy-consistent); "did it
  convert" is observable only on the platform side, never in Ring.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Ring MUST provide an in-app "Support Ring" screen, reachable from Settings (under
  Help/About), that lists the available pay-what-you-want contribution platforms.
- **FR-002**: Each option MUST show the platform name, a one-line plain-language description, and
  make clear that any amount is welcome and contributions are optional.
- **FR-003**: Tapping an option MUST open that platform's page in an external browser context
  (new tab / system browser), never an in-app embedded payment flow.
- **FR-004**: Ring MUST NOT collect, transmit, or store any payment data, amount, payer identity,
  or contribution event — the Ring server MUST remain entirely uninvolved (zero-knowledge boundary
  preserved). No new client/server traffic is introduced by this feature.
- **FR-005**: Ring MUST NOT track or report contribution-link taps (no analytics/telemetry).
- **FR-006**: All platform links MUST use the project owner's handle `zuptalo` (or the project's
  collective slug where a platform is collective-based rather than handle-based).
- **FR-007**: The set of platforms MUST be declared in one place (a small static config) so the
  in-app list and any other surface stay in sync and adding/removing a platform is a data edit.
- **FR-008**: The repository MUST include `.github/FUNDING.yml` so GitHub renders a native Sponsor
  button listing the same platforms/handles as the in-app screen.
- **FR-009**: The Support Ring screen MUST render fully offline (static content) and degrade
  gracefully when an outbound link cannot be opened.
- **FR-010**: Users MUST be able to share/copy a canonical "support Ring" URL from the screen
  (Web Share where available, clipboard fallback).
- **FR-011**: Copy MUST be honest and non-coercive: state that Ring is free and donations are
  never required, with no dark patterns, nag timing, or guilt framing.
- **FR-012**: The feature MUST add no third-party scripts/SDKs to the app bundle (links only),
  preserving the no-third-party-tracking posture.

### Key Entities *(include if feature involves data)*

- **Support option**: a static descriptor of one contribution channel — `id`, display `name`,
  one-line `description`, `url` (built from the `zuptalo` handle), and an `icon`. Read-only; no
  persistence, no per-user state. The list is the single source of truth for both the in-app
  screen and `.github/FUNDING.yml`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can reach the Support Ring screen from the main Settings in ≤ 3 taps.
- **SC-002**: 100% of listed options open the correct external `zuptalo` page when tapped.
- **SC-003**: Zero Ring-server requests and zero local writes occur as a result of viewing the
  screen or tapping a link (verifiable by network + storage inspection) — the zero-knowledge
  boundary is provably untouched.
- **SC-004**: The GitHub repository shows a working Sponsor button sourced from `.github/FUNDING.yml`.
- **SC-005**: The app bundle gains no third-party payment/analytics SDK (bundle contains only the
  static list + outbound links).

## Candidate platforms (all free to set up; pay-what-you-want; handle `zuptalo`)

Researched 2026-06-27. All are free to create and let supporters give any amount. "Platform fee"
is what the platform itself takes; payment-processor fees (Stripe/PayPal ≈ 2.9% + 30¢) apply on
top everywhere.

| Platform | URL (handle) | Platform fee | Notes |
|---|---|---|---|
| **GitHub Sponsors** | `github.com/sponsors/zuptalo` | **0%** (GitHub covers processing) | Best fit: native to the `zuptalo/ring` repo, one-time + monthly, drives the Sponsor button. Requires Stripe-supported country + approval. |
| **Ko-fi** | `ko-fi.com/zuptalo` | **0%** on tips | Instant setup, no approval; one-time "buy a coffee" + memberships. PWYW by design. |
| **Liberapay** | `liberapay.com/zuptalo` | **0%** (non-profit) | Open-source ethos, recurring donations; only processor fees. |
| **Buy Me a Coffee** | `buymeacoffee.com/zuptalo` | 5% | Very popular, frictionless PWYW one-time + membership. |
| **Polar** | `polar.sh/zuptalo` | 5% + 50¢ (free tier) | Open-source billing, official GitHub funding partner; good for devs. |
| **Open Collective** | `opencollective.com/ring` (collective slug, not a personal handle) | 5–10% fiscal-host fee | Maximum transparency (public ledger); collective-based, so it uses a project slug rather than `zuptalo`. Optional. |
| **PayPal.Me** | `paypal.me/zuptalo` | 0% platform (PayPal processing only) | Lowest-friction direct PWYW; least "open-source"-branded. |

Recommended core set to launch with (covers 0%-fee + frictionless + open-source-native):
**GitHub Sponsors + Ko-fi + Liberapay**, with Buy Me a Coffee / Polar / PayPal.Me as
additions. `.github/FUNDING.yml` supports `github`, `ko_fi`, `liberapay`, `open_collective`,
`buy_me_a_coffee`, `polar`, and `custom` (for PayPal.Me), so all of the above can appear on
the repo Sponsor button.

## Assumptions

- The handle **`zuptalo`** is registered (or will be) on each platform the project chooses to
  list; a platform is only added to the live list once its page exists. Registration itself is a
  manual, out-of-band step by the project owner (this spec does not automate sign-ups).
- Ring is distributed as a PWA, **not** via the Apple App Store or Google Play, so external
  donation links are permitted and incur no store revenue cut.
- All payment handling, refunds, taxes, payouts, and regulatory compliance are the third-party
  platforms' responsibility; Ring is only a directory of links.
- The contribution surface is informational/optional and is **not** gated behind unlock beyond
  the existing Settings placement; no new permissions or accounts are introduced in Ring.
- Out of scope for v1: in-app payments, crypto wallet addresses, contributor perks/benefits inside
  Ring, recurring-status display, and any "supporter badge" tied to a Ring account.
