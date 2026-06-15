#!/usr/bin/env bash
#
# Emit this build's release notes as JSON: [{ "sha", "subject" }] for the
# Conventional-Commit changes since the last release tag (vX.Y.Z), newest-first,
# merge commits excluded. Consumed at build time (see Dockerfile + ci.yml/release.yml)
# and baked into BOTH the client (__RELEASE_NOTES__) and the server (/v1/config), so
# the PWA can show a per-user "what's new". Prints "[]" when there's nothing.
#
# Subject is the RAW Conventional-Commit subject; the client prettifies it for display
# (src/services/release-notes.ts). SHA is the short hash — the stable identity the
# client uses to diff the incoming build's notes against the running build's.
set -euo pipefail

# Bound the payload so a build never carries an unbounded changelog (the client only
# ever shows the per-user delta anyway). Generous for a normal release.
MAX=50

# Base = the highest existing vX.Y.Z release tag; if none yet, fall back to the most
# recent MAX commits.
last_tag=$(git tag --list 'v[0-9]*.[0-9]*.[0-9]*' --sort=-v:refname 2>/dev/null | head -1 || true)
range="HEAD"
[ -n "$last_tag" ] && range="${last_tag}..HEAD"

# Tab (%x09) separates sha from subject; subjects can contain tabs only in pathological
# cases, so take the FIRST field as sha and the REST as subject to be safe.
raw=$(git log "$range" --no-merges --max-count="$MAX" --format='%h%x09%s' 2>/dev/null || true)

if command -v jq >/dev/null 2>&1; then
  printf '%s\n' "$raw" | jq -c -R -s '
    split("\n")
    | map(select(length > 0))
    | map(. as $line | ($line | index("\t")) as $i
        | { sha: $line[0:$i], subject: $line[($i + 1):] })'
elif command -v python3 >/dev/null 2>&1; then
  printf '%s' "$raw" | python3 -c '
import json, sys
out = []
for line in sys.stdin.read().splitlines():
    if not line:
        continue
    sha, _, subject = line.partition("\t")
    out.append({"sha": sha, "subject": subject})
print(json.dumps(out, separators=(",", ":")))'
else
  echo "[]"
fi
