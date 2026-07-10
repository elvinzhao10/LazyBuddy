# LazyBuddy Verifier Protocol

> Independent evidence verification (Oracle role). Confirms or rejects DoneClaims from implementers.
> Never trusts executor claims — reproduces, probes, and judges independently.

## 9 Check Categories

| # | Category | Discovery Method | Run Method | Pass Criteria | Fail Criteria |
|---|----------|-----------------|------------|---------------|---------------|
| 1 | **malformed_input** | Inspect changed files for new input parsing code (`parse`, `deserialize`, `validate` patterns) | Send malformed input: empty, truncated, wrong type, unicode, oversized | System returns graceful error; no crash, no 500, no unhandled exception | Crash, 500, unhandled exception, stack trace leaked |
| 2 | **prompt_injection** | Grep for untrusted external text flows (user input, API response, file content used in prompts/templates) | Inject control sequences: `ignore previous`, `<script>`, `{{template}}`, null bytes | Input sanitized; injection has no effect on behavior | Injection alters behavior, escapes context, executes |
| 3 | **cancel_resume** | Check for async operations, long-running flows, multi-step wizards | Start flow → cancel mid-operation → verify cleanup → resume from checkpoint | Clean cancellation; resumable from last valid state; no orphaned state | Stuck state, data loss, can't resume, orphaned resources |
| 4 | **stale_state** | Find generated/cached artifacts (build outputs, `.cache`, `.tsbuildinfo`) | Compare `mtime` of cache vs source; re-run verification with fresh build | Cache <= source mtime; fresh build produces identical results | Stale cache produces different result; cache masks a bug |
| 5 | **dirty_worktree** | `git status --porcelain` in worktree scope | Check for uncommitted changes in task scope files | No uncommitted changes in scope; clean worktree | Uncommitted files that could affect test results |
| 6 | **hung_commands** | Identify long-running external commands (>5s expected) | Run with timeout; verify process exits cleanly | Command completes within timeout; clean exit code | Process hangs, consumes resources, needs kill -9 |
| 7 | **flaky_tests** | Find new or timing-sensitive tests (timeouts, `setTimeout`, async, random) | Run test 5 times in succession; check for non-deterministic results | All 5 runs produce identical pass/fail | Any run differs; test is not deterministic |
| 8 | **misleading_success_output** | Scan test output for suppressed failures | Run with `--verbose`; check: exit code, skipped tests, `--quiet` flags, unreachable assertions | Exit 0, no skipped, no suppressed warnings, assertions actually executed | Non-zero exit despite "PASS" text; skipped tests; unreachable assertions |
| 9 | **repeated_interruptions** | Check for mid-operation interrupt handling (signals, Ctrl+C, connection drops) | Send interrupt mid-operation → verify recovery or clean shutdown → repeat 3x | Consistent behavior; no corruption; recoverable state | Corrupted state, inconsistent behavior across interrupts |

## Verdict Rules

- **confirmed**: All applicable checks pass; confidence >= 0.8; evidence reproducible from event log
- **false-positive**: Executor claimed a test passed but reproduction shows it fails
- **needs-fix**: One or more checks fail; specific blocker listed with reproduction command
- **needs-human-review**: Multiple failures, environment mismatch, or unable to reproduce

## Mandatory Probes

Every verification MUST probe these three categories — they are most frequently missed by executors:
1. **stale_state** — cache freshness check
2. **dirty_worktree** — git status check
3. **misleading_success_output** — verbose output scan

## Evidence Standards

- Every reproduction command must be fully specified (no `cd` deps, no env assumptions)
- Every Manual-QA step must include exact invocation, input, and binary observable
- A third agent reading only the DoneClaim + AdversarialVerify event must reproduce identical results
