#!/usr/bin/env python3
"""Generate (or verify) ROADMAP.md from the specs/ directory.

ROADMAP.md is a derived artifact: it is regenerated from the specs themselves so
the roadmap can never silently drift from what is actually checked in. Each spec
contributes one row, placed into a category section by its directory number and
labelled with the Status line from its spec.md.

Source of truth, per spec:
  - id + category : the directory number (0001+ planned, 1001+ ad-hoc, 2001+
                    hotfix). Derived from the path, so /speckit-specify can never
                    clobber it when it rewrites spec.md.
  - title         : the `# Feature Specification: <title>` heading in spec.md.
  - status        : the `**Status**: <value>` line in spec.md
                    (planned | in-progress | in-review | shipped).

Usage:
  scripts/roadmap-gen.py            # rewrite ROADMAP.md in place
  scripts/roadmap-gen.py --check    # exit 1 if ROADMAP.md is missing or stale
                                     # (used by CI; never writes)
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SPECS_DIR = REPO_ROOT / "specs"
ROADMAP = REPO_ROOT / "ROADMAP.md"

# Directory numbers carry the category. Bands are closed so the number alone is
# unambiguous; see .specify/scripts/bash/create-new-feature.sh (band_range).
BANDS = [
    ("planned", "📌 Planned Features", "0001–0999", 1, 999),
    ("adhoc", "⚡ Ad-hoc", "1001–1999", 1001, 1999),
    ("hotfix", "🐛 Hotfixes & Bug Fixes", "2001+", 2001, 9_999_999),
]

STATUS_BADGES = {
    "planned": "⚪ planned",
    "in-progress": "🟡 in-progress",
    "in-review": "🔵 in-review",
    "shipped": "🟢 shipped",
}
DEFAULT_STATUS = "planned"

DIR_RE = re.compile(r"^(\d{3,})-(.+)$")
TIMESTAMP_RE = re.compile(r"^\d{8}-\d{6}-")
TITLE_RE = re.compile(r"^#\s+Feature Specification:\s*(.+?)\s*$", re.MULTILINE)
H1_RE = re.compile(r"^#\s+(.+?)\s*$", re.MULTILINE)
STATUS_RE = re.compile(r"^\*\*Status\*\*:\s*(.+?)\s*$", re.MULTILINE)

HEADER = (
    "<!-- GENERATED FILE — do not edit by hand.\n"
    "     Regenerate with: make roadmap   (or python3 scripts/roadmap-gen.py)\n"
    "     Source of truth: specs/<NNNN-slug>/spec.md (Status line + directory number).\n"
    "     CI fails if this file is out of date. -->\n\n"
    "# Ring Roadmap\n\n"
    "Every change ships through a numbered spec (see [CONTRIBUTING.md](CONTRIBUTING.md)).\n"
    "Specs are grouped by category band; status moves\n"
    "`planned → in-progress → in-review → shipped`.\n"
)


def humanize(slug: str) -> str:
    return slug.replace("-", " ").strip().capitalize()


def band_for(number: int) -> str | None:
    for key, _title, _range, lo, hi in BANDS:
        if lo <= number <= hi:
            return key
    return None  # 1000 / 2000 gutters are intentionally unassigned


def discover_specs() -> dict[str, list[dict]]:
    """Return {band_key: [spec, ...]} sorted by id within each band."""
    by_band: dict[str, list[dict]] = {key: [] for key, *_ in BANDS}
    if not SPECS_DIR.is_dir():
        return by_band

    for child in sorted(SPECS_DIR.iterdir()):
        if not child.is_dir():
            continue
        name = child.name
        if TIMESTAMP_RE.match(name):
            continue
        m = DIR_RE.match(name)
        if not m:
            continue
        number = int(m.group(1))
        slug = m.group(2)
        band = band_for(number)
        if band is None:
            print(
                f"warning: spec '{name}' (#{number}) falls in a band gutter; skipping",
                file=sys.stderr,
            )
            continue

        spec_md = child / "spec.md"
        title, status = "", DEFAULT_STATUS
        if spec_md.is_file():
            text = spec_md.read_text(encoding="utf-8", errors="replace")
            tm = TITLE_RE.search(text) or H1_RE.search(text)
            if tm:
                title = tm.group(1).strip()
            sm = STATUS_RE.search(text)
            if sm:
                raw = sm.group(1).strip().lower()
                status = raw if raw in STATUS_BADGES else DEFAULT_STATUS
                if raw not in STATUS_BADGES:
                    print(
                        f"warning: spec '{name}' has unknown Status '{sm.group(1).strip()}'; "
                        f"treating as '{DEFAULT_STATUS}'",
                        file=sys.stderr,
                    )

        # Fall back to a humanized slug when the title is still a placeholder.
        if not title or title.upper().startswith("[FEATURE") or title == "NAME":
            title = humanize(slug)

        by_band[band].append(
            {
                "id": f"{number:04d}",
                "dir": name,
                "title": title,
                "status": status,
            }
        )

    for specs in by_band.values():
        specs.sort(key=lambda s: s["id"])
    return by_band


def render() -> str:
    by_band = discover_specs()
    out = [HEADER]
    for key, title, rng, *_ in BANDS:
        out.append(f"\n## {title} ({rng})\n")
        specs = by_band[key]
        if not specs:
            out.append("\n_None yet._\n")
            continue
        out.append("\n| Spec | Title | Status |\n|------|-------|--------|\n")
        for s in specs:
            link = f"[{s['id']}](specs/{s['dir']}/spec.md)"
            badge = STATUS_BADGES.get(s["status"], STATUS_BADGES[DEFAULT_STATUS])
            out.append(f"| {link} | {s['title']} | {badge} |\n")
    return "".join(out)


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate or verify ROADMAP.md")
    parser.add_argument(
        "--check",
        action="store_true",
        help="exit non-zero if ROADMAP.md is missing or out of date (no write)",
    )
    args = parser.parse_args()

    content = render()

    if args.check:
        current = ROADMAP.read_text(encoding="utf-8") if ROADMAP.is_file() else ""
        if current != content:
            print(
                "ROADMAP.md is out of date. Run `make roadmap` (or "
                "`python3 scripts/roadmap-gen.py`) and commit the result.",
                file=sys.stderr,
            )
            return 1
        print("ROADMAP.md is up to date.")
        return 0

    ROADMAP.write_text(content, encoding="utf-8")
    print(f"Wrote {ROADMAP.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
