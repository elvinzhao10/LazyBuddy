# Dashboard component system

## 0. Research Log

This B5 component showcase implements the written reference `research/1.4-dashboard-design.md`, especially sections 3, 9 and 10, and P4 of `research/1.4.0-implementation-plan.md`. It is a component acceptance surface, not a live dashboard or execution observation. The reference supplies structure and semantics, not a pixel target.

Bundled references shortlisted: Linear (precise neutral layering), Notion (document hierarchy), Vercel (monochrome controls). Linear was selected for neutral luminance steps, restrained 6/8px corners and compact grouped controls; system typography and the project's semantic colors override its branding. The operational taste guidance applies only where compatible with this dependency-free component brief. Layout guidance contributes wrapping clusters, intrinsic grids and a bounded inspector scroll owner. The external StyleGallery catalog and beui drawer source were attempted on 2026-10-04; both failed DNS (`curl` exit 6). No external screen was observed. No generated visual concept is treated as a reference: this task establishes the specified component/state system before C1 composition. Lazyweb research cannot be observed while its endpoint is unreachable; no screen-derived claims are made.

## 1. Direction and information budget

A calm operational canvas: near-neutral surfaces, crisp type, quiet borders and a raised contextual inspector. The memorable distinction is that finishing execution does not paint a task green. Green belongs exclusively to applicable verified evidence. Showcase examples always carry a visible fixture notice. C1 owns live composition, transport, authority and revision consumption.

## 2. Color tokens

`tokens.css` is the source for all CSS values; consumers use custom properties, not copied literals. `data-theme="light|dark"` on the root records resolved theme. The showcase defaults to System, resolves appearance before stylesheet paint, follows system changes, and offers explicit Light/Dark overrides. The following foreground/fill pairs are deliberately paired and require contrast >=4.5:1.

| Role | Light foreground / fill | Dark foreground / fill |
| --- | --- | --- |
| neutral | #424852 / #eef0f3 | #d4d8df / #282c34 |
| active (executing/verifying) | #184a96 / #e9f0ff | #adcaff / #202f49 |
| verified | #16613b / #e4f4e9 | #a4e2bd / #203a2b |
| attention | #795000 / #fff2cf | #f5d58b / #3d321e |
| failed | #a02a35 / #ffecef | #ffb9c0 / #45272e |
| stale | #68409b / #f3eaff | #d7bbff / #352943 |

Light canvas/surface/raised/hover/selected/text/muted/border/focus: #f5f6f8 / #ffffff / #ffffff / #f0f1f4 / #e5e7ec / #20242b / #59616e / #c7cbd3 / #225bb5. Dark equivalents: #14161a / #1c1f25 / #242831 / #2c3039 / #353b46 / #f1f3f7 / #b0b7c4 / #515966 / #adcaff. Unavailable uses neutral hollow treatment. Structural outlines stay neutral; keyboard focus alone uses the focus color.

## 3. Typography

Control boundaries use `--control-edge` (#59616e light, #919baa dark), distinct from quiet structural `--border`. Control edges require >=3:1 against surface, canvas, raised and selected backgrounds, including the final composited color throughout the .75 press fade. Primary hover uses `--primary-hover` (#424852 light, #d4d8df dark), preserving readable reversed text. Press opacity is `--pressed-opacity: .75`.

System sans (`-apple-system`, BlinkMacSystemFont, `Segoe UI`, sans-serif); system monospace only for identifiers. Type tokens: caption .8125rem, body .9375rem, title 1.25rem, heading 1.75rem; line heights 1.5 and 1.25; weights 400/600. Narrow container body becomes 1.0625rem and caption .9375rem. Text wraps, including unbroken identifiers. No external fonts or downloaded assets.

## 4. Spacing and containment

Space tokens 1–8: .25/.5/.75/1/1.5/2/3/4rem. Control minimum 2.75rem; icon 1rem; border 1px; focus 3px with 2px offset. Content maximum 76rem; readable copy 65ch; intrinsic card minimum 17rem; inspector width 30rem. Document owns showcase scroll. Dialog alone owns its bounded vertical scroll when open; no permanent third column. A 44rem container threshold switches graph preview to an equivalent ordered list. Forms/navigation wrap without horizontal overflow; the actual graph algorithm/pan/zoom belongs to C1.

## 5. Reusable primitives and state inventory

ES module `components.mjs` exports DOM constructors; callers provide data and event callbacks. All dynamic strings enter via textContent. It contains no fetch, state persistence, dispatch, arbitrary HTML, or authority decisions.

| Primitive/API | Required variants / responsibility |
| --- | --- |
| `statusChip({state,label})` | neutral, active, verified, attention, failed, stale, unavailable; text plus distinct SVG glyph |
| `notice({state,title,detail})` | empty, loading, disconnected, pending, conflict, unavailable, stale; semantic notice with next step |
| `taskCard({id,title,execution,verification,progress,selected,onSelect})` | not started/running/finished/failed/cancelled execution; unverified/verifying/verified/failed/stale/unavailable verification; separate rows; selected neutral wash plus square-check SVG and Selected label controlled by aria-pressed |
| `field({label,name,value,multiline})` | named input/textarea, required/invalid/disabled via native attributes; help outside field |
| `button(label,onClick,options)` | default/primary, hover/active/focus-visible/disabled; minimum target |
| `createInspector({title,content})` | closed/open, modal native dialog, Escape/close, focus trap and return to invoking control |
| `element(tag,className,text)` | text-only DOM construction utility |

`showcase.html` and `showcase.mjs` are fixture-only consumers. Inventory: semantic chips; disconnected/empty/loading/pending/conflict/unavailable/stale notices; graph cards and selected task; execution finished but unverified including legacy done; priority; dependency impact/cycle rejection; criterion editor draft/invalid/saved-pending/conflict; scenario; queue draft/ready/held with reorder; unresolved/adopted/superseded decision; inspector and long content. Showcase interactions alter only local examples, explicitly reporting simulated results. C1 must supply authoritative adapters and must never infer applied from a local button.

## 6. Interaction and motion

Focus is immediate. Controls use a 120ms ease-out opacity transition; pressed controls reduce opacity, never change semantic color. Inspector uses native dialog focus management and closes immediately on Escape; close restores the connected invoking element. No simulated activity animation or looping edges. Reduced motion sets transitions to 0ms. No changes to selection or viewport without user input. Disabled editing includes an adjacent reason. Draft cancel resets only the showcase form; saved edits require a new authoritative amendment in C1.

The long-content toggle visibly states “Long content: On/Off” as well as aria-pressed. Hover changes neutral fill on every enabled button, including primary actions; disabled controls do not animate. Selection uses a square-check outline distinct from the circular verified glyph. B5-R1 keeps the existing interaction mechanism; the beui button reference remains unavailable in this environment and no external observation is claimed.

The static loading shell paints immediately while the module loads. A permanent status line changes from Loading component examples to Component examples ready without moving the shell controls. Controls remain disabled until their handlers exist; below-shell inventories are revealed together after construction. An asset failure or five-second deadline changes the already visible status to a reload instruction. Completed component content is never hidden or removed for performance scoring.

Inspector scroll ownership: the bounded dialog has an auto header row and minmax(0,1fr) detail row. Only `.inspector-body` scrolls; the close action stays visible above it. The detail region is keyboard focusable, named, and scroll-contained. Native dialog Escape and close still return focus to the invoking card.

## 7. Depth and shape

6px control radius, 8px card radius, pill status radius. Card borders are neutral. Inspector elevation uses a soft neutral shadow (0 12px 40px #10131a33 in light; #00000066 in dark) and dim backdrop #10131a66. Selected cards use a neutral fill with a visible selection glyph/label. Status fill never becomes an accent border.

## 8. Accessibility, acceptance and handoff

Keyboard and reduced-motion users are primary personas. Native labels, buttons and dialog supply keyboard semantics. Status always has text and a glyph; absence/loading never resembles a pass. Focus ring is persistent while keyboard focused. Long labels and unbroken strings wrap; narrow forms have no horizontal navigation. No live-announcement loop. Fixture state changes announce via one polite status region.

Browser evidence must cover light/dark at 390, 768 and 1440 CSS pixels, all fixture state selections, inspector Escape/return, repeated interruption, invalid criterion, cycle rejection, queue reorder and long input. Automated contrast checks measure computed foreground/fill pairs; Node18 syntax checks verify shipped module compatibility. Screen-reader speech and native-host readiness are not observed by this component work. Independent review is owned by the root task and remains required before C1's showcase gate is accepted. No accepted product accessibility debt is claimed.
