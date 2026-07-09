# Quickstart: verifying spec 2024

**Spec**: [spec.md](./spec.md) · **Date**: 2026-07-10

## Red → Green (the CI gate)

```sh
# RED: on the un-fixed tree the new spec must fail
npx playwright test e2e/tab-labels.spec.ts   # needs `make db-up` (or the dev stack's postgres)

# GREEN after the TabsPage.vue fix
npx playwright test e2e/tab-labels.spec.ts
npm run build                                 # vue-tsc typecheck + vite build
npx vitest run                                # full unit suite (unaffected, must stay green)
```

## Interactive verification (dev stack)

```sh
make start                                    # if not already running
node drive/scenarios/tab-labels-vanish.mjs    # walks all tabs, screenshots each state
```

Read `.tmp/drive/tabs-after-*.png`: every screenshot must show all five
labels at full size, the circular highlight on exactly the clicked tab, and
no ghost artifacts near the bar. The stdout DOM dumps must show every button
keeping `md tab-has-label tab-has-icon tab-layout-icon-top … hydrated`
classes after every click (plus `data-on` only on the active one).

## Visual parity check

Compare `.tmp/drive/tabs-initial.png` (highlight on Chats) against the same
screenshot from before the fix — tint circle, icon fill, label size and
positions must be indistinguishable.
