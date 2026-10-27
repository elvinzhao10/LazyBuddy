# Artifact and research indices (T12)

Read-only collectors and query helpers over the native evidence tree and the
persistent project record, per spec §10 (Evidence and research). Nothing here
mutates the run tree, the project store or any original document; authority
stays with the T02 contract/model/CLI command route.

| File | Responsibility |
| --- | --- |
| [paths.mjs](paths.mjs) | Registration path policy (reuses the shared contract rules, protects the neutral `.lazyseries` registry) and bounded, symlink-refusing reads with typed codes. |
| [index.mjs](index.mjs) | Deterministic scan of `.lazybuddy/runs/<run>/{artifacts,evidence,verification}` plus registered artifacts, research source paths and observation links; status and preview classification. |
| [preview.mjs](preview.mjs) | Safe Markdown/image/text/JSON previews as inert JSON data; allowlist Markdown rendering that strips HTML, dangerous elements and `javascript:` URLs; original-file links preserved. |
| [register.mjs](register.mjs) | Composes `artifact.register` commands with digest, size, symlink and path prechecks. Acceptance happens only through the real model/CLI command route. |
| [research.mjs](research.mjs) | Research composition helpers and the fail-closed promotion view: research grants no verification, accepts no requirement, and reaches content only through a proposal. |
| [query.mjs](query.mjs) | Deterministic pagination with totals/coverage and relationship queries from task, gate, plan, feature and the global index (consumed by the UI at T19). |

## Access states

`available`, `missing`, `redacted` (current bytes differ from the recorded
digest), `moved` (registered digest found at another indexed path), `unsupported`
(unknown preview kind, or a file over the 8 MiB read limit — such files also
refuse registration with `ARTIFACT_TOO_LARGE` and cannot claim a digest), and
`inaccessible` (unreadable, not a regular file, or a symlinked path, which is
refused). Preview truncation is always flagged with total bytes; page results
always carry `total`, `page_count` and per-status coverage.

## Classification

Deterministic from the lowercase path and extension: a `research` path segment
means research, a `receipt` name part means a release receipt, image extensions
mean a screenshot, video extensions a recording; Markdown under `verification/`
is a verification report and otherwise a design note; `.log`/`.txt` are logs;
JSON under `verification/` is a verification report and otherwise a test
summary. Anything else stays unclassified and requires an explicit type before
registration.

Run the suite with the repository Node runtime:

```bash
node --test lazybuddy-plugin/shared/project/test/artifact-index.test.mjs
```

This README records implementation behavior, not a test-pass certificate.
