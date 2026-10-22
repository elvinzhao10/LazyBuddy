# LazySeries family design language

One design language across the whole LazySeries family. Every product — LazyBuddy, LazyTrae, LazyQoder, LazyZCode, LazyKimi, LazyDeepSeek — renders the same dashboard core with its own accent. The dashboard should feel like a native macOS tool that a thoughtful engineer would trust: quiet surfaces, deliberate hierarchy, honest status. It must look designed, not generated.

`tokens.css` is the single source for every color, size, spacing, radius, shadow, motion and density value in the family. Views consume custom properties; they never copy literals. `test/design-tokens.test.mjs` enforces the invariants below.

## 1. Principles

**Content-first hierarchy.** The screen answers three questions in order — what is happening, what needs attention, what proves completion. One primary statement per view; supporting records collapse behind disclosure. Never present a wall of metadata with equal visual weight: the page heading owns the eye, the status sentence owns the second look, everything else recedes.

**No walls of meta text.** Meta (captions, timestamps, ids, provenance) is `--subtle` ink at caption size, at most one line per fact cluster, wrapped not truncated where content is authoritative. If an explanation needs a paragraph, it goes in the inspector, not the card. Long identifiers wrap (`overflow-wrap: anywhere`) rather than break layout.

**Status is shape + icon + text.** Color is the third channel, never the only one. Every status renders a distinct SVG glyph, a text label, and a fill; the unavailable state is a hollow dashed chip, not a gray one. Finishing execution never paints a task green — green belongs exclusively to applicable verified evidence, and absence/loading never resembles a pass.

**Native macOS-first feel.** System font stack (`-apple-system`, `SF` via system, Segoe UI fallback), system monospace for identifiers only, native buttons/inputs/dialogs/selects, keyboard focus that is always visible while keyboard-traversed, Escape closes the inspector and returns focus. 44px minimum targets. No custom scrollbars, no custom chrome, no web-app framework texture. Depth comes from a restrained elevation ladder, not borders-with-shadows stacked on shadows.

**Family accent discipline.** The product accent marks identity and wayfinding only: the product badge, the active destination, selection intent. It never encodes execution status, verification, or risk — those belong to the five status roles. One accent per screen at a time.

## 2. Color roles

Light and dark are both first-class. `data-theme="light|dark"` on the root records the resolved theme; the showcase resolves appearance before first paint and follows system changes. Since T20-RF the dashboard is dark-first: with no stored preference `ui/theme-init.js` resolves dark before first paint, a stored choice (`light` / `dark` / `system`, persisted under `lazyseries-theme`) always wins, and the `#theme` control keeps all three options.

| Role | Light | Dark | Meaning |
| --- | --- | --- | --- |
| `--bg` | #eef1f6 | #0f1115 | app canvas |
| `--surface` | #ffffff | #171b22 | cards, panels, controls |
| `--elevated` | #ffffff | #1e242e | dialogs, popovers, sticky rails |
| `--inset` | #eceff5 | #12151c | recessed wells, code, quiet fills |
| `--border` | #c6cdda | #363e4c | quiet structural outlines |
| `--hairline` | #e1e5ee | #262c37 | internal dividers, table rules |
| `--text` | #1e2430 | #f2f4f9 | primary ink |
| `--subtle` | #59637a | #a7b0bf | captions, meta, secondary ink |
| `--accent` | #2b54d9 | #8ea8ff | family accent (LazyBuddy cobalt) |
| `--accent-contrast` | #ffffff | #0d1220 | ink on an accent fill |
| `--accent-soft` | #e8edfc | #252d4d | accent wash for identity chips |
| `--success` / `--success-bg` | #16613b / #e4f4e9 | #9fe0b8 / #1d3629 | verified evidence |
| `--warn` / `--warn-bg` | #795000 / #fff2cf | #f2d28a / #3a301c | attention |
| `--danger` / `--danger-bg` | #a02a35 / #ffecef | #ffb3bc / #432530 | failed |
| `--info` / `--info-bg` | #184a96 / #e9f0ff | #9fb9ff / #1f2c46 | active/verifying |

Status chips additionally pair `--stale-ink/--stale-fill` (#68409b / #f3eaff light; #d5b8ff / #33284a dark) and the neutral pair `--neutral-ink/--neutral-fill`. Control boundaries use `--control-edge` (#59616e light, #8f9aa9 dark), distinct from quiet `--border`; interactive edges keep >=3:1 against surface, canvas, raised and selected backgrounds through the `.75` press fade.

**T20-RF depth system (additive).** The reference-fidelity pass reworked the palette into a tinted-canvas + stepped-surface structure — dark canvas #0f1115 under card surface #171b22 and elevated #1e242e (light: tinted #eef1f6 canvas under white cards) — with soft layered `--elevation-*` shadows (resting cards lift on step 1, raised on step 2) and hairline edges carrying the resting outline. App-frame additions: `--icon-nav` (18px sidebar destination glyphs), `--badge-min` (the count-badge pill floor; sidebarNav renders projection-fed `count` badges — zero/absent never paints one), and `--veil` + `--veil-blur` (the frosted sticky page header pinned over the single scrolling content surface). The `#theme` control's accessible behaviour is unchanged; only the default and persistence are new.

Measured contrast (WCAG 2.x, computed in `test/design-tokens.test.mjs`): text on surface/canvas/inset >=13:1; subtle ink >=5.3:1; every status ink on its surface >=4.5:1; every accent pairing in section 6 >=4.5:1. Keyboard focus alone carries the focus color (`--focus` #225bb5 light, #8ea8ff dark; `--focus-ring` is the box-shadow form).

## 3. Type

Five steps, all with paired line-heights; weights 400/600; system stacks only, no external fonts.

| Token | Size | Line-height | Use |
| --- | --- | --- | --- |
| `--type-xs` | 12px (.75rem) | 1.5 | micro labels, dense table headers |
| `--type-sm` | 13px (.8125rem) | 1.5 | captions, chips, meta |
| `--type-md` | 15px (.9375rem) | 1.55 | body copy |
| `--type-lg` | 20px (1.25rem) | 1.3 | section titles |
| `--type-xl` | 28px (1.75rem) | 1.22 | page heading |

Every metric, count, timestamp and clock uses `font-variant-numeric: var(--numeric)` (tabular-nums) so live updates never jitter column edges. Line-height tightens as size grows. Narrow-container body steps up to 1.0625rem per the legacy responsive override. Identifiers render in `--mono`.

## 4. Spacing, radii, density

**8-pt grid.** `--space-1` 8px, `--space-2` 16, `--space-3` 24, `--space-4` 32, `--space-5` 40, `--space-6` 48, `--space-7` 64. `--space-half` (4px) is the only sub-grid step, for icon-to-label nudges. Layout aligns to the grid; component internals may use the half-step.

**Radii.** `--radius-xs` 4px, `--radius-sm` 6px (controls), `--radius-md` 10px (cards), `--radius-lg` 14px (dialogs), `--radius-full` 999px (pills, nav rows). Restrained corners stay: never mix radii on nested boxes more than one step apart.

**Density.** `--density-regular` 16px default gutters; `--density-compact` 8px for dense tables and lists. Control targets: `--density-control` 44px (HIG minimum), `--density-control-compact` 32px for secondary in-table controls.

Legacy `--s1`..`--s8` remain frozen at their v1 values (a 4-pt ladder) until views migrate; do not renumber them.

## 5. Elevation and motion

Four elevation steps, neutral shadows only:

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--elevation-0` | none | none | flat: borders carry the edge |
| `--elevation-1` | 0 1px 2px rgba(16,19,26,.08) | 0 1px 2px rgba(0,0,0,.6) | resting cards on canvas |
| `--elevation-2` | 0 4px 16px rgba(16,19,26,.12) | 0 4px 16px rgba(0,0,0,.55) | popovers, sticky rails |
| `--elevation-3` | 0 12px 40px #10131a33 | 0 12px 40px #00000066 | modal inspector |

`--shadow` is the v1 name for step 3. `--edge-highlight` (inset 1px top light) is available for elevated surfaces that want a quiet bevel. Dialog scrim is `--backdrop` #10131a66.

Motion is feedback, never decoration: `--motion-instant` 80ms hover response, `--motion-fast` 120ms fades, `--motion-base` 200ms panels, `--motion-slow` 320ms large surfaces; `--motion-ease` cubic-bezier(0.2,0,0,1) decelerates entrances. No looping animation, no simulated activity, no edge motion. `@media (prefers-reduced-motion: reduce)` collapses every `--motion-*` duration and the legacy `--fast` to 0ms — the test suite fails if that block disappears.

## 6. Per-product accents

The shell sets `--product-accent`, `--product-accent-soft` and `--product-accent-contrast` by placing `data-product="<runtime>"` (exact `RUNTIMES` spelling from `shared/project/contract.mjs`) on the root or the shell container. Without the attribute the family accent applies. Accents are ink-and-fill pairs: the accent works as text on its surfaces, as a fill under its contrast ink, and inside its soft wash. Intended surfaces: surface, canvas and the soft wash in light; surface, canvas, elevated and the soft wash in dark.

| Product | Light ink / wash / contrast | Dark ink / wash / contrast | Min ratio (measured) |
| --- | --- | --- | --- |
| LazyBuddy | #2b54d9 / #e8edfc / #ffffff | #8ea8ff / #2b3050 / #0d1220 | 5.3:1 |
| LazyTrae | #0e7490 / #e3f5f9 / #ffffff | #53c6d8 / #24363e / #0d1220 | 4.8:1 |
| LazyQoder | #6d28d9 / #ede9fc / #ffffff | #a98bff / #302e44 / #0d1220 | 4.9:1 |
| LazyZCode | #b8470e / #fdefe5 / #ffffff | #ff9c66 / #3c312e / #0d1220 | 4.7:1 |
| LazyKimi | #b81d5d / #fbe4ee / #ffffff | #ff87b3 / #3c2e39 / #0d1220 | 5.2:1 |
| LazyDeepSeek | #4338ca / #e7e7fb / #ffffff | #8f95ff / #2c3044 / #0d1220 | 4.9:1 |

Hues are deliberately spaced (cobalt 224°, teal 192°, violet 268°, burnt orange 21°, rose 336°, indigo 245°) and deliberately distinct in saturation and depth from the five status inks, so an accent badge is never readable as a status chip.

## 7. Do / don't

**Do** lead with a status sentence a human can read aloud: "3 of 7 criteria verified across 2 runs; 1 attention item." **Don't** open a view with a grid of twelve identical metric cards or a paragraph of methodology.

**Do** mark the active destination with the product accent and a text label. **Don't** recolor buttons, links, table headers or status chips with the product accent, and never use the accent to signal success or failure.

**Do** render status as glyph + label + fill from the status roles, keeping "unavailable" hollow and dashed. **Don't** invent new status colors in view CSS, and never let a finished-but-unverified task show green.

**Do** reserve `--elevation-2`+ for transient surfaces and one inspector; keep the resting page at `--elevation-0/1`. **Don't** stack shadows on borders on shadows — if a card needs shouting, fix its hierarchy instead.

**Do** use `--subtle` for provenance and timestamps, tabular numerals for every metric. **Don't** bold meta text to make it "pop", and don't hide authoritative values behind tooltips.

**Do** keep motion under 200ms except large-surface transitions, always with `--motion-ease`. **Don't** animate loops, pulse live indicators, or move focus/selection without user input.

**Do** prefer the 16px density regular for reading surfaces and the 8px compact inside data tables. **Don't** mix densities within one list, and never shrink a primary control below 44px.

## 8. Compatibility and enforcement

The v1 token set (canvas/surface/raised/hover/selected/text/muted/border/focus, the status ink/fill pairs, `--s1`..`--s8`, the four legacy type sizes, `--radius-control/card/pill`, `--control`, `--content/--measure/--card-min/--inspector`, `--fast/--ease`) is frozen as a SET: since T20-RF every alias resolves to the agreed reference-fidelity palette values in `test/design-tokens.test.mjs` (names and structure unchanged), so shipped views restyle wholesale from the tokens while later tasks migrate them to the v2 names. `node --test lazybuddy-plugin/shared/dashboard/test/design-tokens.test.mjs` fails when a frozen alias drifts, the spacing grid breaks, the type scale stops being monotonic, any role or accent pair falls below WCAG AA on its intended surfaces, or reduced-motion stops collapsing durations. Views add no color literals: a new hardcoded hex in view CSS is a defect.

The component contract from the original component system (statusChip/notice/taskCard/field/button/inspector constructors, textContent-only dynamic strings, no fetch or authority in components, one polite status region, bounded inspector scroll ownership) and the shell authority rules (destinations render only after initialization; missing native data renders an actionable hollow state, never a zero metric or fabricated observation) remain binding on every family member.

## 10. Factory hooks: controlled/uncontrolled parity (V2-T9, additive)

Pattern adoption from Mantine's use-* conventions, dependency-free
(`docs/design/pattern-adoption.md` has the full adopted/adapted/rejected
table). The one-shot renderers of §9 remain the static contract; for the three
most-composed components the `create*` factories add owner-updatable state:

| Factory | Value props | Default props | Change callback | Api |
| --- | --- | --- | --- | --- |
| `createStatusChip` | `state`, `label` | `defaultState`, `defaultLabel` | `onStateChange(state, label)` | `{ element, get, getLabel, set(state, label?, { notify }) }` |
| `createCard` | `selected` | `defaultSelected` | `onSelect(value)` | `{ element, get, set(value, { notify }) }` |
| `createDataTable` | `rows` | `defaultRows` | `onRowsChange` (assignable property) | `{ element, get, setRows(rows, { notify }) }` |

Conventions, identical for all three:

- **value prop = controlled**: the owner seeds the value and keeps re-applying
  it through `set`/`setRows`; a controlled `createCard` never toggles itself —
  a click only notifies, the owner decides and re-applies.
- **defaultValue prop = uncontrolled**: the component owns the state from
  creation (a `defaultSelected` card toggles itself on click/Space/Enter).
- **on\*Change fires on factory-applied changes** (and on user interaction
  that the factory applies); `set(value, { notify: false })` is silent — the
  same rule `segmentedControl.setCurrent` has shipped since T11.
- **One handle**: `{ element, get, set }` — DOM updates in place (the data
  table keeps its sticky head and caption across `setRows`), no re-render
  protocol, no framework.
- Interactive factory cards paint `aria-pressed`, `data-selected` and a 44px
  tab stop; display cards (no `onSelect`) stay plain §9 markup.

Accessibility context from the same adoption pass: overlay panels carry
`aria-describedby` dismissal notes (Radix Dialog.Description), Tab loops
inside `data-native-trap` overlays while focus is within them (Radix
FocusScope loop, non-modal), and segmented groups keep exactly one tab stop
(Radix RovingTabIndex) — proven in `test/ui-native-focus.test.mjs` and
`test/ui-native-segmented.test.mjs`.

## 9. Component inventory (T12)

The shared component library (`ui/components.mjs` + the `.lb-*` styles in `ui/style.css`) rebuilds the primitives every view composes from, entirely on the v2 tokens: `statusChip` (seven kinds, each pairing its distinct glyph with a distinct border treatment — neutral hairline outline, active ink outline, verified sealed double edge, attention weighted baseline, failed heavy frame, stale dashed edge, unavailable hollow dashed chip), `card` (header/body/footer slots, density-driven padding, resting border or the `raised` elevation step), `dataTable` (sticky header on `--elevated`, hairline zebra-free rows, tabular numerals on `data-numeric` columns) and `rowList`, `formField` (label + help + inline error slots wired through `aria-invalid`/`aria-describedby`, with `field` keeping the legacy two-slot signature) plus `destructiveAction` (danger styling with a bounded undo affordance on an injectable clock), `graphNode` (state-driven size/border, ellipsized titles that keep their full text in the tooltip, selection as the only product-accent use), overlap-honest `timelineTrack`/`timelineChart`/`assignSublanes` (overlapping intervals stack into sublanes; adjacency shares one), `inspectorPanel` (header/content/footer side overlay at `--elevation-2`, Escape and focus-return through the T11 overlay stack), static `skeleton` (aria-busy, no shimmer loop), `emptyState` (icon + title + one detail line + action) and `metricTile` (tabular value + label + coverage chip, hollow unavailable variant). The app shell composes the same discipline: `sidebarNav` (240px left rail collapsing to a 56px icon rail through the density system — product identity header with the runtime accent wash, destination list with `aria-current` and j/k traversal via the T11 layer, contextual object-tree slot, footer hosting theme + density), `createTabs` (open-item tab strip with a pinned Home, closable items, horizontal overflow scroll, one raised active tab on the inset track, arrow/Home/End and ⌘/Ctrl+1..9 switching consistent with the segmented control, panels that hide rather than destroy so view state survives switches and polling) and `createDockPanel` (collapsible elevation-2 right dock with Escape and focus-return through the T11 overlay stack). `ui/showcase.html` is the acceptance gallery presenting every family in every state; `test/ui-library*.test.mjs` holds the DOM and token contracts (no color/size literals in shared component CSS beyond tokens.css). The shared CSS now uses v2 names throughout; the v1 aliases that remain — `--hover --selected --focus --control-edge --primary-hover --pressed-opacity --neutral-ink --neutral-fill --stale-ink --stale-fill --line --control --icon --sans --mono --content --measure --card-min --inspector` — are what per-view CSS (T14–T19) still consumes and will retire as each view migrates.
