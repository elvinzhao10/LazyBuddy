# Outcome evaluation

`outcome-evaluation.js` is a read-only local comparison tool. It does not write telemetry, call a provider, or derive a price from token counts.

Run it with an absolute evidence root and an evaluation manifest:

```text
node contracts/outcome-evaluation.js --evidence-root /absolute/path/to/evidence-root manifest.json
```

`node contracts/outcome-evaluation.js --help` prints the same usage. The manifest shape and canonical examples are in [fixtures/outcome-evaluation-v1/manifest.json](fixtures/outcome-evaluation-v1/manifest.json).

Provide `host-only`, `minimal`, and `full-lazy` runs from one matched cohort. Every run must have the same task identity, repository revision, package version, criterion, task snapshot, budget snapshot, permissions snapshot, host build, and model. Each snapshot is a `{path, sha256}` reference to a regular file below the evidence root; the evaluator hashes the referenced bytes, and the task snapshot's `task_id` and `criterion_id` must match the cohort. Missing, changed, linked-outside, mismatched, and repeated inputs fail instead of producing an A/B comparison.

Each run contains a validated `lazyseries.cost-outcome.v1` record with `measurement_scope: "execution"`, explicit host-reported billing in micro-USD, and an outcome. Omitted and `fixture-validation` scopes are rejected at this matched-comparison boundary. Native billing is summed for every attempt, including an unverified or failed attempt. The cost-per-verified-completion denominator includes only runs with validated completion evidence. The tool never estimates a cost from tokens. When tokens or billing are unavailable, keep their values `null` and state the unavailable reason; the report preserves that uncertainty. The required `execution` label remains caller-supplied metadata and does not establish native usage or billing provenance.

Verified outcomes reference a completion-evidence JSON file below the evidence root. The tool resolves paths, validates the referenced file digest, and runs the existing completion-evidence checks, including the artifact digest and distinct executor/verifier identities. `outcome_evidence_integrity` is `absent` when no run has validated evidence, `partial` when only some runs do, and `validated` when every run does. These labels describe referenced bytes and contract checks; they do not establish an external ground truth about the outcome.

The bundled fixture is synthetic conformance data. Its `execution` labels exercise the comparison input shape; they do not turn the fixture into a real execution measurement. Its reported values demonstrate the file format and aggregation rules only; they are not a measured A/B result.

The evaluator uses the existing contract validator and requires no new dependency.
