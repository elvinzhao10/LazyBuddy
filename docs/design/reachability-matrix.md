# Reachability matrix — V2-T8 completeness & regression sweep

**Date:** 2026-10-19. **Head at sweep start:** `d414427`. **Scope:** every capability
delivered across the v1 1.4.0-completion run and the V2 refinement pass, each mapped to
its entry point in the CURRENT UI with a real proof (named test case or live DOM
receipt). Zero-loss rule: every row is reachable, restored in this task, or carries an
explicit disposition. Evidence lives under
`.lazyzcode/runs/dashboard-v2-refinement-20261022/evidence/T8/` (run-level, outside the
repo).

Proof shorthand: `[T]` = named passing test case (all suites green this pass: 211/211 UI
subset + 68/68 adjacent service suites), `[L]` = live DOM receipt (real browser/service,
artifacts in the evidence dir), `[F]` = fixed/restored in V2-T8, `[D]` = dispositioned.

## Shell and chrome

| Capability | Entry point in the current UI | Proof |
| --- | --- | --- |
| App frame: static retractable sidebar + one content surface | Sidebar rail; selecting a destination replaces content in place | [T] `ui-shell.test.mjs` "the frame mounts after init: grouped static sidebar, one content surface, no tab strip, hidden dock" |
| Compact 48px icon top bar (badge + destination/item title) | Rendered by the shell at all times | [T] `ui-shell.test.mjs` "the V2-T1 compact icon top bar replaces the stacked header" |
| Theme cycle light→dark→system (persisted `lazyseries-theme`) | Top-bar theme icon-toggle | [T] `ui-shell.test.mjs` "the theme icon-toggle cycles … (stale_state)" |
| ONE theme home in every shell state (incl. pre-init) | Toggle while the shell is mounted; legacy `#theme` select only before the shell mounts (pre-connect login) | [F][T] `ui-shell.test.mjs` "one theme home per shell state … (V2-T8)" — was: two visible controls pre-init |
| Rail collapse: button, ⌘B/Ctrl+B, reload restore, ≤48rem auto-retract | Top-bar collapse control / keyboard / viewport | [T] `ui-shell.test.mjs` "collapse matrix: button, Cmd+B, Ctrl+B, reload restore, ≤48rem auto-retract, focus (V2-T2)" |
| Divider section headers (Workspace/Observation), icons in rail mode | Sidebar groups | [T] `ui-shell.test.mjs` "section headers are divider rules … (V2-T2)" |
| Destination shortcuts ⌘/Ctrl+1..8 | Keyboard anywhere in the shell | [T] `ui-shell.test.mjs` "keyboard map: Cmd/Ctrl+1..8 destinations, Cmd/Ctrl+B retracts the rail, j/k sidebar traversal" |
| j/k list traversal, `/` filter focus, Escape closes overlays with focus return | T11 native experience layer (all pages; idempotent) | [T] same keyboard-map test; `overview.test.mjs` "keyboard traversal: graph arrows, tile roving, clause reachability, j/k over the attention list" |
| In-place item navigation + capped back stack | Page head Back affordance | [T] `ui-shell.test.mjs` "item navigation opens in place with a back affordance over the capped history stack" |
| Navigation guard over a dirty editor (keep/discard) | Leaving the Project destination (or ⌘N / Back) with unsaved drafts | [T] `ui-shell.test.mjs` "a dirty surface guards in-place navigation …"; `editor-views.test.mjs` "confirmLeave guards surface replacement …"; `live-project-ui.test.mjs` "leaving a dirty live editor asks through the shell guard" |
| Session restore (location + dock open + rail) | Reload | [T] `ui-shell.test.mjs` "navigation state survives a reload-shaped remount …"; "the dock open state persists per session …" |
| Floating overlay inspector dock (never resizes main view) | Dock trigger in the top bar; opens on node selection / records open | [T] `ui-shell.test.mjs` "the dock is a floating overlay: main-view geometry never changes … (V2-T4)"; "the narrow scrim dismisses the open dock …" |
| Dock inspector sections (Summary/Source/Changes/Evidence/Edges) + contributing-records drill-down | Map node selection | [T] `overview.test.mjs` "the attention queue is a native list whose rows open their contributing records in the dock"; `live-project-ui.test.mjs` |
| Polling refresh preserves place (location, back stack, dock, selection, mode) | Background projection updates | [T] `ui-shell.test.mjs` "polling refresh swaps the overview in place …"; `overview.test.mjs` "a polling bundle swap keeps the map selection, the mode, the tabs and the dock" |
| Rapid navigation / dock churn consistency | Repeated navigation + toggles | [T] `ui-shell.test.mjs` "rapid navigation loops stay consistent …"; "rapid dock open/close churn stays consistent …"; `ui-perf.test.mjs` budget B |

## Destinations (sidebar, always selectable)

| Capability | Entry point | Proof |
| --- | --- | --- |
| Overview (status hero, attention queue, lifecycle strip, metric tiles, macro map, freshness line) | Default destination | [T] `overview.test.mjs` 22 cases incl. "the overview renders as a scannable dashboard …" and "the overview decomposes into named components … (V2-T4)" |
| Status-sentence clauses → contributing records + map focus | Clause chips | [T] `overview.test.mjs` "status-sentence clauses render as designed chips that trace into records and the map" |
| Metric tiles: every total opens its records; unavailable never zero | Tile buttons | [T] `overview.test.mjs` "metric tiles: every available total opens its records; unavailable renders hollow, never zero" |
| Native adoption states on reconciliations (§14 step 6) | Attention queue rows (open reconciliations + adoption-pending rows) | [F][T] `overview.test.mjs` "reconciliation adoption states surface in the attention queue … (V2-T8)" — was: `native_adoption` never rendered |
| Project: structured/source editors, diff preview, baseline preview + acceptance, plan transitions | Project destination → "Registered sources and structured editor" disclosure | [T] `editor-views.test.mjs` 28 cases ("source.edit.preview shows the actual unified patch …", "the baseline preview shows the exact patch …", "a legal plan transition through the route is saved …") |
| Plans: plan browser, rendered original Markdown, jump-to-plan-section, open native run | Plans destination; plan item locations | [T] `live-project-ui.test.mjs` "live shell enables every layer, renders the registered long document, and drills plan to its bound run"; `document-view.test.mjs` 5 cases |
| Health (V2-T5): plugin self-health panel | Health destination (lazy module; honest unavailable without adapter/route) | [T] `health-view.test.mjs` 6 + `health-route.test.mjs` 5 + `live-project-ui.test.mjs` "the health destination mounts the sibling view or the honest unavailable panel" + `ui-shell.test.mjs` "the health destination renders in the Workspace group with the pulse glyph" |
| Execution: nested run graph + timeline, verifier steps, retry history, blocked joins | Execution destination (bound run) | [T] `execution-view.test.mjs` "nested execution and timeline render the two required fixtures …"; `live-execution-model.test.mjs`; [L] live harness action `browser:blocked-join` |
| Run controls (Work / Verification / Plan edits) for the bound run | Execution destination → "Run verification and plan editing controls" disclosure | [L] `qa/ui-live-browser.mjs` end-to-end pass ×2 this task (26 actions each) |
| Git & metrics: worktrees, commits, dirty snapshots, PR subjects, T10 arithmetic | Git destination → lazy load ("Load Git and metrics") | [T] `git-metrics-view.test.mjs` "git and metrics detail views render real T11 collections and T10 arithmetic exactly" + adversarial cases |
| Evidence: paginated library, safe previews, cross-links, distinct missing/moved/inaccessible states | Evidence destination → lazy load; research "Open in Evidence" item nav | [T] `evidence-view.test.mjs` "evidence browser paginates honestly …"; `ui-shell.test.mjs` "evidence items navigate in place and restore their surface on reload" |
| Research: findings, registered-source reader, artifact links, promotion link honesty | Research destination | [T] `live-project-ui.test.mjs`; `evidence-view.test.mjs` adversarial "research authority … fail closed" |
| Macro map: graph mode (default zoom) + list equivalent (narrow) | Overview map section; Graph/List segmented control; ≤48rem auto-list | [T] `overview.test.mjs` "narrow list equivalent keeps full labels and keyboard traversal"; `project-map-fixtures.test.mjs` |
| Contributing-record ids interactive (plan/gate-check routing; honest no-route) | Records lists (dock) | [T] `overview.test.mjs` "contributing-record ids are interactive: routed ids open, unroutable ids stay honestly unavailable" |
| Explicit unavailable state for a destination without data | Any destination with no mounted view/data | [T] `ui-shell.test.mjs` unavailable-panel coverage; [L] `T8/empty-project-probe.json` (all 8 destinations on a zero-record project) |
| Not-initialized pre-init page (IO-2 byte-identical baseline) | Served `/` before project init | [T] `ui-shell.test.mjs` "pre-init stays the IO-2 baseline …"; `overview.test.mjs` "project destinations are absent pre-init and present post-init (IO-2)" |

## Served run dashboard (authenticated)

| Capability | Entry point | Proof |
| --- | --- | --- |
| Work view (graph/list), blocked joins, CAS conflict draft retention | "Bound run dashboard" section (Work tab) | [L] live harness actions `browser:blocked-join`, `browser:conflict-draft-retained` (×2 passes) |
| Verification view: rows, evidence links, authenticated previews | Verification tab | [L] live harness `trusted:execute-distinct-verify` + evidence preview dialog |
| Plan edits: criterion/scenario/queue editing through the authority route | Plan edits tab | [L] live harness `browser:criterion-scenario-pending`, `browser:queue-create-edit-reorder` |
| Disconnect → restart-same-port → reauth continuity (draft, FOCUS, scroll, queue) | Automatic on service restart | [F][L] live harness `browser:same-origin-restart-continuity` — focus restore was dead before V2-T8 (fix in `ui/index.mjs`) |
| Responsive 390px + reduced-motion + zero console errors | Resize/emulation | [L] live harness `browser:representative-responsive-motion` |

## Demo / QA pages (dev fixtures — deliberately NOT served routes)

`RELEASE_NOTES.md` records the live probe: the unmanifested standalone pages answer 404
on the authenticated service; they are opened from the source tree over a local static
server. All nine load headless with zero console errors this pass ([L] `T8/demo-smoke/demo-smoke.json`).

| Page | Status | Proof |
| --- | --- | --- |
| `project-shell.html` (standalone shell, `?state=uninitialized`) | reachable | smoke: mounted, `shellReady` dataset marker |
| `project-map-spike.html` | reachable | smoke: "Spike ready." |
| `architecture-demo.html` | reachable | smoke: "Architecture fixture ready." (T17-generated fixture) |
| `component-demo.html` | reachable | smoke |
| `evidence-demo.html` | reachable | smoke: "Evidence fixture ready." |
| `execution-demo.html` | reachable | smoke: "Execution fixture ready." |
| `git-metrics-demo.html` | reachable | smoke: "…fixture ready inside the app shell" |
| `health-demo.html` | reachable | smoke (recorded snapshots incl. broken-tree WARN) |
| `showcase.html` | reachable | smoke: "Component examples ready."; [T] `ui-library-tokens.test.mjs` |

## Orphan hunt — explicit dispositions

| Suspect | Finding | Disposition |
| --- | --- | --- |
| `ui/editor-page.mjs` (`mountEditorPage`) | Standalone browser binding never referenced by any page/module (since T15); flagged unreferenced in v1 | [D] Zero functional loss: the same editor over the same served routes (`/api/project*`) is reachable as the Project destination (`project-live-views.mjs` → `createProjectEditor`; 28 `editor-views` cases + live-project-ui). File stays because it is hash-pinned in `dashboard.vendor.json`; deletion belongs to the V2-T7 family repin (removing it mid-run would break the six-repo pins). |
| `compactLiveOverview` V1→V2 rewrite drops | V1 moved statement/coverage text and a metric-definitions list into the disclosure; V2 rides them as tooltips and keeps the attention queue fully visible | [D] Intentional per V2-T4 decomposition; pinned by `overview.test.mjs` "walls of meta text are gone: caveats ride tooltips and one polite announcer". The attention queue is MORE reachable than in v1 (was inside the disclosure). Hero identity chips ride the disclosure because the shell context line duplicates them. |
| Functions losing entry points at de-tabbing (v1 T20a) | Item tabs replaced by in-place item navigation + back stack; `createTabs` retained in the library (demo pages still mount it) | [D] Intentional layout v3; tab-era keyboard extras (⌘W close-tab) retired with the strip. Reachability held: every item flow has a tested in-place route. |
| Legacy `#theme` select (v1 T1 "hidden-while-framed") | TWO visible theme controls whenever the shell was mounted but uninitialized | [F] One home decided: the top-bar toggle owns theme whenever the shell is mounted (framed OR chrome-less pre-init — `renderUninitialized` now suppresses too); the select remains the home only pre-connect. |
| V2-T1 density switch removal | Density now follows the rail; `theme-init.js` derives it pre-paint | [D] By design (V2-T1); pinned by `ui-shell.test.mjs` "density follows the collapsed rail automatically …" |
| V2-T3 graph viewport button cluster removal | Pointer pan/zoom + keyboard retained | [D] By design; pinned by `ui-native-graph-motion.test.mjs` |
| V2-T4 dock-overlay rework of inspector/records regions | Both regions adopted into the floating dock; overview keeps its own records panel host | [T] dock adoption tests (see Shell table) |
| `native_adoption` (queued/received/consumed trail, §14 step 6) | Never rendered in any UI era | [F] Surfaced on attention rows this task (open-reconciliation detail + adoption-pending rows); see Destinations table |

## Original-plan §14 cross-check

All 17 scenario steps were re-walked against the current UI; the full log with per-step
entry points and proofs is `T8/section-14-walk.md` (evidence dir; summarized here).
16/17 steps walk in the current UI with named proofs; the one step that had regressed
below the spec (step 6, native consumption trail) is restored in V2-T8; step 14's
research→proposal promotion affordance renders as honest informational text (the
promotion itself is a command-route action by design — dispositioned, not lost).

## Environment notes for reproduction

- Service-backed suites invoke `python3`; macOS CommandLineTools 3.9 lacks
  `typing.TypeAlias` (queue-bridge/dashboard-bridge need ≥3.10). Run suites with a
  `python3 → 3.12` shim first on PATH (documented in `T8/env-notes.md`; the recorded
  failure mode without it is exit 65 `SERVICE_FAILURE` at service start).
- The four fixture-backed demo pages need their `*-fixture.json` generated by the view
  suites (`T17/T18/T16/T19_EVIDENCE_DIR`) — procedure in the demo-smoke evidence.
- `qa/ui-live-browser.mjs` additionally needs a Chrome binary and the omowright module
  path (both recorded in the evidence).
