# LazyBuddy v1.0.3 — Adaptive Harness

**Release date:** 2026-07-20
**Status:** Release-ready commits and artifacts only. Not pushed, tagged, or
published.

## What's new

v1.0.3 turns LazyBuddy's menu of named workflows into one adaptive experience.
You state the outcome; the harness selects the smallest sufficient workflow,
composes the specialists and capabilities it needs, explains the material
choices, escalates only when evidence requires it, and resumes through the
existing runtime state.

## Outcome-first adaptive selection

When you describe an outcome without naming a workflow, the adaptive harness
picks a mode for you. It does not replace the workflows you already know — it
chooses among them. If you name one explicitly, that request stays
authoritative.

## Five workflow modes

The harness selects one of five modes, each mapping onto existing LazyBuddy
surfaces (Skills, commands, agents, hooks, MCP services, run-ledger,
verification):

| Mode | When it applies |
| --- | --- |
| **direct** | Small, localized, low-risk change with clear acceptance criteria. |
| **assisted** | Unfamiliar or cross-file diagnostic work that needs exploration first. |
| **planned** | Broad or ambiguous work where decisions must be resolved before editing. |
| **orchestrated** | Security-sensitive, release, or multi-system work needing independent review. |
| **long-horizon** | Multi-session work needing durable checkpoints and a continuation loop. |

The policy always picks the **lowest** mode that satisfies the identified
risk, uncertainty, and verification requirements. It never escalates just
because more capabilities are available.

## Automatic specialist and capability composition

The harness dynamically selects existing Skills, agent responsibilities, the
six declared MCP services (run-ledger, verification, status-dashboard,
context-graph, code-intel, docs) plus the lsp server, local tools, hooks, and
verification depth. It reuses what is already installed and declared — it
does not install new commands, hooks, or providers per task. One owner is
assigned to each implementation stage; parallel agents are used only for
genuinely independent work.

## Explicit override remains authoritative

Named workflows — `lazy-init-deep`, `lazy-ulw-plan`, `lazy-start-work`,
`lazy-ulw-loop`, `lazy-review-work`, and others — remain fully authoritative.
If you ask for a plan only, you get planning. If you ask for a direct fix,
the harness will not silently insert a planning stage unless safety or missing
authority requires it. The classifier may add required verification or
approval boundaries, but it never silently downgrades or replaces an explicit
request.

## Bounded escalation

A targeted verification failure adds a debugging stage. A failure that
reveals broader scope may increase the mode by one level. An unavailable
capability uses a safe fallback before increasing workflow depth. The harness
performs **at most two automatic depth escalations** per decision. After
that, it produces a blocked-state record with the reproduced failure,
attempted approaches, current evidence, and the exact next user decision
needed — rather than looping indefinitely.

## Concise orchestration explanation

Every decision is surfaced through existing status and capability surfaces.
The explanation shows the selected mode, stages, responsibilities, and
capabilities, plus what was **not** selected and why. When a capability
fallback occurs, the substitution is reported with its effect on evidence
strength — so you never see a silent downgrade.

## Lightweight continuation snapshot

The harness writes an optional, additive `adaptive` block into the existing
run/loop state. It records the decision, current stage, runtime resolution,
escalation count, revision marker, and next action. The block is
single-writer (only the adaptive orchestrator writes it), backward-compatible
(v1.0.2 state without the block loads unchanged), and adds no new locks or
compare-and-swap machinery.

## Full-plugin WorkBuddy and CodeBuddy mapping

CodeBuddy and WorkBuddy are both treated as **full-plugin hosts**. When a
live full-plugin session is confirmed, the adaptive adapter may use all
existing Skills, commands, specialist agents, hooks, all declared MCP
services, and existing run-ledger and verification surfaces. The
Skills/MCP-only route remains an explicitly **degraded fallback** for
environments where full-plugin loading cannot be established — it is not the
adaptive architecture or the default product target. CodeBuddy and WorkBuddy
may have different installation and lifecycle routes, but they implement the
same adaptive decision contract at the user level.

## Unchanged authority and host-readiness boundaries

- **Authority:** read-only and package-owned capabilities activate
  automatically. Installations, persistence, host settings, credentials,
  browser/desktop control, remote access, and data egress still require
  explicit approval. No hidden host mutation occurs.
- **Host readiness:** package evidence is not live-host evidence. Package
  checks establish local package readiness only; host readiness requires a
  fresh CodeBuddy or WorkBuddy session, one real Skill/command, and observed
  state for all expected MCP connections. Otherwise host readiness remains
  PENDING.
- **No new MCP servers, remote providers, host settings, or production
  dependencies.** The six existing MCP servers plus the lsp server keep their
  identities. No cross-repository runtime dependencies. No state-store
  replacement or memory migration.

## Known gaps (deferred to v1.0.4)

- **Continuation resume:** the classifier does not yet resume from compatible
  snapshots. Every request produces a fresh decision. Pinned by xfail tests.
- **Evidence freshness:** `revisionMarker` is constant; stale snapshot
  detection and the re-verification trigger signal are not implemented.
  Pinned by xfail tests.
- **Live-host QA:** WorkBuddy and CodeBuddy live-host verification is PENDING
  — no live host was available in the release session. Package evidence and
  fixture-based parity are verified; live-host evidence was not captured.

## Cross-repo parity

LazyBuddy and LazyTrae consume the same byte-identical
`adaptive-harness-contract.v1.json` and the same ten behavioral fixtures,
with paired sha256 digest parity. Equivalent requests produce equivalent
user-level modes, responsibilities, approval boundaries, and verification
gates — with no runtime coupling between repositories.
