# Family design-audit checklist

One audit instrument for every dashboard view in the LazySeries family. It exists so that the per-view redesign tasks (T14–T19) apply the same bar, in the same order, with the same evidence, instead of each inventing its own notion of "looks right". It is grounded in three sources that bind every view:

1. **The family design language** (`lazybuddy-plugin/shared/dashboard/ui/DESIGN.md` + `ui/tokens.css`, T10): 14 AA-verified semantic color roles in light and dark, the 8-pt spacing grid, the five-step type scale, the four-step elevation ladder, motion tokens with a reduced-motion collapse, compact/regular density, and `--product-accent` per product.
2. **The native-experience layer** (T11): keyboard-first navigation via `installFocusSystem`, Escape-and-focus-return on overlays, segmented controls, icon-button naming and tooltips, 44px hit areas, and density persistence.
3. **Web-design-guideline rigor**: every item below is a pass/fail question with an exact verification method — computed contrast, a DOM assertion, or a browser capture. Opinion has no vote.

This file is the checklist **authoring only** (T13a). Per-view application happens after the component overhaul: each of T14–T19 copies Section 12's results template for its view, fills every row, and links its captures.

---

## 1. How the audit runs

Three verification methods, each with a fixed meaning. Every checklist item names at least one.

| Tag | Method | Exact procedure |
| --- | --- | --- |
| **[T]** | Computed contrast / token invariant | `node --test lazybuddy-plugin/shared/dashboard/test/design-tokens.test.mjs`. This suite parses `ui/tokens.css`, rebuilds the cascade per theme and per product, and computes WCAG 2.x ratios. If a view composes a readable pair the suite does not already cover (e.g. a new ink-on-fill combination, or a hover/pressed variant of one), the view task **extends this test** with the pair and re-runs it. An uncovered pair is not a PASS. |
| **[D]** | DOM assertion | A `node --test` case in `lazybuddy-plugin/shared/dashboard/test/` that renders the real view component over `createMiniDom()` (from `test/fixtures/mini-dom.mjs`) and asserts structure, attributes or behavior. Cite the file and the `test(...)` case name as evidence. New assertions live next to the existing `ui-native-*.test.mjs` / `*-view.test.mjs` conventions. |
| **[C]** | Browser capture | Open the view's entry page (its `ui/*-demo.html`, or `ui/project-shell.html` / `ui/index.html` for the shell) in a real browser, set the audit condition via the documented hooks — `data-theme="light|dark"` on the root, `data-density="compact|regular"`, `data-product="<runtime>"` (exact `RUNTIMES` spelling from `shared/project/contract.mjs`), viewport width 390 or 1440 — and capture a PNG. |

**Capture reference convention.** Captures land in `docs/design/captures/<view-slug>/` and are named `S<nn>-<item>-<tags>.png`, where tags combine `light`/`dark`, `regular`/`compact`, `390`/`1440`, and the product name when accent behavior is in scope. Example: `captures/work/S4-LA1-dark-390.png`. A capture referenced in a results row must exist at that path in the same commit; a dangling reference is itself a FAIL of S12 discipline.

**Minimum capture set per view** (items may demand more): S1 hierarchy in `light-1440-regular`; S3 status chips in `dark-1440-regular`; S4 both widths in both themes (`390` and `1440`, `light` and `dark`); S7 each rendered state (loading, empty, error, unavailable) in `light-1440-regular` plus `dark-1440` for one of them; S10 overlay elevation in `dark-1440` and density side-by-side (`regular` vs `compact`).

**Verdicts.** A section is **PASS** when every item in it passes with cited evidence. It is **FAIL** when any item fails — there are no partial passes. It is **N/A** only when the view genuinely lacks the element class (e.g. a view with no form fields may N/A Section 8), and the results row must say why in one line. "Looks fine" is not a verdict; every PASS cites at least one [T], [D] or [C] reference.

---

## 2. S1 — Hierarchy & typography

| Item | Pass/fail question | Method |
| --- | --- | --- |
| TY-1 | Does the view render exactly one `h1` (the page heading), with section titles as `h2` and no heading promoted for emphasis? | [D] count `h1`/`h2` in the rendered view; assert `h1 === 1`. |
| TY-2 | Do heading levels proceed in order (h1 → h2 → h3) with no skipped level anywhere in the DOM? | [D] walk headings in document order; assert no jump > 1. |
| TY-3 | Does every font-size in the view's CSS come from the type tokens (`--type-xs..--type-xl`, or the frozen v1 aliases `--caption/--body/--title/--heading` until that view migrates), with no new size literal? | [D] static audit of the view's CSS: every `font-size` resolves to a `var()` of a type token. Record which name set the view still uses. |
| TY-4 | Does every metric, count, timestamp and clock render with `font-variant-numeric: var(--numeric)` (tabular-nums), so live updates never jitter column edges? | [D] for every rendered metric/clock element, assert the computed style carries the numeric variant. |
| TY-5 | Do identifiers render in `--mono`, and do long identifiers wrap (`overflow-wrap: anywhere`) instead of truncating or breaking layout? | [D] assert class/style on identifier nodes plus the wrap rule in the view CSS. |
| TY-6 | Is there one primary statement per view — page heading first, one readable status sentence second, everything else receding — with no opening grid of identical metric cards or methodology paragraph? | [C] `light-1440-regular`; reviewer confirms the order: what is happening, what needs attention, what proves completion. |
| TY-7 | Are the only font weights 400 and 600 (`--weight-regular` / `--weight-strong` or the frozen `--regular/--strong`)? | [D] static audit of the view's CSS for `font-weight` values. |

## 3. S2 — Spacing & alignment

| Item | Pass/fail question | Method |
| --- | --- | --- |
| SP-1 | Is every layout spacing value an 8-pt multiple via `--space-1..7` (or frozen `--s1..--s8` until migration), with `--space-half` (4px) appearing only for icon-to-label nudges? | [D] static audit of the view's CSS: each `padding`/`margin`/`gap` resolves to spacing tokens; flag any raw value that is not an 8-pt multiple or the 4px half-step. |
| SP-2 | Do all cards of the same class share one padding, driven by the density gutter (`--density-gutter`: 16px regular, 8px compact), so no card is quietly 1–4px off its siblings? | [D] render two cards of each class in both densities; assert equal computed padding. [C] `regular` vs `compact` side-by-side. |
| SP-3 | Do card edges, rails and columns align to one grid at wide width — no half-pixel or 1–2px drift between adjacent containers? | [C] `light-1440-regular`; inspect edges in the capture. |
| SP-4 | Does every corner radius come from `--radius-xs..--radius-full` (or frozen `--radius-control/card/pill`), and do nested boxes never differ by more than one radius step? | [D] static audit of `border-radius` in the view's CSS plus the nesting check on rendered structure. |
| SP-5 | Does compact density shrink only gutters inside data tables/lists — never a primary control target, and never mixing densities within one list? | [D] assert table/list gutters switch with `data-density` while control heights stay at `--density-control`; assert one density per list. |

## 4. S3 — Color & contrast

| Item | Pass/fail question | Method |
| --- | --- | --- |
| CL-1 | Does the view's CSS contain zero color literals — every color is `var()` of a semantic role (a new hardcoded hex/rgb in view CSS is a defect by DESIGN.md §8)? | [D] static audit of the view's CSS for hex/`rgb(`/`hsl(` literals. |
| CL-2 | Is each role used for its meaning only — status via the status ink/fill pairs, surfaces via `--surface/--elevated/--inset`, quiet structure via `--border/--hairline`? | [D] assert the rendered status/structure classes resolve to the correct role vars. |
| CL-3 | Does every readable pair the view composes hold WCAG AA (>= 4.5:1; >= 3:1 for interactive edges) **in both themes**, including hover, the `.75` press fade, and disabled text — as computed by the design-tokens suite, extended if the view composes an uncovered pair? | [T] run `node --test .../test/design-tokens.test.mjs` with the view's pairs covered; cite the case names. |
| CL-4 | Is status never color-only: every status renders a distinct glyph + a text label + a fill, and is "unavailable" a hollow dashed chip rather than a gray or green one? | [D] assert each status chip node carries glyph, label and fill class; assert the unavailable chip is hollow/dashed. [C] `dark-1440-regular` chip strip. |
| CL-5 | Does the product accent appear only on identity and wayfinding (product badge, active destination, selection intent) — never on buttons, links, table headers or status chips — with one accent on screen at a time? | [D] with `data-product` set to a non-default runtime, assert accent var usage is confined to identity/wayfinding selectors. [C] one capture with `data-product="LazyKimi"` to prove the accent swaps and nothing status-like recolors. |
| CL-6 | Do interactive edges (`--control-edge` and view-composed equivalents) keep >= 3:1 against surface, canvas, raised and selected backgrounds through the press fade, in both themes? | [T] covered pairs cited; [D] for any view-composed edge combination not in the suite, extend the suite (same rule as CL-3). |

## 5. S4 — Layout & responsiveness

| Item | Pass/fail question | Method |
| --- | --- | --- |
| LA-1 | At 390px width in both themes: no horizontal clipping or page-level overflow, no truncated authoritative values, long identifiers wrapping rather than breaking layout? | [C] `390` × `light` and `390` × `dark`; check `document.scrollingElement.scrollWidth <= innerWidth` at capture time and record the number. |
| LA-2 | At 1440px: content respects `--content` (76rem) and prose respects `--measure` (65ch) — no unreadable stretched lines and no crammed rails? | [C] `1440-light-regular` and `1440-dark-regular`. |
| LA-3 | Do the inspector and dialogs hold their bounds (`--inspector` 30rem; cards at least `--card-min`), and does the inspector go full-bleed below its min without losing Escape or focus-return (cross-ref IK-3)? | [D] assert width bounds on rendered panels; [C] `390` capture with inspector open. |
| LA-4 | During a live/polling refresh tick, is the user's selection preserved — the selected row/segment/task stays selected and in view, with no scroll jump? | [D] render the view, select, deliver a model update, assert selection identity survives; [C] one capture mid-refresh if the view polls. |
| LA-5 | Does nothing overlap or z-fight at either width — overlays sit above a scrim, sticky rails above cards, and no two resting elements share a stacking context? | [C] both widths; open one overlay per view that has one. |

## 6. S5 — Motion

| Item | Pass/fail question | Method |
| --- | --- | --- |
| MO-1 | Does every transition/animation in the view's CSS use `--motion-*` durations with `--motion-ease` (or frozen `--fast/--ease` until migration) — no raw `ms`/`s` literals? | [D] static audit of the view's CSS for transition/animation timing values. |
| MO-2 | Is all motion feedback and none of it decoration — no looping animation, no pulsing live indicators, no edge motion, no focus/selection movement without user input? | [D] assert no `infinite` iteration in view CSS; [C] review the view's animated interactions in the capture session. |
| MO-3 | Under `prefers-reduced-motion: reduce`, does every animation the view performs collapse to zero duration — the tokens block exists (suite-enforced) **and** the view adds no motion outside the tokens? | [T] design-tokens suite reduced-motion case passes; [D] no view-level animation bypasses `--motion-*` (follows from MO-1/MO-2, cite both). |
| MO-4 | Are durations under 200ms except large-surface transitions, which stay <= 320ms (`--motion-slow`)? | [D] follows from MO-1 with the token set; cite the CSS audit. |

## 7. S6 — Interaction & keyboard

| Item | Pass/fail question | Method |
| --- | --- | --- |
| IK-1 | Is every control reachable by Tab in a reading order that matches the visual order, with no `tabindex` above 0 anywhere in the view? | [D] drive `installFocusSystem()` over the rendered view; assert the tab walk visits every interactive element once, in order. |
| IK-2 | Is focus always visible while keyboard-traversed (the token focus ring / `--focus-ring`), with no `outline: none` that lacks an equivalent visible replacement? | [D] assert focus-visible styling resolves to the focus tokens; [C] one capture with focus ring shown on a mid-view control. |
| IK-3 | Does Escape close the open inspector/overlay and return focus to the control that invoked it — for every overlay the view can open? | [D] for each overlay: open, press Escape, assert `open` is false and focus returned to the invoker (the T11 `ui-native-focus` pattern). |
| IK-4 | Are there no keyboard traps, and do segmented controls respond to ArrowLeft/ArrowRight with wrap, Home/End jumps, and disabled segments skipped? | [D] the `ui-native-segmented` assertions against every `data-native-segmented` group the view renders; walk the view's focus scope backwards (Shift-Tab) to the start. |
| IK-5 | Does every primary interactive target measure at least 44px (`--density-control`), with 32px (`--density-control-compact`) only on secondary in-table controls? | [D] measure rendered control boxes in both densities; [C] the density side-by-side capture. |
| IK-6 | Where the view has a filter, does `/` focus it, and do single-key shortcuts not fire while typing in an input? | [D] the T11 focus-system `/` handler over this view's filter, if present; otherwise N/A with a one-line note. |
| IK-7 | Does the view use exactly one polite status region (`data-native-announcer`), with announcements bounded and no duplicate live regions? | [D] assert one announcer, `aria-live="polite"`, and that model updates announce at most one bounded sentence. |

## 8. S7 — States

| Item | Pass/fail question | Method |
| --- | --- | --- |
| ST-1 | While data loads, does the view render skeletons or a bounded spinner — never a zero metric, a healthy-looking empty table, or fabricated placeholder observations? | [D] render with a pending model; assert skeleton nodes and no zero-as-value rendering. [C] loading frame. |
| ST-2 | Is the empty state actionable — it says what will fill the view and how to make that happen, rather than showing a blank canvas? | [D] assert the empty-state node contains a label and a next step; [C] empty frame. |
| ST-3 | Does the error state name the failure and offer a retry or next step, with the message visible (not only logged or only color)? | [D] render with a failed source; assert the error notice text and action. [C] error frame. |
| ST-4 | When native data is missing, does the view render the explicit unavailable state (hollow, dashed — cross-ref CL-4) instead of reporting zero as if it were a healthy measurement? | [D] render with the unavailable fixture; assert the hollow state and that no metric shows `0` for it. [C] unavailable frame. |
| ST-5 | Does every disabled control explain why — via `title`/`aria-describedby` note — rather than sitting silent? | [D] assert each disabled interactive node carries a name plus a note reference (the T11 hit-areas pattern). |

## 9. S8 — Forms

| Item | Pass/fail question | Method |
| --- | --- | --- |
| FO-1 | Does every input/select/textarea have a programmatic label (`<label for>` or `aria-label`), with no placeholder doing label duty? | [D] assert each field's accessible name; assert placeholders are format hints only. |
| FO-2 | Are validation errors inline next to their field, specific (naming the field and the problem), announced by the polite region, and never color-only? | [D] submit an invalid value; assert the inline message, its association (`aria-describedby` or label), and the announcement. [C] one form-error frame if the view validates. |
| FO-3 | Does every destructive action offer undo or an explicit confirm, and does it style with the danger role rather than the product accent? | [D] assert the confirm/undo path and the danger class on each destructive control. [C] confirm-dialog frame for the primary destructive action. |
| FO-4 | Are form controls the platform's own (native `input`, `select`, `button`, `dialog`) rather than custom reimplementations? | [D] assert tag names for every field/control; flag any `div`-based control. |

## 10. S9 — Content

| Item | Pass/fail question | Method |
| --- | --- | --- |
| CO-1 | Is there no wall of meta text: meta renders at `--type-sm` in `--subtle`, at most one line per fact cluster, wrapped not truncated, with paragraphs living in the inspector instead of the card? | [C] `light-1440-regular`; [D] assert meta nodes' computed size/color and that no card body exceeds its one-line-per-cluster budget. |
| CO-2 | Is the language plain — can the lead status sentence be read aloud as a human sentence ("3 of 7 criteria verified across 2 runs; 1 attention item")? | [C] reviewer reads the lead sentence from the capture; a sentence needing parsing to understand is a FAIL. |
| CO-3 | Are labels honest — the words match what the system actually did, no "verified" wording on unverified work, no fabricated observations, and finishing execution never reads as a pass? | [D] assert status wording matches model truth for each status fixture; [C] review against a mixed-status capture. |
| CO-4 | Are authoritative values visible without interaction — tooltips supplement information instead of carrying it? | [D] assert the T11 pattern in reverse: critical values are not inside `title`/`aria-describedby`-only nodes. |

## 11. S10 — Native feel

| Item | Pass/fail question | Method |
| --- | --- | --- |
| NF-1 | Are mode/lens switches rendered as segmented controls (`data-native-segmented`, `role="group"`, `aria-pressed` per segment) rather than button rows or tabs? | [D] assert each switcher is a `segmentedControl` instance with the T11 semantics; [C] visible in the density capture. |
| NF-2 | Do overlays carry elevation (`--elevation-2/3` over the `--backdrop` scrim) while the resting page stays at `--elevation-0/1`, with no border-under-shadow-under-shadow stacking? | [D] static audit of the view's CSS for elevation/shadow values; [C] `dark-1440` with an overlay open. |
| NF-3 | Is the density toggle respected by this view — switching compact/regular changes only gutters (cross-ref SP-5), the choice persists across reload, and the segmented control reflects it? | [D] the `ui-native-density` assertions applied to this view's regions; [C] the side-by-side pair. |
| NF-4 | Does the view use the system stacks only (`--sans` everywhere, `--mono` for identifiers alone), with no external font loaded? | [D] static audit of the view's CSS `font-family` declarations plus no `@font-face`/font URL. |
| NF-5 | Is there no custom chrome: native scrollbars, native dialogs and selects, no web-app framework texture (custom scrollbars, fake title bars, gradient chrome)? | [C] both themes; reviewer inspects the capture for custom chrome. |
| NF-6 | Does wayfinding read natively: the product badge shows the accent, the active destination is marked with accent **and** a text label, and density/theme resolve before first paint (no flash)? | [C] one capture with `data-product` set (cross-ref CL-5); [D] assert the active destination node carries both accent usage and a text label. |

---

## 12. Per-view results template

Each view task (T14–T19) copies the block below once per view it owns, fills every cell, and appends the filled blocks to its own verification note — not back into this file. Every cell cites evidence: a `test/<file>.test.mjs#<case>` reference for [T]/[D], and/or a `captures/<view-slug>/...` path for [C]. An empty evidence cell on a PASS is treated as a FAIL.

```markdown
### Design audit — <view name>

Task: Txx · View slug: <slug> · Entry page: ui/<page> · Date: YYYY-MM-DD · Commit: <sha>

| Section | Verdict | Failing items | Evidence / capture refs |
| --- | --- | --- | --- |
| S1 Hierarchy & typography | PASS/FAIL/NA | — | TY-1..TY-7: <refs> |
| S2 Spacing & alignment | PASS/FAIL/NA | — | SP-1..SP-5: <refs> |
| S3 Color & contrast | PASS/FAIL/NA | — | CL-1..CL-6: <refs> |
| S4 Layout & responsiveness | PASS/FAIL/NA | — | LA-1..LA-5: <refs> |
| S5 Motion | PASS/FAIL/NA | — | MO-1..MO-4: <refs> |
| S6 Interaction & keyboard | PASS/FAIL/NA | — | IK-1..IK-7: <refs> |
| S7 States | PASS/FAIL/NA | — | ST-1..ST-5: <refs> |
| S8 Forms | PASS/FAIL/NA | — | FO-1..FO-4: <refs> |
| S9 Content | PASS/FAIL/NA | — | CO-1..CO-4: <refs> |
| S10 Native feel | PASS/FAIL/NA | — | NF-1..NF-6: <refs> |
```

Run-level rollup — the run lead maintains one matrix; each view task fills its column header with its view name(s) and marks each cell P/F/NA. `P` requires the per-view block above to exist and be complete.

| Section | T14: \<view\> | T15: \<view\> | T16: \<view\> | T17: \<view\> | T18: \<view\> | T19: \<view\> |
| --- | --- | --- | --- | --- | --- | --- |
| S1 Hierarchy & typography | | | | | | |
| S2 Spacing & alignment | | | | | | |
| S3 Color & contrast | | | | | | |
| S4 Layout & responsiveness | | | | | | |
| S5 Motion | | | | | | |
| S6 Interaction & keyboard | | | | | | |
| S7 States | | | | | | |
| S8 Forms | | | | | | |
| S9 Content | | | | | | |
| S10 Native feel | | | | | | |

## 13. Blocking rule

**Any FAIL — on any item, in any section — blocks that view task's completion.** A view task's DoneClaim is admissible only when all ten sections read PASS, or N/A with a one-line justification the task spec accepts. Fixing a FAIL requires: the fix, a re-run of the cited verification (test re-executed or capture re-taken under the same condition tags), and the results row updated in the same commit. The blocking rule also covers audit discipline itself: a dangling capture reference, an empty evidence cell on a PASS, or a pair left out of the design-tokens suite counts as a FAIL of the section that cited it.
