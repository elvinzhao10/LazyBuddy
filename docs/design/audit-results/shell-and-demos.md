# Design audit results — served shell + demo/QA pages (V2-T7 re-audit)

Filled from `docs/design/design-audit-checklist.md`. Scope: the surfaces that
are not a single view task's page — the served run-dashboard shell
(`ui/index.html` behind the authenticated service) and the standalone
`ui/project-shell.html` frame, plus every demo/QA page under `ui/`. Every
surface was re-walked at the V2-T7 head with this round's changes in place
(compact icon top bar V2-T1, collapse fix + divider section headers V2-T2,
overlay dock + decomposed overview V2-T4, Health destination V2-T5, T8 polish,
T9 pattern adoption).

Method: the full [D]/[T] suites re-run green at this head (459/459
`test/*.test.mjs` — recorded in `evidence/T7/`); the V2-T7 whole-tree static
CSS audit (the shipped `ui-library-tokens.test.mjs` rules applied to every
view stylesheet, not just `style.css`/`views.css`) — 14/14 files CLEAN, one
verified non-finding (`evidence.css` `border-radius:0 var(--radius-sm)
var(--radius-sm) 0` — per-corner composition of the token and zero, the
scale's floor); the 10-page cold-headless smoke with console capture — zero
console errors on every page (`evidence/T7/demo-smoke.txt`); cold captures of
the shell in light + dark + narrow(390) + dock-open and the health page in
four theme/width conditions (`docs/design/captures/shell-v2/`,
`docs/design/captures/health/`).

## Served run-dashboard shell (`ui/index.html`, authenticated service)

| Item class | Verdict | Evidence |
| --- | --- | --- |
| Chrome (S1/S2/S10) | PASS | The compact icon top bar (V2-T1) and the shell frame are covered by `test/ui-shell.test.mjs` (`the V2-T1 compact icon top bar replaces the stacked header`, `section headers are divider rules: hairline + small uppercase label, icon rows, icon-only rail (V2-T2)`, `the frame mounts after init: grouped static sidebar, one content surface, no tab strip, hidden dock`) + `test/ui-native-bootstrap.test.mjs`; `captures/shell-v2/S1-hierarchy-{light,dark}-1440.png` — icon chrome with the badge, labeled destinations, dividers between WORKSPACE/OBSERVATION groups. |
| Collapse + density (S2/S10, V2-T1/T2) | PASS | `ui-shell.test.mjs#density follows the collapsed rail automatically; no user density setting persists` + `#collapse matrix: button, Cmd+B, Ctrl+B, reload restore, <=48rem auto-retract, focus (V2-T2)` (the V2-T2 collapse regression root cause — the <=48rem retract was CSS-only and invisible to the state model — is pinned by the matrix case). |
| Overlay dock (S4/S10, V2-T4/T9) | PASS | `ui-shell.test.mjs#the dock is a floating overlay…` + `ui-native-focus.test.mjs` Tab-loop/trap cases; `captures/shell-v2/S10-overlay-dock-dark-1440.png` with its geometry readout `MAIN=1200px DOCK=392px@1032 dockOpen=true` — main width identical closed/open (readouts for all five shell conditions in `captures/shell-v2/geometry-readouts.txt`). |
| Responsive (S4) | PASS | `captures/shell-v2/S4-responsive-{light,dark}-390.png`; readouts record `SCROLL=390<=390` at both themes (no horizontal overflow). |
| Live behavior (S6/S7) | PASS | `test/service-live-ui.test.mjs` + `test/live-project-ui.test.mjs` over the real service (auth, reconnect focus restore — the V2-T8 fix — polling swap, guards); the V2-T8 live-browser passes stand as the live-service record. |
| Keyboard (S6) | PASS | `ui-native-focus/hit-areas/segmented/density/reduced-motion` suites; Escape-and-focus-return on every overlay (`ui-native-focus.test.mjs`). |

## Standalone pages (demo/QA — deliberately not served routes)

All ten load cold-headless with ZERO console errors (`evidence/T7/demo-smoke.txt`;
fixtures generated through the real view suites, procedure unchanged from V2-T8).

| Page | Verdict | Notes / evidence |
| --- | --- | --- |
| `project-shell.html` (standalone shell) | PASS | Same frame as the served shell; `data-shell-ready` marker in the smoke DOM; the shell captures above mount exactly this frame. |
| `project-map-spike.html` | PASS | `data-spike-ready`; `ui-native-graph-motion.test.mjs` (post-V2-T3 pointer/keyboard viewport); `project-map-fixtures.test.mjs`. |
| `architecture-demo.html` | PASS | T17 record stands (`audit-results/architecture.md`); fixture regenerated this pass; zero console errors. |
| `component-demo.html` (component gallery) | PASS | `ui-library-tokens.test.mjs#the showcase is the acceptance gallery…` + `#the T11 native layer still installs on the rebuilt showcase`; zero console errors. |
| `evidence-demo.html` | PASS | T19 record stands (`audit-results/evidence-research.md`); fixture regenerated; zero console errors. |
| `execution-demo.html` | PASS | T16 record stands (`audit-results/execution.md`); fixture regenerated; zero console errors. |
| `git-metrics-demo.html` | PASS | T18 record stands (`audit-results/git-metrics.md`); fixture regenerated; zero console errors. |
| `health-demo.html` | PASS | Full block this pass: `audit-results/health.md` (two V2-T7 audit fixes applied: single h1; the loading line now hides after mount). |
| `showcase.html` | PASS | T9/T12 acceptance gallery ("Component examples ready." marker in the smoke DOM; factory demos from V2-T9). |
| `index.html` (served shell entry) | PASS | Covered by the served-shell rows above; opened statically it degrades to the honest bounded reconnect notice (smoke: zero console errors, no fabricated content). |

## V2-T7 residuals after this pass (recorded, not blocking)

- Hand-wired Graph/List switchers (e.g. `ui/work-view.mjs`) paint without
  roving tabindex; the T9 document layer normalizes them after the first
  arrow interaction. A view-owned migration to `segmentedControl()` would
  ship roving from paint — left to a view-owned pass (T9 record,
  `docs/design/pattern-adoption.md`, unchanged by decision).
- The recorded health demo snapshot is a dated record carrying the pre-repin
  vendor drift WARN (see `audit-results/health.md` post-audit note).
