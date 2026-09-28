# Patched fork of golang.org/x/crypto

See `README.md` in this directory for the original upstream module README.

Full copy of `golang.org/x/crypto@v0.57.0` (rebased 2026-09-28, spec 1067 Track C4 — was
`v0.53.0`), with one targeted fix in `acme/autocert/autocert.go`, wired in via a `replace`
directive:

```
replace golang.org/x/crypto => ../patches/x-crypto
```

## The bug

`(*Manager).verifyRFC`'s retry loop shares a single `nextTyp` challenge-type index across every
`AuthorizeOrder` retry within one call, instead of resetting it per order. That's fine when
multiple challenge types are configured (http-01 + tls-alpn-01): if type A fails, move on to
type B on the same order, and don't waste time retrying A on a *later* order either, since the
code's own comment assumes "if we've tried a challenge type once and it didn't work, it will
most likely not work on another order's authorization either."

ring only configures **tls-alpn-01** (no `HTTPHandler`, so no http-01 fallback -
`server/cmd/ringd/main.go`'s `newCertManager`). With exactly one challenge type, that assumption
means: the first order's first (and only) attempt fails for any reason - a transient blip, a slow
validator, anything - `nextTyp` becomes 1, and **every subsequent order retry in the same call
fails instantly** with `"unable to satisfy ...: no viable challenge type found"`, regardless of
what the CA actually offers on the new order. This reproduced reliably against Let's Encrypt
production for `ring.zuptalo.com` while diagnosing a Ring instance on Oracle Cloud (2026-09-28);
confirmed independently that Let's Encrypt was offering tls-alpn-01 normally the whole time via a
throwaway ACME account/order outside ring's own account.

## The fix

Move `nextTyp := 0` from once above the loop to once per iteration, right after
`AuthorizeOrder`. Each fresh order now gets a fresh, full pass over `challengeTypes` again. This
preserves the original intent for the *within-one-order, multiple domains* case (unaffected: a
fresh `nextTyp` still walks forward across that order's own authorizations) and only changes the
across-orders case that was actually causing failures.

## Maintenance

When bumping `golang.org/x/crypto` in `server/go.mod`, re-diff this fork against the new upstream
version's `acme/autocert/autocert.go` (`verifyRFC`) and re-apply the same one-hunk change, or drop
this patch entirely if upstream has fixed the underlying issue by then (checked 2026-09-28 up to
v0.57.0: still present).

**2026-09-28 rebase (spec 1067 Track C4)**: rebased from `v0.53.0` to `v0.57.0`. The whole tree
was replaced with a pristine `v0.57.0` checkout and the single `nextTyp` hunk re-applied by hand;
`diff -rq` against the pristine `v0.57.0` module cache confirms the only remaining differences are
this file and the one intended hunk in `autocert.go`. The bug is still present in `v0.57.0`
(confirmed by re-reading `verifyRFC` before re-patching) — not yet fixed upstream. Submitting the
fix upstream (`go-review.googlesource.com`) remains an optional stretch goal, not done here.
