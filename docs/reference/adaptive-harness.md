# Adaptive Harness: Canonical Snapshot

> Reference for v1.0.3 maintainers. LazyBuddy produces and persists one exact
> camelCase adaptive snapshot. There is no snake_case persistence shape or
> production translation layer.

## One production shape

`classify_adaptive_decision` returns a decision envelope with a canonical
`snapshot`. When a related active run exists, the adaptive runtime passes that
same snapshot to `persist_snapshot`, which validates it, deep-copies it into
`run_state["adaptive"]`, and saves the run through the existing atomic state
writer. No field mapping occurs between classification and persistence.

The closed shape is defined in three matching places:

- `SNAPSHOT_REQUIRED_FIELDS` and `validate_adaptive_snapshot` in
  `lazybuddy-plugin/tooling/lazybuddy_adaptive_snapshot.py`;
- `definitions.snapshot` in
  `lazybuddy-plugin/contracts/adaptive-harness-contract.v1.schema.json`;
- the optional `adaptive` block in
  `lazybuddy-plugin/schemas/active-run.schema.json`.

The shared root contract remains behavior-only. Its fixtures carry the
canonical snapshot, while runtime and provider resolution stay outside the
portable contract.

## Exact snapshot contract

The validator accepts exactly 20 fields: `version`, `decisionId`,
`requestDigest`, `mode`, `stages`, `currentStage`, `responsibilities`,
`capabilityClasses`, `capabilitySubstitutions`, `approval`, `escalationCount`,
`escalationHistory`, `revisionFingerprint`, `scopeFingerprint`,
`hostFingerprint`, `risk`, `reasons`, `blocker`, `nextAction`, and
`verificationLevel`.

Provider names, timestamps, `runtimeResolution`, `revisionMarker`, snake_case
aliases, and a `singleWriter` marker are not snapshot fields. The single-writer
rule is operational: the adaptive runtime owns writes to the active run's
`adaptive` block; Skills, agents, hooks, and MCP servers do not mutate it
directly.

## Continuation, authority, and evidence

A continuation resumes only when request, revision, scope, and host
fingerprints remain compatible and current risk and approval still match.
Material identity, risk, or approval changes produce a fresh decision. Stale
completion is rejected while diagnostic evidence is retained.

Responsibility selection does not grant authority for installation, persistent
capability changes, credentials or paid services, remote data egress, browser
or desktop control, host or MCP settings changes, or account, marketplace, and
publication mutations. Those concrete action classes still require approval.

Package qualification and an emitted adaptive directive do not prove host
execution. LazyBuddy records the host as `not-observed`; host readiness remains
pending until the selected CodeBuddy or WorkBuddy surface is observed
separately.

## Maintainer checks

When the snapshot changes, update the runtime validator, shared contract
schema, active-run schema, fixtures, and round-trip tests together. Keep the
shape closed to extra fields and keep provider identifiers out of portable
text.

Useful focused checks are:

```bash
python3 -m pytest lazybuddy-plugin/tooling/test_lazybuddy_adaptive_snapshot.py \
  lazybuddy-plugin/tooling/test_lazybuddy_adaptive_integration.py
bash lazybuddy-plugin/tests/v103-adaptive-contract-regression.sh
```

These checks establish the package snapshot and persistence contract. They do
not establish discovery, hook execution, a running host session, or an MCP
connection.
