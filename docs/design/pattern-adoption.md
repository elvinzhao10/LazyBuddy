# Design-system pattern adoption (V2-T9) — dependency-free

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

Port the pattern, cite the code, keep the constraint: no runtime packages, no
build steps, no new colors outside `tokens.css`, no motion beyond the token
ladder, aliases preserved so vendored siblings never break. Every adopted row
above is enforced by at least one named test.
