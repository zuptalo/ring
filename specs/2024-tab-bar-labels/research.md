# Research: Tab Bar Labels Stay Visible After Switching Tabs

**Spec**: [spec.md](./spec.md) · **Date**: 2026-07-10

Phase 0 was performed live before the spec, with the drive harness against
the running dev stack (`drive/scenarios/tab-labels-vanish.mjs` +
`tab-props-probe.mjs`); this consolidates the evidence and decisions.

## D1. Root cause: Vue class patching clobbers Stencil-managed host classes

**Decision**: Treat the dynamic `:class` binding on `ion-tab-button` as the
defect class, not the specific class name. Evidence (DOM dumps): initial
button `class="md tab-has-label tab-has-icon tab-layout-icon-top
ion-activatable ion-selectable ion-focusable hydrated"` with label height
12px; after one tab switch the two buttons whose binding value changed read
`class="tab-on tab-selected"` / `class=""` with label height 0px (label still
`display:block; visibility:visible; opacity:1` — the collapse is the loss of
the component's internal sizing rules keyed on `md`/`tab-has-label`/
`tab-layout-icon-top`). Vue's `patchClass` assigns `el.className` wholesale;
Stencil applies host classes through its own vdom diff, so once wiped it
never re-adds classes it believes are present (only `tab-selected` came back,
because that specific value changed in Stencil's diff at that moment).

**Rationale for the fix mechanism (`data-on` attribute)**: Vue patches
`data-*` keys with `setAttribute`/`removeAttribute` — a channel neither Vue's
class patching nor Stencil's host-class management ever touches. CSS
attribute selectors (`ion-tab-button[data-on] ion-icon`) have identical
specificity behavior to the class selector they replace.

**Alternatives considered**:
- *Wrapper element around the icon to carry the class*: breaks Ionic's
  shadow `::slotted(ion-icon)` layout (the icon must be a direct slotted
  child) — rejected.
- *Ionic's own `.tab-selected` class as the style hook*: requires Ionic's
  selection machinery to be truthful, which it is not here (see D2) —
  rejected.
- *Static class + manual classList manipulation from a watcher*: works but
  is imperative DOM fiddling Vue may still clobber on unrelated re-renders
  of the same element's class prop; strictly worse than an attribute —
  rejected.
- *Upgrading/patching @ionic/vue or Vue*: out of proportion for a hotfix;
  the attribute mechanism is the documented community practice for
  web-component + Vue class coexistence — rejected.

## D2. US2 (truthful selection at load): DEFER, with evidence

**Decision**: Defer. No clobber-safe, race-free mechanism exists with the
current @ionic/vue wrapper and the app's deliberate no-`href` tab model.

**Evidence** (read from `node_modules/@ionic/vue/dist/index.js`, v8.8.8):
- `IonTabBar`'s Vue wrapper renders `h("ion-tab-bar", { ref: "ionTabBar" })`
  and **imperatively** assigns `tabBar.selectedTab` in `tabSwitch()`, called
  from `mounted()` and from a `registerHistoryChangeListener` callback on
  every route change.
- Its active-tab matching (`checkActiveTab` → `matchesTab`) is **`href`
  based**: `matchesTab(pathname, href)` returns false when `href` is
  `undefined`. Ring's tab buttons deliberately carry no `href` (flat-history
  `switchTab` with root/replace, see TabsPage.vue comments), so
  `activeTab` resolves to `undefined` → `tabSwitch` hits the no-active-child
  arm → `tabBar.selectedTab = ""`.
- Core `ion-tab-bar` then emits `ionTabBarChanged` and every core
  `ion-tab-button` sets `selected = (tab === "")` = false — overwriting the
  app's `:selected` binding. Probe confirmed: at mount every button reports
  `selected === false` (including the active one bound `true`); after the
  first click the Vue binding change propagates and selection becomes
  correct from then on.
- Every candidate fix is one of: (a) give buttons `href`s so the wrapper's
  matching works — but that re-enables the wrapper's own click routing
  (`ionRouter.changeTab`) alongside `switchTab`, risking the tuned
  transition semantics (explicitly out of scope, FR-005/FR-007); (b) write
  `selectedTab`/`selected` ourselves post-mount — a timing race against the
  wrapper's history listener and the lazy-hydrating core (two writers, no
  ordering guarantee); (c) bind `aria-selected` directly — Stencil's own
  render also writes/removes that attribute from its `selected` prop, two
  writers again.

**Consequence**: `aria-selected` reads false on all tabs from load until the
first tab switch (pre-existing behavior, unchanged by this fix). Recorded in
spec.md as the FR-004 deferral; a future spec could revisit by adopting
href-based tabs wholesale.

## D3. Regression-test strategy: e2e, red-first

**Decision**: New `e2e/tab-labels.spec.ts` (this defect is fully
Playwright-drivable, so the constitution's e2e clause is satisfied directly,
and red-first is observed for the hotfix band). Assert after each tab click:
all five buttons still render their label text with height > 0, and exactly
one button carries the `data-on` marker. No unit-test surface exists — the
defect is emergent from Vue↔Stencil interaction on a template; there is no
pure function to extract (unlike specs 1034/2023).

**Alternatives considered**: drive-scenario-only verification (rejected —
drive is interactive, not CI); a vitest component test with Ionic stubs
(rejected — stubbing Ionic's web components removes the exact interaction
under test).

## D4. Known wart kept out of scope

`[ion-tabs] - Tab with id: "undefined" does not exist` logs on every tab
tap: the @ionic/vue `IonTabButton` wrapper's internal click handler runs its
own tab-routing path in parallel with the app's `switchTab`. Pre-existing
(predates PR #552), console-only. Fixing it means touching the click/routing
path this hotfix must not destabilize. Recorded in spec Edge Cases (FR-007)
and in the TabsPage.vue comment so it isn't re-diagnosed.
