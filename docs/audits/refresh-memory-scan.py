"""Refresh the tracked-file inventory and mechanical memory-audit search evidence."""

import collections
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess


ROOT = Path(__file__).resolve().parents[2]
INVENTORY = "docs/audits/memory-leak-file-inventory-2026-09-15.tsv"
SEARCH = "docs/audits/memory-pattern-scan-2026-09-15.json"
SOURCE = set(".ts .tsx .js .jsx .mjs .cjs .mts .cts .swift .sh .ps1 .rb .cmd .kt .py .cc .cs .vbs .c .h .cpp .rs .go .bat .m .mm".split())
CONFIG = set(".json .yml .tf .yaml .hcl .tfvars .podspec .plist .toml .nsh .jsonc .gradle .xml .gyp".split())
DOCS = {".md", ".mdx", ".txt"}
SIGNALS = [
    "addEventListener", "removeEventListener", "setTimeout", "clearTimeout",
    "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame",
    "subscribe(", "unsubscribe", "DisposableStore", "MutableDisposable",
    "onWillDispose", "onDidDispose", "new Map", "new Set", "Buffer.concat",
    "Promise.race", "Promise.withResolvers",
]


def category(path):
    suffix = Path(path).suffix
    if suffix in SOURCE:
        return "source"
    if suffix in CONFIG:
        return "config"
    if suffix in DOCS:
        return "documentation"
    return "asset-or-other"


def main():
    raw = subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT)
    paths = sorted(set(os.fsdecode(path) for path in raw.split(b"\0") if path))
    source = [p for p in paths if category(p) == "source" and not (ROOT / p).is_symlink()]
    totals = collections.Counter()
    matches = collections.defaultdict(collections.Counter)
    pattern = "|".join(re.escape(signal) for signal in SIGNALS)
    for start in range(0, len(source), 300):
        result = subprocess.run(
            ["rg", "--no-ignore", "--text", "--only-matching", "--no-line-number",
             "--with-filename", "--color", "never", "-e", pattern, "--",
             *source[start:start + 300]],
            cwd=ROOT, text=True, capture_output=True, check=False,
        )
        if result.returncode not in (0, 1):
            raise RuntimeError(result.stderr)
        for line in result.stdout.splitlines():
            path, _, signal = line.rpartition(":")
            if signal not in SIGNALS:
                raise RuntimeError(f"Unexpected search output for {path}")
            totals[signal] += 1
            matches[path][signal] += 1
    (ROOT / SEARCH).write_text(json.dumps({
        "scope": "All tracked source suffixes; comments/tests included; symlinks excluded from search",
        "interpretation": "Mechanical candidate search, not proof of manual review or leak freedom",
        "sourceSuffixes": sorted(SOURCE),
        "sourceFilesSearched": len(source),
        "matchingFiles": len(matches),
        "counts": {s: totals[s] for s in SIGNALS},
        "files": {p: dict(sorted(matches[p].items())) for p in sorted(matches)},
    }, indent=2) + "\n")

    rows = ["category\tsize_bytes\tsha256\tpath"]
    categories = collections.Counter()
    for path in paths:
        if path == INVENTORY:
            continue
        full = ROOT / path
        data = os.fsencode(os.readlink(full)) if full.is_symlink() else full.read_bytes()
        kind = category(path)
        categories[kind] += 1
        rows.append(f"{kind}\t{len(data)}\t{hashlib.sha256(data).hexdigest()}\t{path}")
    (ROOT / INVENTORY).write_text("\n".join(rows) + "\n")
    print(json.dumps({"inventoryRows": len(rows) - 1, "categories": categories,
                      "sourceFilesSearched": len(source), "matchingFiles": len(matches),
                      "counts": dict(totals)}, indent=2))


if __name__ == "__main__":
    main()
