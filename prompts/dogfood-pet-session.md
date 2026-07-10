# Dogfood Session — WorkBuddy Pet (Autonomous Run)

> Paste this into a fresh WorkBuddy session with the lazyworkbuddy plugin enabled.
> Let the agent run freely. Evaluation happens at the end.

---

## Prompt

You are running an **autonomous dogfood session** for the Lazyworkbuddy agent harness. Your goal: build a **WorkBuddy Pet** — a terminal companion that visualizes the real-time health and activity of the Lazyworkbuddy system — then self-evaluate at the end.

### What the pet is

A **WorkBuddy Pet** is a live dashboard pet that reads `.lazyworkbuddy/` state and renders a beautiful terminal visualization. Think of it as a tamagotchi crossed with a system monitor — the pet's mood and stats reflect what's actually happening in the agent harness.

The pet is NOT just decorative. It's a **real consumer of the Lazyworkbuddy state ledger** — it reads events.jsonl, state.json, and the run directory to derive its state. If the harness is healthy (tasks completing, verification passing, reviews accepted), the pet thrives. If things are broken (failures, drift, stuck tasks), the pet suffers.

### What to build

A small **Python package** — not a 350-line god-file. Separate the concerns so each piece is independently testable:

```
pet/
├── __main__.py   # CLI entry — argparse, dispatches the commands below (thin, no logic)
├── state.py      # reads .lazyworkbuddy/: run ledger, events.jsonl, plan.md → raw signal dict
├── metrics.py    # PURE functions: raw signals → System Vitals + pet stats + mood (no I/O)
├── art.py        # MOOD_FRAMES: cute cat art + animation frames (data + a small compositor)
├── spark.py      # tiny sparkline helper: buckets events → ▁▂▃▅▇█
└── render.py     # builds the dashboard string from metrics + art (pure string building)
tests/
└── test_pet.py   # pytest: metrics, sparkline, art selection, state parsing (mock the FS)
```

Pure stdlib only (`argparse`, `json`, `pathlib`, `time`, `unittest.mock`) — runs on the managed `python3`, no `pip install`.

#### Commands

- `python3 -m pet status` — full dashboard (see layout below)
- `python3 -m pet watch` — live mode: refreshes every 2s, cycles animation frames, scrolling feed
- `python3 -m pet feed` — feed the pet (only works if a verified task exists in the current run)
- `python3 -m pet stats` — JSON of every metric + the chosen mood (machine-readable)

#### Dashboard layout (status command)

```
┌─────────────────────────────────────────────────────────────┐
│                WORKBUDDY PET  ·  ENERGIZED                │
│                                                              │
│    /\    /\        RUN PROGRESS  ████████░░ 82%             │
│   /  \  /  \       PASS RATE     ██████████ 100%            │
│  |  ◉  ◉  |       EVIDENCE      ██████████ 100%            │
│  |   \__/  |       AGENT LOAD    ████░░░░░░ 40%            │
│   \  ||  /  -_"_-  HEALTH        ████████░░ 80/100         │
│   /|  ||  |\       TRUST         ██████████ 95/100         │
│  ( |  ||  | )                                              │
│   \|______|/                                               │
│                                                              │
│  ── RUN ─────────────────────────────────────────────────    │
│  dogfood-pet · executing · Build WorkBuddy Pet CLI          │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░  82%   ·   12m 34s            │
│                                                              │
│  ── TASKS ───────────────────────────────────────────────    │
│   T1 structure       ████████████ done · verified          │
│   T2 pet/ modules    ████████████ done · verified          │
│  ▶ T3 mood derivation ██████░░░░░░ running · 60%           │
│  ○ T4 tests           ░░░░░░░░░░░░ queued                  │
│  ○ T5 review          ░░░░░░░░░░░░ queued                  │
│                                                              │
│  ── VERIFICATION ───────────────────────────────────────    │
│  ████████████████████████ 4/4 PASS  (doctor·smoke·verify·sec)│
│  review: ○ pending                                          │
│                                                              │
│  ── ACTIVITY (last 10m) ────────────────────────────────    │
│  tasks  ▁▂▃▅▇█▆▄▂▁   agents  ▏▎▋▍▏   verify  ▂█▁         │
│                                                              │
│  ── EVENT FEED (last 5) ────────────────────────────────    │
│  17:27:03  task_updated   T1 → done                         │
│  17:27:08  verification    passed (all checks)              │
│  17:27:15  plan_checkbox   T1 checked                       │
│                                                              │
│  ── PET LOG ─────────────────────────────────────────────    │
│   Fed on T1 (verified)    boost    idle 45s           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### Pet states (derive from state)

The pet shows **two layers of numbers** — both read from `.lazyworkbuddy/`, never faked:

**System Vitals** (the useful part — real harness metrics, shown as bars in the top panel):
| Vital | Derived from | What it tells you |
|-------|--------------|-------------------|
| RUN PROGRESS | checked plan boxes ÷ total | how far the run has actually gotten |
| PASS RATE | passed verification gates ÷ total | is the work correct |
| EVIDENCE | valid evidence paths ÷ subagent stops | are the claims backed by proof |
| AGENT LOAD | active-agent windows ÷ (active+idle) | how busy the harness is right now |

**Pet stats** (the personality — derived *from* the vitals so they aren't arbitrary):
| Stat | Formula (0–100) |
|------|----------------|
| **Health** | `0.5·PASS_RATE + 0.3·reviewAccept + 0.2·(100 − failurePenalty)` |
| **Trust** | `EVIDENCE` (valid ÷ total subagent stops × 100) |
| **Focus** | `100 − min(100, minutesSinceLastTask·4)`  *(was "Hunger")* |
| **Stamina** | `idleSeconds ÷ (idleSeconds + activeSeconds) × 100`  *(rests when idle)* |

So when PASS RATE drops, Health drops with it; when evidence is missing, Trust craters. The bars mean something.

**Mood** (derived from the stats above) → selects a cat frame set (see ASCII art below):
| Mood | Condition | Expression |
|------|-----------|------------|
| ENERGIZED  | Health>80, Focus>70, Stamina>60 | ears up, big eyes ◉ |
| HAPPY  | Health>60, Focus>50 | eyes `^^` closed, smile, blush, tail wags |
| HUNGRY  | Focus<40 (no task done lately) | eyes on bowl, drool |
| TIRED  | Stamina<30 | half-closed `-`, Zzz |
| CONCERNED  | any verification fail in last 5 events | worried `><` eyes, `?` |
| SAD  | Health<40 | ears flat, teary ◉, frown `/¯\` |
| SLEEPING  | no active run 5+ min | curled, eyes `- -`, Zzz floating |

#### ASCII art requirements — a CUTE, animated cat

Make the pet **adorable and alive**, not a scary blob. Style: a round, front-facing **cat** with triangle ears, big eyes, whiskers and little paws — in the charming, characterful spirit of classic ASCII animals (e.g. the sitting cat on asciiart.website: `// /(/(` ears, `..` eyes, `,_Y/` whiskers). It MUST be **animated** in `watch` mode — not a single frozen drawing.

**Reusable expression parts** (so frames compose, not hardcode):
- **EARS** — `/\    /\` up (alert/happy), `────` flat (sad), droopy for tired
- **EYES** — `◉` open, `^` happy-closed, `-` sleepy, `><` worried, `◉` teary
- **MOUTH** — `\__/` neutral, smile when happy
- **WHISKERS** — `-_"  "_-` either side of the muzzle
- **PAWS** — `( |  ||  | )` at the base
- **ACCESSORIES** — sparkle when energized, food bowl when hungry, `Zzz` when tired/sleeping, music note when happy

**Full art per mood** (what `status` renders — pick the set matching the current mood):

ENERGIZED  — ears up, big eyes, sparkle:
```
   /\    /\
  /  \  /  \
 |  ◉  ◉  |
 |   \__/  |
  \  ||  /  -_"_-  
  /|  ||  |\
 ( |  ||  | )
  \|______|/
```

HAPPY  — eyes closed `^^`, smile, blush, whiskers wiggle:
```
   /\    /\
  /  \  /  \
 |  ^  ^  |
 |   \__/  |
  \  ||  /  -_"_-  
  /|  ||  |\
 ( |  ||  | )  ~
  \|______|/
```

HUNGRY  — eyes on bowl, drool, food:
```
   /\    /\
  /  \  /  \
 |  ◉  ◉  |
 |   \__/  |  
  \  ||  /  -_"_-  
  /|  ||  |\
 ( |  ||  | )
  \|__bowl_|/
```

TIRED  — half-closed eyes, Zzz:
```
   /\  /\
  /  \/  \
 |  -  -  |
 |   \__/  |  z
  \  ||  /  -_"_-  z
  /|  ||  |\
 ( |  ||  | )  z
  \|______|/
```

CONCERNED  — worried eyes, `?`:
```
   /\    /\
  /  \  /  \
 |  >< >< |
 |   \__/  |  ?
  \  ||  /  -_"_- 
  /|  ||  |\
 ( |  ||  | )
  \|______|/
```

SAD  — ears flat, teary, frown:
```
   ──────
  |  ◉ ◉|
  |   /¯\   |
   \  ||  /  -_"_-  
   /|  ||  |\
  ( |  ||  | )
   \|______|/
```

SLEEPING  — curled, eyes closed, Zzz float:
```
     .--.
    /    \    
   ( -  - )   z
   ( \__/ )   z
    \ || /   z
    _\||/_
   /  \  \
  |   \__/ |
   \______/
```

**Animation frames** — in `watch` mode the cat MOVES (loop ≈ 2.5s, frame every ~120ms):
- **blink** (eyes shut one beat): ` |  -  -  | `
- **wag** (tail/whiskers twitch): flip `-_"_-` → `-_~_-`; bottom paws ` ~` bob
- **breathe** (ears rise + torso lift): ` /\    /\` → ` / \  / \`
- **sleep-drift** (the `z` climbs one line each frame, then resets)

Recommended `watch` loop: `[base, base, breathe_in, breathe_out, base, blink, base, wag, base, breathe_in, base]`. Sleeping uses `sleep-drift` instead of wag/blink.

**Data model** — composable, not scattered strings:
```python
# pet/art.py (illustrative)
MOOD_FRAMES = {
    "energized": {"face": [...8 lines...], "wag": False, "blink": True,  "accessory": ""},
    "happy":     {"face": [...8 lines...], "wag": True,  "blink": True,  "accessory": ""},
    "hungry":    {"face": [...8 lines...], "wag": False, "blink": False, "accessory": ""},
    "tired":     {"face": [...8 lines...], "wag": False, "blink": False, "accessory": "Zzz"},
    "concerned": {"face": [...8 lines...], "wag": False, "blink": True,  "accessory": "?"},
    "sad":       {"face": [...8 lines...], "wag": False, "blink": False, "accessory": ""},
    "sleeping":  {"face": [...8 lines...], "wag": False, "blink": False, "accessory": "", "drift": True},
}
```

The cat MUST sit to the left of the System Vitals bars (as in the dashboard example above).

#### Dashboard visualizations (make the rest dynamic too)

The pet isn't the only living thing on the panel. Render the other sections as **visuals**, not just text:
- **RUN** — a solid `▓` progress bar = checked plan boxes ÷ total, with `%` and elapsed time beside it.
- **TASKS** — each task gets a `█`/`░` mini bar: full = done·verified, partial = running (width from evidence), empty = queued. Status word on the right.
- **VERIFICATION** — one stacked `█` bar showing pass ÷ total across all gates (doctor·smoke·verify·sec); review shown separately as ○/.
- **ACTIVITY** — a Unicode sparkline (`▁▂▃▅▇█▆▄▂▁`) per signal over the last 10 min: tasks, agents, verify events. Bucket `events.jsonl` timestamps.
- **EVENT FEED** — last 5 events as `HH:MM:SS  type   detail`; mark negative verification/evidence events with a `(!)` marker so failures pop.

#### Technical tracking (the real value)

The pet must read and display REAL data from the Lazyworkbuddy state:

1. **Run status** — read `.lazyworkbuddy/runs/<run_id>/state.json`:
   - run_id, status, objective, created_at (compute duration)
   - tasks[] with id, title, status, changed_files, evidence
   - review_status, verification_gates

2. **Agent activity** — parse `events.jsonl` for:
   - `subagent_start` events → count total spawned
   - `subagent_stop` events → count stops, check if evidence was verified
   - `task_created` / `task_completed` events
   - Active agents (started but not stopped)

3. **Verification status** — run (or read cached results of):
   - doctor.sh result
   - smoke-test.sh result
   - verify.sh result (the compact JSON)
   - security-check.sh result
   - review decision from `review/` directory

4. **Event feed** — last N events from `events.jsonl`, formatted as:
   `HH:MM:SS  event_type     detail`

5. **Plan progress** — read `plan.md`, count checked vs unchecked boxes in `## TODOs` section

6. **Skill usage** — parse events for skill/command invocations (if logged), show which Lazyworkbuddy commands were used

7. **Pet log** — a charming narrative log derived from events:
   - Task completed → " Fed on T1 completion (verified)"
   - Verification passed → " Energy boost from verification pass"
   - Verification failed → " Ouch! Verification failed — health -10"
   - No activity 45s+ → " No activity for 45s — getting drowsy..."
   - Subagent spawned → " New companion arrived (implementer)"
   - Evidence rejected → " Trust shaken — invalid evidence path"

#### Pet state persistence

`.lazyworkbuddy/pet-state.json`:
```json
{
  "health": 80,
  "focus": 70,
  "stamina": 60,
  "trust": 95,
  "last_fed": "2026-07-10T17:27:12Z",
  "last_activity": "2026-07-10T17:28:00Z",
  "log": [" Fed on T1", " Verification boost", ...]
}
```

### How to run this session

**Don't follow a rigid step-by-step.** Run freely — use your judgment on when to use each Lazyworkbuddy command. The goal is to test the workflow naturally, not mechanically.

However, you MUST:
1. Create a real run with `create-run.sh`
2. Write a real plan with checkboxes
3. Use `update-plan-checkbox.sh` and `update-task.sh` as you work
4. Run `lazyworkbuddy-verify.sh` at least once
5. Try `finalize-run.sh` at the end
6. Write the self-evaluation report

Beyond that, work however feels natural. If you want to skip init-deep because the project is small, skip it and note why. If ulw-plan feels over-engineered for this task, say so. The point is to find where the workflow helps and where it gets in the way.

### Include

- `pet/` package (the 6 modules above — keep each focused; `metrics.py` + `art.py` + `render.py` should hold the bulk of the logic)
- `tests/test_pet.py` (~100+ lines, ≥8 tests: mood selection, Health formula, Trust formula, Focus drain, Stamina, event parsing, plan progress, sparkline buckets, edge cases)
- `dogfood-report.md` (self-evaluation)

### Self-evaluation report

At the end, write `dogfood-report.md`:

```markdown
# Dogfood Report: WorkBuddy Pet

## Result
PASS / FAIL + summary

## Pet screenshot
(paste `python3 -m pet status` output)

## What worked well
- ...

## What was painful
- ...

## Problems encountered
| # | Problem | Severity | Root cause | Fix suggested |
|---|---------|----------|------------|---------------|

## Parity gaps surfaced
- ...

## Timing
| Phase | Time | Notes |
|-------|------|-------|

## Did the pet accurately reflect harness state?
- Did pet mood match what was actually happening?
- Did the stats feel meaningful or arbitrary?
- Could you tell from the pet alone whether things were going well?

## Would I use this workflow for real work?
Honest answer.

## Artifacts
- pet/ (package — N lines across 6 modules)
- tests/test_pet.py (N lines)
- .lazyworkbuddy/runs/dogfood-pet/ (full run records)
- .lazyworkbuddy/pet-state.json
```

### Rules

1. **Be honest.** Record real errors, real friction.
2. **The whole panel must be visual.** Cute animated cat + real System Vitals bars + progress bars + sparklines — not walls of text. This is the visual payoff.
3. **The pet must read real state.** Don't fake the data — parse actual files. The bars and sparklines must reflect real `.lazyworkbuddy/` values.
4. **Tests must pass.** Run pytest and prove it.
5. **No artificial time cap.** This is a small project — it shouldn't need long to execute. Keep scope tight (modular package as specced, ~8 tests) but don't rush or cut quality to hit a clock. Just run it, watch the pet, write the report.
6. **Don't fix harness bugs during the run.** Note and continue.
