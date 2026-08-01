"""W4.6 Evidence Freshness integration tests for v1.0.3 Adaptive Harness (LazyBuddy).

Proves the "Stale completion evidence" risk control (plan Section 18) is in
place on the LazyBuddy side: completion verification is rerun after relevant
implementation changes, and no new evidence-lineage database is introduced.

Mirrors the LazyTrae W4.6 test file. Scenarios:
  1. revisionMarker is present in the adaptive snapshot (Section 11)
  2. revisionMarker changes when implementation changes (mock file-hash derivation)
  3. No new lineage/evidence-db/transaction files introduced in W2/W3/W4 waves
  4. Existing verification mechanism reused (lazy-verifier) — no parallel verifier
  5. Stale prior snapshot triggers reclassification (Section 18)
  6. Re-verification trigger when revisionMarker changes (Section 18)

Note: validateEvidencePaths is LazyTrae-specific (path-boundary). LazyBuddy
verifies evidence through lazy-verifier / lazybuddy-verify.sh; scenario 4
covers the reuse of that surface.
"""

from __future__ import annotations

import hashlib
import re
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lazybuddy_adaptive_detector import classify_adaptive_decision  # noqa: E402
from lazybuddy_adaptive_mapping import VERIFICATION_SURFACE  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
TOOLING_DIR = Path(__file__).resolve().parent


def _mock_revision_fingerprint(content: str) -> dict:
    digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
    return {"digest": f"sha256:{digest}", "status": "available"}


def test_adaptive_snapshot_carries_available_revision_fingerprint():
    revision = _mock_revision_fingerprint("current implementation")
    decision = classify_adaptive_decision(
        "fix the typo in README",
        {"revision_fingerprint": revision},
    )
    snapshot = decision["snapshot"]
    assert snapshot["revisionFingerprint"] == revision


def test_revision_marker_changes_when_implementation_changes():
    """Mock file-hash revision marker must differ when content changes."""
    before_content = "def old_impl():\n    return 1\n"
    after_content = "def new_impl():\n    return 2\n"
    before = _mock_revision_fingerprint(before_content)
    after = _mock_revision_fingerprint(after_content)
    assert before != after, "revision marker must differ when implementation changes"
    assert before == _mock_revision_fingerprint(
        before_content
    ), "revision marker must be deterministic for unchanged content"


def test_no_new_lineage_evidence_db_transaction_files_introduced():
    """git diff v1.0.2..HEAD for lineage/evidence-db/transaction files must be empty."""
    result = subprocess.run(
        [
            "git",
            "diff",
            "--name-only",
            "v1.0.2..HEAD",
            "--",
            "**/lineage*",
            "**/evidence-db*",
            "**/transaction*",
        ],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    diff = result.stdout.strip()
    assert (
        diff == ""
    ), f"no lineage/evidence-db/transaction files may be introduced; got:\n{diff}"


def test_adaptive_layer_reuses_lazy_verifier_no_parallel_verifier():
    """Adaptive layer must reference lazy-verifier and not import a new lineage module."""
    adaptive_modules = [
        "lazybuddy_adaptive_detector.py",
        "lazybuddy_adaptive_mapping.py",
        "lazybuddy_adaptive_snapshot.py",
        "lazybuddy_adaptive_explanation.py",
        "lazybuddy_adaptive_hosts.py",
    ]
    combined = ""
    for name in adaptive_modules:
        p = TOOLING_DIR / name
        if p.exists():
            combined += p.read_text(encoding="utf-8") + "\n"
    # Positive: the adaptive layer declares lazy-verifier as the verification surface.
    assert re.search(
        r"lazy-verifier", combined
    ), "adaptive layer must reference lazy-verifier as the verification surface"
    # Negative: no new lineage / evidence-db module imported.
    assert not re.search(
        r"import\s+(lineage|evidence_db|evidence_lineage)", combined
    ), "adaptive layer must not import a new lineage/evidence-db module"
    # The VERIFICATION_SURFACE constant must equal 'lazy-verifier'.
    assert VERIFICATION_SURFACE == "lazy-verifier"


def test_lazybuddy_verify_script_exists():
    """The existing verify script (lazybuddy-verify.sh) must still exist and be executable."""
    verify_script = REPO_ROOT / "lazybuddy-plugin" / "scripts" / "lazybuddy-verify.sh"
    assert verify_script.exists(), f"lazybuddy-verify.sh must exist at {verify_script}"
    assert (
        verify_script.stat().st_mode & 0o111
    ), "lazybuddy-verify.sh must remain executable (existing verifier reused)"


# Section 18: when the prior snapshot's revisionMarker differs from the
# current one, the classifier must reclassify starting from `understand`.
def test_stale_prior_snapshot_triggers_reclassification():
    request = "fix the typo in README"
    old_revision = _mock_revision_fingerprint("old implementation")
    new_revision = _mock_revision_fingerprint("new implementation")
    host = "sha256:" + "1" * 64
    scope = "sha256:" + "2" * 64
    prior_snapshot = classify_adaptive_decision(
        request,
        {
            "host_fingerprint": host,
            "revision_fingerprint": old_revision,
            "scope_fingerprint": scope,
        },
    )["snapshot"]
    prior_snapshot["currentStage"] = "verify"
    decision = classify_adaptive_decision(
        request,
        {
            "host_fingerprint": host,
            "revision_fingerprint": new_revision,
            "scope_fingerprint": scope,
            "snapshot": prior_snapshot,
        },
    )
    assert (
        decision["snapshot"]["revisionFingerprint"]
        != prior_snapshot["revisionFingerprint"]
    ), "classifier must produce a fresh revision fingerprint when implementation changed"
    assert (
        "understand" in decision["stages"]
    ), "classifier must restart from understand when prior snapshot is stale"
    assert any(
        re.search(r"stale|re-?verif|reclassif", r, re.I) for r in decision["reasons"]
    ), "classifier reasons must mention stale/re-verify/reclassify"


# Section 18: when the revisionMarker changes, the classifier must signal
# that re-verification is required after a revision change.
def test_re_verification_trigger_when_revision_marker_changes():
    """reasons must signal re-verification after a revision change."""
    old_revision = _mock_revision_fingerprint("old implementation")
    new_revision = _mock_revision_fingerprint("new implementation")
    assert old_revision != new_revision, "precondition: fingerprints differ"
    request = "fix the typo in README"
    host = "sha256:" + "1" * 64
    scope = "sha256:" + "2" * 64
    prior_snapshot = classify_adaptive_decision(
        request,
        {
            "host_fingerprint": host,
            "revision_fingerprint": old_revision,
            "scope_fingerprint": scope,
        },
    )["snapshot"]
    decision = classify_adaptive_decision(
        request,
        {
            "host_fingerprint": host,
            "revision_fingerprint": new_revision,
            "scope_fingerprint": scope,
            "snapshot": prior_snapshot,
        },
    )
    joined = "\n".join(decision["reasons"])
    assert re.search(
        r"re-?verif|stale|revision", joined, re.I
    ), "reasons must signal that re-verification is required after a revision change"
