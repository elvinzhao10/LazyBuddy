#!/usr/bin/env python3
"""Split plan/plan.md into per-version files with v0.x naming.

- v0 -> v0.0, v1 -> v0.1, ... v12 -> v0.12
- Meta sections (contract, surface map, sequence, impl order) -> plan/README.md
- Each version -> its own plan/v0.N-<slug>.md
- Optional add-ons -> plan/v0.13-add-ons.md
- Evaluation rubric -> plan/v0.14-evaluation-rubric.md
- Correct ${workbuddy_PLUGIN_ROOT} -> ${CODEBUDDY_PLUGIN_ROOT} per official docs
"""
import re
from pathlib import Path

PLAN_DIR = Path("/Users/Admin/Desktop/lazyworkbuddy/plan")
SRC = PLAN_DIR / "plan.md"

text = SRC.read_text(encoding="utf-8")

# --- 1. Rename version tokens v0..v12 -> v0.0..v0.12 -----------------------
# Match v + digits NOT followed by a dot or digit (avoids touching "v4.16.0").
def rename_v(m):
    n = int(m.group(1))
    return f"v0.{n}"

text = re.sub(r"\bv(\d+)(?![.\d])", rename_v, text)

# --- 2. Correct env-var naming per official docs ---------------------------
text = text.replace("${workbuddy_PLUGIN_ROOT}", "${CODEBUDDY_PLUGIN_ROOT}")
text = text.replace("${workbuddy_PLUGIN_DATA}", "${CODEBUDDY_PLUGIN_DATA}")

# --- 3. Split into sections by the horizontal rule separator --------------
# The separator is a single U+2E3B (THREE-EM DASH) char on its own line.
RAW_SECTIONS = re.split(r"(?m)^[\u2e3b]+\s*$", text)
SECTIONS = [s.strip() for s in RAW_SECTIONS if s.strip()]

# --- 4. Classify each section ----------------------------------------------
# (slug, filename) or ("README",) for meta sections.
VERSION_SLUGS = {
    0: "discovery",
    1: "architecture",
    2: "project-memory",
    3: "plugin-scaffold",
    4: "skills-commands",
    5: "subagents",
    6: "hooks-safety",
    7: "run-ledger",
    8: "mcp-dashboard",
    9: "hardening",
    10: "migration",
    11: "dogfood",
    12: "release",
}

README_PARTS = []
ADDON_PARTS = []
RUBRIC_PART = []
files_written = []

def heading_of(section):
    """Return the first non-empty line that looks like a heading/title."""
    for line in section.splitlines():
        ln = line.strip()
        if ln:
            return ln
    return ""

for sec in SECTIONS:
    h = heading_of(sec)
    # Version sections: "Lazyworkbuddy v0.N — ..."  (already renamed)
    m = re.match(r"(?i)laz[y]?workbuddy\s+v0\.(\d+)\s*[—-]\s*(.+)", h)
    if m:
        n = int(m.group(1))
        title = m.group(2).strip()
        slug = VERSION_SLUGS.get(n, f"v{0}.{n}")
        fname = f"v0.{n}-{slug}.md"
        # Prepend a clean H1
        body = f"# Lazyworkbuddy v0.{n} — {title}\n\n{sec}"
        (PLAN_DIR / fname).write_text(body + "\n", encoding="utf-8")
        files_written.append(fname)
        continue

    # Optional add-on sections
    if h.lower().startswith("optional add-on"):
        ADDON_PARTS.append(sec)
        continue

    # Final evaluation rubric
    if "evaluation rubric" in h.lower() or "final evaluation" in h.lower():
        RUBRIC_PART.append(sec)
        continue

    # Recommended implementation order
    if "recommended implementation order" in h.lower():
        README_PARTS.append(("# Recommended implementation order", sec))
        continue

    # Everything else is meta -> README (contract, surface map, sequence overview)
    README_PARTS.append((h, sec))

# --- 5. Write README.md (index + meta) ------------------------------------
readme = []
readme.append("# Lazyworkbuddy plan\n")
readme.append(
    "This directory holds the versioned implementation plan for Lazyworkbuddy — "
    "a WorkBuddy-native recreation of LazyCodex. The whole project is a "
    "**version 0 build** (pre-1.0), so every phase is numbered `v0.N`.\n"
)
readme.append("## Version index\n")
readme.append("| File | Phase | Purpose |")
readme.append("| --- | --- | --- |")
index_rows = [
    ("v0.0-discovery.md", "Discovery", "Discover LazyCodex contract and WorkBuddy host surface"),
    ("v0.1-architecture.md", "Architecture", "Full WorkBuddy-native architecture plan"),
    ("v0.2-project-memory.md", "Project memory", "Project memory, rules, command constitution"),
    ("v0.3-plugin-scaffold.md", "Plugin scaffold", "Installable WorkBuddy plugin shell"),
    ("v0.4-skills-commands.md", "Skills & commands", "LazyCodex-style WorkBuddy workflows"),
    ("v0.5-subagents.md", "Subagents", "Planner, implementer, verifier, reviewer, librarian"),
    ("v0.6-hooks-safety.md", "Hooks & safety", "Deterministic lifecycle enforcement"),
    ("v0.7-run-ledger.md", "Run ledger & loop", "Checkpoints, logs, resumable runs"),
    ("v0.8-mcp-dashboard.md", "MCP & dashboard", "Tools, prompts, dashboard, source capture"),
    ("v0.9-hardening.md", "Hardening", "Quality gates and memory updates"),
    ("v0.10-migration.md", "Migration", "Reusable cross-platform adapter system"),
    ("v0.11-dogfood.md", "Dogfood", "End-to-end self-test"),
    ("v0.12-release.md", "Release", "Final release and parity report"),
    ("v0.13-add-ons.md", "Add-ons", "Optional automation, channels, dashboard"),
    ("v0.14-evaluation-rubric.md", "Rubric", "Final evaluation scoring"),
]
for fn, phase, purpose in index_rows:
    readme.append(f"| [{fn}]({fn}) | {phase} | {purpose} |")
readme.append("")
readme.append("## Implementation order\n")
readme.append(
    "1. Paste the benchmark contract.\n"
    "2. Paste v0.0 and wait for the discovery files.\n"
    "3. Paste v0.1 and review the architecture.\n"
    "4. Paste v0.2–v0.7 to get a real working core (the MVP).\n"
    "5. Paste v0.8–v0.10 to add tools, dashboard, and migration capability.\n"
    "6. Paste v0.11 to dogfood.\n"
    "7. Paste v0.12 to finalize.\n"
    "8. Use optional add-ons (v0.13) only after v0.7.\n"
)
readme.append("---\n")
# Append the meta sections (contract, surface map, sequence overview, impl order)
for h, sec in README_PARTS:
    readme.append(sec)
    readme.append("\n---\n")

(PLAN_DIR / "README.md").write_text("\n".join(readme), encoding="utf-8")
files_written.append("README.md")

# --- 6. Write add-ons file -------------------------------------------------
if ADDON_PARTS:
    body = "# Lazyworkbuddy v0.13 — optional add-ons\n\n"
    body += (
        "These add-ons build on top of v0.7+ and are optional. "
        "Use them only after the core plugin, state ledger, commands, and "
        "verification loop exist.\n\n---\n\n"
    )
    for sec in ADDON_PARTS:
        body += sec + "\n\n---\n\n"
    (PLAN_DIR / "v0.13-add-ons.md").write_text(body, encoding="utf-8")
    files_written.append("v0.13-add-ons.md")

# --- 7. Write evaluation rubric file ---------------------------------------
if RUBRIC_PART:
    body = "# Lazyworkbuddy v0.14 — final evaluation rubric\n\n"
    body += "Evaluate Lazyworkbuddy on a 0–5 scale after v0.12.\n\n---\n\n"
    for sec in RUBRIC_PART:
        body += sec + "\n\n---\n\n"
    (PLAN_DIR / "v0.14-evaluation-rubric.md").write_text(body, encoding="utf-8")
    files_written.append("v0.14-evaluation-rubric.md")

# --- 8. Report -------------------------------------------------------------
print("Files written:")
for f in sorted(files_written):
    print(f"  {f}")
print(f"\nTotal: {len(files_written)} files")
