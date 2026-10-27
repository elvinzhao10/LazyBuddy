# Design-system pattern adoption (V2-T9) — dependency-free

## Detail panel and app adaptation follow-up, 22 October 2026

The sidebar now owns its retract/expand button, including a working temporary
expansion in narrow panels. Its redundant product/authority footer is removed.
Native thin scrollbars retain keyboard and overflow access. Details is a
labeled action: a wide workspace reserves an adjacent panel, while a narrow
workspace uses a modal drawer with Close, Escape and return focus. A selection
shows either projected object details or contributing records. It no longer
shows prototype rename/run/accept controls. Dismissal survives polling;
retained records resolve against the new projection rather than stale totals.
The optional agent-context disclosure prepares a copyable item/revision
reference without sending a message or claiming execution.

Live-service QA found and repaired three Health integration gaps: the static
asset allowlist, the authenticated connection's detail allowlist/reader, and
the five sibling service routes. Buddy retains its detailed collector; the
other runtimes expose package versions and declared dashboard capabilities
with native host activation explicitly unobserved. Refresh health repeats the
read and provides retry feedback. Embedded plan/research documents preserve
source bytes and anchor IDs while using the shell's heading hierarchy. The
live connection status shares the compact shell bar instead of consuming an
extra header row.

### Installed clients and current upstream evidence

These are read-only local observations, not upgrade or activation receipts.
The six local LazySeries dashboard packages are 1.4.0. Shared UI and endpoint
updates do not install a host client or transfer credentials between clients.

| Adapter | Observed local host | Current evidence and treatment |
| --- | --- | --- |
| LazyBuddy | CodeBuddy CLI 2.124.0; CodeBuddy CN app 4.12.0; WorkBuddy 5.6.2 | The official npm package reports CLI 2.173.0. Current [plugin documentation](https://www.codebuddy.ai/docs/cli/plugins-reference) supports skills, agents, hooks, MCP and LSP. Existing package routes remain distinct from a fresh host activation check. |
| LazyTrae | traecli 0.120.52; Trae CN app 3.3.99 | [Current CLI 2.0 documentation](https://docs.trae.cn/cli_tools-and-extensions) describes plugins, skills and MCP. The installed legacy CLI is not silently relabeled as CLI 2.0; its dashboard adapter and Health route are updated independently. |
| LazyQoder | Qoder CN app 1.10.0; no qoder/qodercli executable found on PATH | [Current CLI hooks](https://docs.qoder.com/cli/hooks) and [app hooks](https://docs.qoder.com/qoder/hooks) describe native lifecycle integration. The app and CLI require separate observation; the dashboard package does not infer either from installation alone. |
| LazyZCode | ZCode app 3.15.3 | [Current hooks documentation](https://zcode.z.ai/en/docs/hooks) retains plugin hooks, permission/tool events and bounded Stop continuation. The package preserves those boundaries; no newest desktop build or fresh session activation is claimed from this version read. |
| LazyKimi | Kimi CLI 0.27.0; Kimi app 3.2.3 | The official kimi-code npm package reports 1.0.11. [The migration guide](https://www.kimi.com/code/docs/en/kimi-code-cli/guides/migration.html) describes the Node.js rewrite and explicitly excludes old plugins and authorizations from migration. Automatic migration would not establish current plugin readiness. |
| LazyDeepSeek | dsh 0.2.0-rc.2 installed | [Upstream 0.2.1-rc.2](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.2) adds current model and Search/Fetch support. The LazyDeepSeek source package now pins that version and passed its real SDK configuration/registration checks in an isolated install. The installed host remains separate; no credentials or profile were changed. |

The isolated authenticated QA workspace uses native queue activation, original
source registration and a linked native run. Browser inspection exercised the
live Health collector and Refresh, original plan reader, linked-run navigation,
and the retained verification/editing controls. It remains a disposable QA
workspace rather than the user's actual project status or a native host
activation receipt.

## Dashboard usability follow-up, 22 October 2026

The open standalone `project-shell.html` is a recorded projection preview. It
does not mount the authenticated service's Project, Plans, Health, Execution,
Git, Evidence or Research adapters. Those explicit unavailable states are not
proof that the live implementation is absent. `reachability-matrix.md` names
the existing live entry points; current native-host readiness still requires
observation in the selected host.

The follow-up repairs the overview's decision path: current status, three
actionable attention records with remaining-count disclosure, a readable map,
then lifecycle and supporting metrics. Historical plans stay in the map but
execution-readiness blockers no longer crowd the action queue. Known blocker
codes have plain-language explanations; unknown codes remain visible. Visible
zoom, actual-size and Fit actions complement keyboard navigation. The map
starts at 100% rather than shrinking labels to fit a tall graph. Metadata and
the edge legend use disclosure, and reload closes an inspector whose selected
record was not restored. The app frame also removes inherited section/header
margins that wasted vertical space.

| Resource considered | Suitable adoption for this dashboard |
| --- | --- |
| [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | Use its accessibility, responsive-layout and interaction checklists as review inputs. Validate outcomes on real dashboard states rather than choosing a generic dashboard template. |
| [Awesome Design Tools](https://github.com/goabstract/Awesome-Design-Tools) | A discovery index for a specific unresolved need; it is not itself a component system to install. |
| [shadcn/ui](https://ui.shadcn.com/docs) | Keep owned, composable components and consistent token-driven variants. The existing DOM factories already provide that ownership model. |
| [Radix accessibility guidance](https://www.radix-ui.com/primitives/docs/overview/accessibility) | Carry keyboard navigation, accessible state and focus management into the existing native controls. Verify Escape and return focus on the actual inspector. |
| [daisyUI](https://daisyui.com/docs/install/) | Its Tailwind plugin would add a styling pipeline to this offline ESM package. Retain the existing shared tokens and component classes. |
| [Mantine](https://mantine.dev/getting-started/) | Its React component stack would require a framework migration. There is no demonstrated dashboard requirement that warrants that migration in this repair. |

Verification for this follow-up: 461 dashboard tests pass with Python 3.12 on
PATH; 32 browser captures cover eight destinations at 390px and 1440px in both
themes without document overflow. The preview reports no browser console
errors. These checks establish local package behavior and preview usability;
they do not establish live-host activation, live project freshness, or a new
authenticated end-to-end run.

**Date:** 2026-10-22. **Scope:** the shared component layer only
(`lazybuddy-plugin/shared/dashboard/ui/components.mjs`, `style.css`, `views.css`,
`tokens.css` value-level additions, `showcase.mjs`). Every adoption below is a
PATTERN ported into our vanilla ESM+CSS library — never a package. Runtime
dependency adoption itself is **rejected** for the whole family: the dashboard
is vendored byte-identically into six sibling repos and must run offline, so no
npm/runtime package (shadcn/ui, Radix, daisyUI, Mantine or any other) may enter
the tree. Each row cites the implementing code so a reviewer can diff the claim
against the tree.

## shadcn/ui — visual conventions

| Pattern | Verdict | Implementation |
| --- | --- | --- |
| Neutral token pairs, calm defaults (one raised "current" surface on an inset track) | adopted | The segmented current segment is the single raised surface: `style.css` `.lb-segmented button[aria-pressed='true']` (surface + `--border` + `--elevation-1`); the legacy `--selected` fill override in `views.css` was RETIRED (it repainted the same control from a second source of truth — see the daisyUI section). |
| Subtle 1px borders + soft shadows (border carries the resting edge, shadow carries lift) | adopted | Resting cards keep `--border` + `--elevation-1` (pre-existing); V2-T9 adds the quiet 1px inset bevel ahead of every elevated overlay's shadow — `--edge-highlight` now leads `box-shadow` on `.native-overlay`, `.lb-inspector`, `.lb-dock`, `dialog` and the raised card step (`style.css`). |
| Small-caps section labels | adopted | New token `--tracking-caps: .08em` (`tokens.css` §3d, additive); table captions and sidebar group labels render uppercase micro-labels (`style.css` `.lb-table caption, .lb-sidebar-group-label`). |
| Calm hover states (no movement, quick quiet fill) | adopted | Plain buttons now fade `background-color` at `--motion-instant` (80ms) instead of snapping (`style.css` `button` rule); no hover transform was added anywhere. |
| Consistent 8px rhythm | adopted (already held) | The `--space-*` 8-pt grid and density tokens already cover the shared CSS; `test/design-tokens.test.mjs` + `test/ui-library-tokens.test.mjs` keep enforcing it. No new off-grid values entered with this task (the only literal added is the `.08em` tracking token, a type metric, not spacing). |
| Tailwind/CVA utility composition, `cn()` class merge, Radix-slot plumbing | rejected | No build step, no utility classes, no runtime deps (vendored-offline constraint); our token layer + component CSS already centralize the same decisions. |
| Their default blue + radius scale | rejected | The family palette and radii are frozen contracts (DESIGN.md §2/§4, `test/design-tokens.test.mjs` frozen alias set). |

## Radix Primitives — accessibility patterns

Audit of what the T11 layer already implemented, then the gaps closed here.

| Pattern | Verdict | Implementation |
| --- | --- | --- |
| Dialog initial focus | already held / proven | `createOverlayPanel.open()` focuses the first non-close focusable; `inspectorPanel.open()` / `createDockPanel.open({focus:true})` focus the close control; `createInspector.open()` focuses Close. Now test-proven: `test/ui-native-focus.test.mjs` "Tab inside the trapped dock…" (first assertion) keeps the contract pinned. |
| Dialog final focus restore | already held / proven | All four factories return focus to the invoking control on close (detached invokers are honestly dropped). Test-pinned in the same suite ("Escape closes … returns focus to the invoking control"). |
| Dialog focus trap (Tab containment) | adapted (FocusScope `loop`, non-modal) | New Tab branch in `installFocusSystem` (`components.mjs`): when focus is inside the topmost overlay marked `data-native-trap='true'` (overlay/inspector/dock set it by default; `trapFocus: false` opts out), Tab/Shift+Tab wrap within the panel's focusables. ADAPTED, not copied: Radix Dialog is modal; our overlays are non-modal by design (V2-T4), so the loop only engages while focus is already inside the panel — tabbing from the page keeps the native flow (asserted). The `<dialog>` inspector needs no loop: `showModal()` traps natively in browsers. Tests: `ui-native-focus.test.mjs` "Tab inside the trapped dock loops…" and "Tab keeps its native flow outside…". |
| `DialogDescription` (aria-describedby) | adopted | New `wirePanelDescription()` in `components.mjs`: every overlay panel and the dialog inspector carry `aria-describedby` pointing at a clipped `.native-note` INSIDE the panel (dies with it, ids never leak). Default text states the honest dismissal contract ("Press Escape to close; focus returns…"); overridable via `description`, removable with `description: ''`. Test: "every overlay panel carries an aria-describedby dismissal note". |
| Roving tabindex | adopted (parity pass) | `segmentedControl()` now keeps exactly one tab stop (current = 0, others = -1) — the same contract `createTabs` already shipped; the document layer normalizes hand-wired `[data-native-segmented]` groups after each activation. Tests: `ui-native-segmented.test.mjs` "…ships roving tabindex from paint…" + "the document layer normalizes…". Arrow/Home/End activation behavior unchanged. |
| Roving tabindex on content lists | adapted with a recorded reason | j/k list traversal (T11) keeps NATIVE tab order for document-content lists (attention lists, queues, graph nodes): they are page content, not toolbar widgets — every row stays tabbable for sequential AT reading; arrows already pan the graph viewport, so arrow-roving on lists would collide. The two widget-shaped lists (tabs, segmented) are the ones that rove. |
| aria-describedby on icon-only buttons | adopted (coverage closed) | `installTooltips.describe` now covers icon-only buttons named by `title` or `aria-labelledby` as well as `aria-label`, flags nameless icon-only buttons `data-native-unlabeled` (auditable, never invented text), and — via the new `activeDescriber` hook — every overlay `open()` re-describes its subtree, closing the dynamic-content gap (polling-rendered icon buttons inside the dock/inspector now get notes). Test: "opening an overlay re-describes dynamic icon-only buttons inside it". |
| Portal mounting, `DismissableLayer` pointer-down-outside | rejected | No portal system without deps; our overlays are in-flow `<aside>` fixed surfaces. Click-outside dismissal exists only for the narrow dock scrim (deliberate, V2-T4). |

## daisyUI — semantic-class discipline

| Pattern | Verdict | Implementation |
| --- | --- | --- |
| One class = one meaning (additive renames, aliases kept) | adopted | Audit of shared CSS found two dual-purpose names. (1) `.view-switcher` was BOTH the component track and the legacy view-specific override target whose `views.css` rule repainted the current segment `--selected` on top of the shared raised-surface treatment — the component class `.lb-segmented` is now canonical (`components.mjs` segmentedControl emits both), the legacy fill rule is retired from `views.css`, and `.view-switcher` remains a pure alias everywhere. (2) `.graph` named a three-column relation layout (says nothing about columns and collides mentally with `.graph-viewport`/`.work-graph`) — canonical `.lb-relations` added with `.graph` kept as alias (`style.css`). Pinned by `test/ui-library-tokens.test.mjs` "segmented controls have one canonical class…". |
| Variants via data attributes (not variant classes) | adopted (already held, re-asserted) | Status chips, cards (`data-elevation`/`data-selected`), metric tiles (`data-unavailable`), graph nodes (`data-state`), segmented (`aria-pressed`/`data-current`) all variant through attributes; the new factory card follows (`data-interactive`). |
| Component package itself (Tailwind plugin) | rejected | Requires Tailwind + build step; violates the vendored-offline constraint. |
| Theme swatches / color-generator approach | rejected | The family palette is a frozen contract (DESIGN.md §2). |

## Mantine — hook/API conventions

| Pattern | Verdict | Implementation |
| --- | --- | --- |
| use-* factory hooks with controlled/uncontrolled parity | adapted (vanilla factories) | New `createStatusChip`, `createCard`, `createDataTable` in `components.mjs` — the three most-composed components. Convention: `value` prop (`state`/`selected`/`rows`) = owner-managed initial the owner keeps re-applying via `set`; `defaultValue` (`defaultState`/`defaultSelected`/`defaultRows`) = internally managed from creation; `on*Change` fires on factory-applied changes; `set(value, { notify: false })` is silent (same as `setCurrent` on segmentedControl); every factory returns `{ element, get, set }` — DOM updated in place, no re-render protocol. Controlled `createCard`s only notify on click (the owner re-applies); uncontrolled ones toggle themselves. Documented in `ui/DESIGN.md` §10; demonstrated in `showcase.mjs` (factory card + chip + table with a live setRows refresh). Tests: `test/ui-library.test.mjs` factory trio. |
| `use-input-state`-style two-way binding sugar | rejected | No framework reactivity to bind to; the get/set api is the honest vanilla equivalent. |
| Rich component props (icons left/right, `loaderProps`, styles api) | rejected | Our components are deliberately small, text-only DOM primitives (component contract, DESIGN.md §8); slot props (`body`, `footer`, `trailing`, `control`) already cover composition. |
| 100+ component catalog breadth | rejected | The dashboard needs the T12 inventory; breadth for its own sake conflicts with the byte-pinned vendor constraint. |

## Visual clarity pass (dedicated)

Checked across the shared layer: label legibility (>=12px + AA), icon semantics
(every glyph labeled; ambiguous glyphs get tooltips), empty-state wording,
motion restraint (nothing >200ms except graph pan).

**Fixed in owned files this task**

1. Empty-state actions must say what they do: the vague `'Act'` fallback label
   is gone — a config action without `label` now throws `TypeError`
   (`emptyState`, `components.mjs`; test in `ui-library.test.mjs`).
2. Icon-only buttons rendered inside overlays after open (polling content) now
   receive their tooltip/`aria-describedby` notes (the `activeDescriber` hook
   above).
3. Nameless icon-only buttons are flagged `data-native-unlabeled` by the
   describe pass instead of being silently skipped — an auditable probe for
   the residual sweep below.
4. Small-caps micro-labels make table captions and sidebar group labels read
   as section labels, not body text (shadcn row above).
5. The current segment's dual paint (legacy fill overriding the shared
   treatment) made the segmented control the loudest control on the page; it
   is now the calm raised-surface default.

**Verified already compliant** (no change needed): all font sizes resolve to
the type scale whose floor is `--type-xs` 12px; every readable pair passes AA
(`test/design-tokens.test.mjs`); every status glyph pairs with a text label
and a distinct border treatment; motion in the shared layer uses only
`--motion-instant/fast/base` (<=200ms) — `--motion-slow` 320ms is consumed
solely by graph fit/inertia (`graph-viewport.mjs`), the one sanctioned
large-surface exception; reduced-motion collapses everything to 0ms.

**Residual findings — view files (outside T9 ownership, recorded for the
backlog)**

- `ui/editor-views.mjs` (~line 294): the confirm-dialog confirm control is an
  icon-only `button('')` with NO accessible name — needs an `aria-label` in a
  view-owned pass. **CLOSED in V2-T7:** the
  control is now created named (`button('Confirm', …)`) and `ask()` swaps in
  the action-specific `confirmLabel`, so the visible label and the accessible
  name can never disagree — see `audit-results/editors.md` (V2-T7 note).
- Hand-wired Graph/List switchers (e.g. `work-view.mjs`) paint without roving
  tabindex; the layer normalizes them on first arrow interaction, but a
  view-owned migration to `segmentedControl()` would ship it from paint.
- Per-view empty-state wordings were spot-checked and are specific and honest
  ("No records match the filter — Clear the filter or widen the observed
  window"); no vague wording found in the sampled views, but a full per-view
  wording sweep belongs to a view-owned pass.

## Adoption rule (recorded)

### Harness control dashboard continuation

The macro map retains its component and canvas across polling. Revision-only updates do not re-layout or interrupt dragging; changed graph records update the same component while retaining presentation state. Project maps center dependency ranks, follow declared membership edges, and stagger disconnected nodes without inventing relationships. Search reveals nodes without hiding graph data. A full-window HTML dialog, background/middle-button drag, wheel scrolling, Shift-wheel horizontal navigation, pointer-centered Ctrl/Meta-wheel zoom, keyboard controls and the readable-size reset share one viewport state. The dialog provides native modal focus behavior and Escape within embedded browsers; it does not depend on browser-level fullscreen.

Health now inventories individual serving-package skills, MCP declarations, hook definitions and subagent definitions. Kind/name/package-state filters and per-component source disclosures keep the inventory inspectable. Package presence is separate from host enablement, connection and activity; those remain unobserved without matching session receipts. No commands, environment values or credentials are returned from MCP configuration. Maintenance context copies locally and never sends or installs anything. Existing revision-checked Project editing remains the mutation route.

Every native adapter serves authenticated `/api/project/telemetry`. It projects the bound run's tasks, recorded agent attempts, failures, blocked work, source problems and usage reports. Structured provider accounting uses `payload.usage_record` on a native recorded event, in the existing `normalizeUsage` format (`id`, physical `request_id`, accounting `kind`, UTC `observed_at`, numeric/null `usage`, optional request `status`). A final-value record replaces earlier deltas; cached/reasoning subsets and parent aggregates never add twice. No structured records means unreported usage, not zero. Counters describe reported requests in the bound run; they do not claim account-wide spend or host-wide activity. Input/output totals require both fields, while an explicit `total_tokens` is accepted. Malformed records surface as problems.

The existing native append-event path is integration-tested end to end through the authenticated telemetry route: 123 input + 21 output tokens reports 144, with cached input excluded from the addition. Runtime summaries link to Project editing, Plans, Execution/verification, Health, Git and Evidence. Rendering and edits retain the existing authority boundaries.

Port the pattern, cite the code, keep the constraint: no runtime packages, no
build steps, no new colors outside `tokens.css`, no motion beyond the token
ladder, aliases preserved so vendored siblings never break. Every adopted row
above is enforced by at least one named test.
# Long-run visibility audit continuation

The current dashboard extends the established token-driven, dependency-free components. The existing [list-detail spatial contract](https://github.com/changeroa/StyleGallery/blob/main/patterns/split-sidebar/list-detail.md) remains the Plans/Research layout: index before detail, minimum inline constraints, one shell page scroll, bounded desktop index and narrow stacking. No component-library migration is needed for these native controls and source-backed SVG charts.

Implemented: separate execution/required-verification progress, recorded activity and token trends with shared UTC intervals and selectable window, exact-value tables, step/resource provenance, retained-run duration/tool/rerun/rework graphs, scoped cost-history reads across all six native adapters, plan checkpoint/evidence navigation and attention sorting, research search/filter/capture, web references and hash-bound evidence registration. Identical telemetry retains its DOM, and project reads retry once if telemetry and project revisions differ. Local filters and research drafts survive polling.

Provider usage still uses physical-request normalization. Tokens are assigned to each request's latest accounting timestamp, with parent aggregates excluded and cached/reasoning subsets never added. Missing bins stay unknown. Activity means recorded ledger events, not provider calls. Cost outcomes use retained record order because the existing store has no timestamps; fixture validation, execution and unclassified records have separate filters. No efficiency or quality improvement is inferred from a lower duration or call count.

## Producer integration

The authenticated telemetry reader consumes existing native run snapshots; it never scans private host registries or enables hooks. Bound normalized host observations expose tool/MCP, agent, hook and configuration identities where their envelopes report them. A producer can emit the following payload through its native append-event route to associate observations with a task/attempt (append-only and without changing completion authority):

```json
{"runtime_trace":{"kind":"mcp","name":"search","server_name":"docs","task_id":"T1","attempt_id":"attempt:1","worker_id":"worker:1","model":"reported-model-id","settings_profile":"profile:strict","status":"completed","duration_ms":250}}
```

Allowed kinds: `tool`, `mcp`, `agent`, `skill`, `hook`, `settings`. Only bounded identifiers, declared result, nonnegative duration and native ledger provenance reach the UI. Raw prompts, tool arguments, configuration values, environment and credentials are omitted. Missing task/attempt/model/profile identities remain explicitly unlinked or unreported. The latest 200 trace rows and first 200 task summaries are exposed with full counts, while time bins cover the captured run observations. Native ledger retention remains authoritative; the browser does not manufacture a second history.

The existing cost tracker writes `.PRODUCT/state/telemetry/cost-outcomes.json`, retaining at most 20 records. Its present built-in cost producer uses `measurement_scope: fixture-validation`. Real execution producers must explicitly report `execution` and measured values; the dashboard does not relabel fixture data. Reads use each native adapter's bounded, symlink-refusing file authority and expose allowlisted fields only. The store is workspace-scoped, distinct from the bound-run usage series.

## Preservation and remaining scope

Research findings are durable project records. Plan evidence trails use explicit plan/run observation subjects and artifact IDs; title similarity does not create links. Artifact registration retains a reference and hash, not a file copy. Agents should write immutable, versioned artifacts, register them and bind checkpoint observations before compacting or retiring a run. Web references need a retained local artifact when reproducibility matters.

Host event production, enabled/connected components, complete model/settings attribution and account-wide usage still require corresponding runtime evidence. The dashboard cannot reconstruct unrecorded tool use, private settings, overwritten source versions or historical progress states from the latest snapshot. These remain explicit coverage gaps rather than invented healthy states or guessed graphs.
