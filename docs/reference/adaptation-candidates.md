# Adaptation candidates — family delta rescan 2026-10-22 (V2-T6)

Canonical family document (held in LazyBuddy). Delta-only rescan of the six
host families' official changelogs and reference docs for changes published
since the 2026-10-18 rescans (run 1p4p0-completion-ux-20261018, tasks T4–T9;
per-host snapshots: [platform status 2026-10-27](platform-status-2026-10-27.md) and [2026-10-18](platform-status-2026-10-18.md)). Observed
2026-10-19. This page lists **features that could be adapted next**, with the
source each finding came from and the seam an adaptation would require. It
records documentation, not authenticated execution; vendor pages were treated
as untrusted text and no instruction inside them was followed. **HOST
READINESS: PENDING** everywhere is unchanged by this rescan.

## Adopted in this delta window

| Family | Finding | Source | Observed | Adoption |
| --- | --- | --- | --- | --- |
| Kimi | Kimi Code CLI 2.3.0 dropped bare-name plugin skill invocation; skills are invoked as `/skill:<pluginID>:<skillName>`, commands as `/<pluginID>:<command>` (changelog dated 2026-10-21, absent from the 2026-10-18 scan) | [CLI changelog](https://kimi.com/code/docs/en/kimi-code-cli/changelog.html), [plugins reference](https://kimi.com/code/docs/en/kimi-code-cli/customization/plugins.html) | 2026-10-19 | Adopted in LazyKimi (manifest `skillInstructions` + session-start/user-prompt-submit hook nudges + regenerated marketplace route contract; `sessionStart.skill` value contract unchanged) |

## Adaptation candidates (not adopted; seam required)

| # | Family | Candidate feature | Class | Source | Observed | Seam an adaptation would need |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | ZCode | Plugin marketplace: Settings → Plugins browsing/install/enable/disable/uninstall/update; `marketplace.json` catalog schema (`name`, `description`, `plugins`, `pluginRoot`, `allowCrossMarketplaceDependenciesOn`; per-entry `name`/`source`/`description`/`version`/`category`/`tags`/`dependencies`/`strict`; sources directory/github/git/file/url/npm); public catalog served from GitHub; update check keyed on manifest `version` bumps | stable-documented (v3.16.2 changelog, dated 2026-10-20, plus current plugin reference) | [Changelog](https://zcode.z.ai/en/changelog), [plugin reference](https://zcode.z.ai/en/docs/plugin) | 2026-10-19 | A marketplace listing artifact per repo (family precedent: `lazykimi-plugin/marketplace.json` v2 catalog) plus a release policy that bumps the manifest `version` for every published change; LazyZCode ships neither today |
| 2 | ZCode | Tool search / on-demand tool loading | experimental (changelog-only; no reference page or schema) | [Changelog](https://zcode.z.ai/en/changelog) (v3.16.2) | 2026-10-19 | A documented tool-registration surface; none exists in any family repo |
| 3 | Kimi | CLI 2.3.0 config keys: `dangerous_command_guard` (disables built-in guardrails when false), session-rating toggle in config.toml | stable (dated changelog) | [CLI changelog](https://kimi.com/code/docs/en/kimi-code-cli/changelog.html) | 2026-10-19 | A config.toml management or observation seam in LazyKimi; host config is currently untouched by the package |
| 4 | Kimi | Desktop 1.1.1 session reload (`/reload`) applies external AGENTS.md, skill, and config changes immediately | stable (dated changelog) | [Desktop changelog](https://kimi.com/code/docs/en/kimi-code-desktop/changelog.html) | 2026-10-19 | A payload-refresh observation step in the project-init route (payload is static today); also relevant to every family payload AGENTS.md |
| 5 | Kimi | Remote-control streaming limit raised 10 → 100 MiB (CLI 2.3.0) | stable (dated changelog) | [CLI changelog](https://kimi.com/code/docs/en/kimi-code-cli/changelog.html) | 2026-10-19 | None exists; observation-only candidate for the remote-control row |
| 6 | Qoder | CLI 1.1.74–1.1.77 (2026-10-19 → 2026-10-22): mid-response local slash commands (`/model`, `/fast`, `/effort`, `/skills`, `/agents`, plugin management); `/plugins` multi-project status fix; MCP server no longer loses all tools when prompts/resources fetch fails; session cleanup now opt-in via config; checkpoint rewind restores every file it can and lists unrestorable ones; session-fork//branch speedups | stable (dated changelog); no family seam consumes them | [CLI release notes](https://docs.qoder.com/release-notes/qoder-cli) | 2026-10-19 | Session-fork/checkpoint observation rows in the Qoder observation bundle if those behaviors ever become probe-relevant; nothing today |
| 7 | Qoder | `fast` still not a selectable model tier — model page documents Smart Routing (Auto)/Ultimate/Performance/Efficient; `fast` remains a per-model mode (`/fast on`, Kimi-K2.7-Code) | stable-documented non-change (recheck of the open 2026-10-18 item) | [Model reference](https://docs.qoder.com/cli/model) | 2026-10-19 | Model-routing-policy rename only if the vendor promotes `fast` to a documented tier; `performance` stays canonical until then |
| 8 | Trae | IDE v3.4.1–3.4.4 (vendor-dated 2026-10-15, absent from the 2026-10-18 findings): TraeWork migration, unified @ context menu, Artifact rich previews, enterprise cloud-task policy | unknown-as-delta (publication date unverifiable: vendor date precedes the 2026-10-18 scan but the entry was not present in it) | [IDE changelog](https://docs.trae.cn/ide_changelog) | 2026-10-19 | If the merged TRAE product documents stable plugin/hook contracts, the three LazyTrae host adapters (CN IDE / TraeCode CLI / global) consolidate into one — an adapter-consolidation seam, not a feature seam |
| 9 | CodeBuddy | Undated CLI reference flags not enumerated in the 2026-10-18 snapshot: `--teleport`, `--prewarm`/`--prewarm-id`, `--autocompact`, `--bg`/`--name`, `--agent`/`--multitask`, `--plugin-dir`, `--json-schema`; release-notes page renders only via JS (no dated entries fetchable) | unknown-as-delta (undated page; cannot prove publication since 2026-10-18) | [CLI reference](https://www.codebuddy.ai/docs/cli/cli-reference) | 2026-10-19 | None — LazyBuddy is docs/reference-only; a dated release note would let the reference record them as observations |

## Confirmed no-delta (window: since 2026-10-18)

- WorkBuddy: changelog unchanged — newest dated entry 5.2.7 (2026-07-17); the
  undated 5.5.0–5.8.4 block was already recorded on 2026-10-18
  ([changelog](https://www.workbuddy.ai/docs/workbuddy/Changelog)).
- DeepSeek: API updates newest entry 2026-10-17 (search API GA, V4.1-Flash-1017
  — both recorded in the 2026-10-18 scan); deepseek-harness newest release
  `dsh-v0.2.1-rc.2` (2026-10-17, prerelease) — pin stays `0.2.0-rc.2` exact
  ([updates](https://api-docs.deepseek.com/updates/),
  [releases](https://github.com/deepseek-ai/deepseek-harness/releases)).
- Trae: no changelog entry dated on or after 2026-10-18.

Vendor dates on new Kimi (2026-10-21) and Qoder (2026-10-19 → 2026-10-22)
entries run ahead of the observation date; entries were absent from the
2026-10-18 scans and are treated as published within the delta window on that
basis. Dispositions for every finding live in the run evidence
(`dashboard-v2-refinement-20261022/evidence/T6/findings.md`).
