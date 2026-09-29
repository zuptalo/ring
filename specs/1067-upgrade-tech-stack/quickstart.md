# Quickstart: verifying the tech stack uplift

No new feature to click through — this is a verification runbook per phase.
Run the relevant block after that phase's dependency bumps land, before opening
the PR.

## Phase A (safe bumps)

```sh
npm run build                                   # typecheck + build, must be unchanged behaviorally
cd server && go build ./... && go vet ./... && go test ./...
cd .. && npm run test:e2e                       # only if it touched anything e2e-observable; usually optional for Phase A
```

Confirm `gorilla/websocket` and `webpush-go` are recorded as already-latest (no
diff expected for these two).

## Phase B (moderate: vue-tsc, vitest, vue, Node)

```sh
npm run build                                   # vue-tsc/typescript peer pairing verified here
npm run test:unit                               # coverage floors must hold, not just pass
```

Then confirm the Node target lines up everywhere it's pinned:

```sh
grep -n "node-version" .github/workflows/*.yml
grep -n "^FROM.*node:" Dockerfile
grep -n '"@types/node"' package.json
```

All three should agree on the same major (24).

## Phase C (coordinated/high-risk)

**Ionic 9 + Vue Router 5**

```sh
npx @ionic/migrate                              # apply/verify the automated migration steps
# Audit against Ionic's REAL v9 BREAKING.md (github.com/ionic-team/ionic-framework/
# blob/main/BREAKING.md) — don't trust a secondhand summary. Confirmed real items to check:
grep -rn 'autocorrect="on"\|autocorrect="off"' src --include="*.vue"      # boolean-coercion bug
grep -rln "ion-picker-legacy\|pickerController\|PickerOptions" src       # removed entirely
grep -rln "<ion-nav\b\|ion-nav-link" src --include="*.vue"                # no longer router-driven
grep -rln "swipeBackEnabled\|swipeGesture" src --include="*.vue" --include="*.ts"
grep -rln "ion-select\b" src --include="*.vue"                            # ionChange semantics changed
grep -rln "label-placement=\"floating\"" src --include="*.vue"           # floating-label behavior changed
npm run build && npm run test:e2e
```

Manually click through Chats, Calls, Contacts, and Settings tabs plus any screen
touched by the audit above.

**Vite major bump**

```sh
npm ls vite vite-plugin-pwa @vitejs/plugin-vue   # confirm no peer-dependency conflict resolved
npm run build                                    # inspect dist/ output for the expected service worker + manifest
npm run test:e2e
```

If `vite-plugin-pwa`'s Babel-7 chain still conflicts with Vite 8's Babel 8, stop
at Vite 7.3.x for this spec (see spec Edge Cases) rather than forcing 8.

**`libsodium-wrappers-sumo`**

```sh
npm run test:unit -- --grep crypto               # or however the crypto suite is filtered
```

Forgery, replay, out-of-order, and skipped-key cases must all still pass. Then
manually confirm on a device with existing local data that the app still unlocks
with the existing PIN and existing chats/sessions remain readable (no wire-format
or key-derivation change) before requesting the security review sign-off.

**Pion/TURN group**

```sh
cd server && go test ./... 
```

Then, per `server/docs/CALLING.md`: place one real-device call over a network
where direct P2P is expected to succeed, and one over a network where only the
TURN relay path is viable (e.g. symmetric NAT or a network known to block direct
UDP). Both must connect with audio/video flowing.

## Definition-of-done check (all phases)

- `npm run build` — pass
- `go build ./... && go vet ./... && go test ./...` — pass
- `npm run test:unit` — pass, coverage floors held
- `npm run test:e2e` — pass
- Phase C manual/real-device steps above — pass, signed off before merge
