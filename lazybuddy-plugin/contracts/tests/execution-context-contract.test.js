'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const contracts = path.resolve(__dirname, '..');
const validatorPath = path.join(contracts, 'validate-lazyseries-record.js');
const HEAD = 'a'.repeat(40);
const LANES = ['goal-verification', 'manual-qa', 'code-quality', 'security', 'context-mining'];

function record(artifactRef = 'lazybuddy-plugin/contracts/tests/execution-context-contract.test.js') {
  return {
    schema_version: 'lazyseries.execution-context.v1',
    fixed_contract: 'TASK/DELTA/REFS/VERIFY',
    task: {
      run_id: 'run-9', task_id: 'task-9', repo_head: HEAD,
      criterion_ids: ['criterion-runtime', 'criterion-state'],
    },
    delta: { summary: 'Exercise the public adapter.', owned_paths: ['src/adapter.js'] },
    artifact_refs: [artifactRef],
    pre_task: {
      mutation: 'none', status_porcelain_sha256: 'b'.repeat(64),
      owned_paths: [{ path: 'src/adapter.js', status: 'tracked-clean' }],
    },
    command_validation: {
      plan_sha256: 'c'.repeat(64), validated_once: true,
      commands: [{ source: 'plan', argv: ['node', '--test', 'test/adapter.test.js'], status: 'validated' }],
    },
    criteria: [
      { criterion_id: 'criterion-runtime', kind: 'runtime', observations: ['real-entry'], artifact_refs: [artifactRef] },
      { criterion_id: 'criterion-state', kind: 'stateful', observations: ['real-entry', 'state-transition'], artifact_refs: [artifactRef] },
    ],
    recovery: { attempted: false, accepted: false },
    memory_update: 'unchanged',
    review: {
      complete: true,
      lanes: LANES.map((lane_id) => ({
        lane_id, previous: 'PASS', stale: false, input_affected: false, rerun: false, current: 'PASS',
      })),
    },
  };
}

function validator() {
  return require(validatorPath);
}

function trustedContext(input, projectRoot = process.cwd()) {
  return {
    projectRoot,
    planCommands: input.command_validation.commands.map(({ argv }) => argv),
    planSha256: input.command_validation.plan_sha256,
  };
}

function writePlanCommands(root, input, name = 'plan-commands.json') {
  const file = path.join(root, name);
  const content = `${JSON.stringify(input.command_validation.commands.map(({ argv }) => argv))}\n`;
  fs.writeFileSync(file, content);
  input.command_validation.plan_sha256 = crypto.createHash('sha256').update(content).digest('hex');
  return file;
}

test('accepts a compact fixed dispatch with read-only provenance and once-validated argv', () => {
  // Given: the compact task delta, references, provenance, and command boundary.
  const input = record();
  // When: it crosses the execution-context validator.
  const result = validator().validateExecutionContext(input, trustedContext(input));
  // Then: it is accepted and remains a bounded packet rather than a repeated plan.
  assert.deepEqual(result, { ok: true, errors: [] });
  assert.ok(Buffer.byteLength(JSON.stringify(input)) < 4096);
  assert.equal(Object.hasOwn(input, 'plan'), false);
});

test('rejects mutating provenance and unsafe shell control syntax before dispatch', () => {
  // Given: inputs that claim a pre-task mutation or smuggle shell composition into argv.
  const mutation = record();
  mutation.pre_task.mutation = 'modified';
  const unsafe = record();
  unsafe.command_validation.commands[0].argv = ['node', '--test', ';', 'touch', 'owned.txt'];
  const shell = record();
  shell.command_validation.commands[0].argv = ['bash', '-c', 'touch owned.txt'];
  // When: both cross the validator.
  const results = [mutation, unsafe, shell]
    .map((input) => validator().validateExecutionContext(input, trustedContext(input)));
  // Then: neither is dispatchable.
  assert.equal(results.every(({ ok }) => ok === false), true);
  assert.match(results.flatMap(({ errors }) => errors).join('\n'), /pre_task\.mutation|unsafe shell token/);
});

test('rejects destructive remote mutating and approval-requiring plan argv without executing it', (t) => {
  // Given: unsafe argv classes and an owned file that validation must never mutate.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lazybuddy-command-safety-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const owned = path.join(root, 'owned.txt');
  fs.writeFileSync(owned, 'preserve\n');
  const unsafeArgv = [
    ['rm', 'owned.txt'],
    ['curl', 'https://example.invalid/report'],
    ['git', 'push', 'origin', 'main'],
    ['git', 'reset', '--hard'],
    ['git', '-C', root, 'reset', '--hard'],
    ['npm', 'install'],
    ['npm', 'publish'],
    ['sudo', 'touch', 'owned.txt'],
    ['codebuddy', 'plugin', 'install', 'lazybuddy@lazybuddy'],
    ['node', '-e', 'require("node:fs").writeFileSync("owned.txt","changed")'],
  ];
  // When: each argv-only packet crosses the direct validator boundary.
  const results = unsafeArgv.map((argv) => {
    const input = record('owned.txt');
    input.command_validation.commands[0].argv = argv;
    return { argv, result: validator().validateExecutionContext(input, trustedContext(input, root)) };
  });
  // Then: every unsafe class is rejected and no command was executed.
  for (const { argv, result } of results) {
    assert.equal(result.ok, false, `accepted unsafe argv: ${JSON.stringify(argv)}`);
    assert.match(result.errors.join('\n'), /unsafe shell token|mutation, remote access, or approval required/);
    assert.doesNotMatch(result.errors.join('\n'), /artifact_refs/);
  }
  assert.equal(fs.readFileSync(owned, 'utf8'), 'preserve\n');
});

test('accepts benign argv and binds it to the trusted stored plan command list', () => {
  // Given: safe local read-only/test commands and a trusted plan command list.
  const safeArgv = [
    ['node', '--test', 'test/adapter.test.js'],
    ['git', 'status', '--short'],
    ['npm', 'test'],
  ];
  // When: matching commands and an arbitrary command substitution are validated.
  const accepted = safeArgv.map((argv) => {
    const input = record();
    input.command_validation.commands[0].argv = argv;
    return validator().validateExecutionContext(input, trustedContext(input));
  });
  const substituted = record();
  substituted.command_validation.commands[0].argv = ['node', '--version'];
  const rejected = validator().validateExecutionContext(substituted, {
    projectRoot: process.cwd(),
    planCommands: [['node', '--test', 'test/adapter.test.js']],
    planSha256: substituted.command_validation.plan_sha256,
  });
  // Then: benign exact matches pass while unbound replacement argv fails closed.
  assert.equal(accepted.every(({ ok }) => ok), true);
  assert.equal(rejected.ok, false);
  assert.match(rejected.errors.join('\n'), /stored plan command list/);
});

test('requires every execution and criterion artifact ref to be a regular in-scope file', (t) => {
  // Given: one real artifact plus missing, symlinked, and symlink-escaped references.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lazybuddy-artifact-boundary-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'lazybuddy-artifact-outside-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'valid.txt'), 'preserve\n');
  fs.writeFileSync(path.join(outside, 'outside.txt'), 'outside\n');
  fs.symlinkSync('valid.txt', path.join(root, 'linked.txt'));
  fs.symlinkSync(outside, path.join(root, 'escaped'));
  const missing = record('missing.txt');
  const linked = record('valid.txt');
  linked.criteria[0].artifact_refs = ['linked.txt'];
  const escaped = record('valid.txt');
  escaped.criteria[1].artifact_refs = ['escaped/outside.txt'];
  // When: valid and invalid reference packets cross the filesystem boundary.
  const validInput = record('valid.txt');
  const valid = validator().validateExecutionContext(validInput, trustedContext(validInput, root));
  const rejected = [missing, linked, escaped]
    .map((input) => validator().validateExecutionContext(input, trustedContext(input, root)));
  // Then: only the current regular in-scope artifact passes and validation is read-only.
  assert.deepEqual(valid, { ok: true, errors: [] });
  assert.equal(rejected.every(({ ok }) => ok === false), true);
  assert.match(rejected.flatMap(({ errors }) => errors).join('\n'), /missing|regular file|escapes project root/);
  assert.equal(fs.readFileSync(path.join(root, 'valid.txt'), 'utf8'), 'preserve\n');
});

test('requires real entry and state-transition artifacts for runtime criteria', () => {
  // Given: runtime and stateful criteria missing their observable boundary evidence.
  const runtime = record();
  runtime.criteria[0].observations = [];
  const stateful = record();
  stateful.criteria[1].observations = ['real-entry'];
  // When: each record is validated.
  const results = [runtime, stateful].map((input) => validator().validateExecutionContext(input, trustedContext(input)));
  // Then: the missing observable is named and rejected.
  assert.equal(results.every(({ ok }) => ok === false), true);
  assert.match(results[0].errors.join('\n'), /real-entry/);
  assert.match(results[1].errors.join('\n'), /state-transition/);
});

test('accepts memory only from a complete identity-bound terminal report', (t) => {
  // Given: a complete terminal report whose criterion artifacts exist.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lazybuddy-terminal-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const relative of ['runtime.json', 'state.json']) fs.writeFileSync(path.join(root, relative), '{}\n');
  const accepted = record('runtime.json');
  accepted.recovery = {
    attempted: true,
    accepted: true,
    terminal_report: {
      status: 'complete', run_id: 'run-9', task_id: 'task-9', repo_head: HEAD,
      criterion_ids: ['criterion-runtime', 'criterion-state'], artifact_refs: ['runtime.json', 'state.json'],
    },
  };
  accepted.memory_update = 'accepted';
  // When: current and stale task identities cross the validator.
  const current = validator().validateExecutionContext(accepted, trustedContext(accepted, root));
  const stale = structuredClone(accepted);
  stale.recovery.terminal_report.repo_head = 'd'.repeat(40);
  const rejected = validator().validateExecutionContext(stale, trustedContext(stale, root));
  const missing = structuredClone(accepted);
  missing.recovery.terminal_report.artifact_refs = ['missing.json'];
  const missingResult = validator().validateExecutionContext(missing, trustedContext(missing, root));
  // Then: only the complete current report can update memory.
  assert.deepEqual(current, { ok: true, errors: [] });
  assert.equal(rejected.ok, false);
  assert.match(rejected.errors.join('\n'), /terminal_report\.repo_head/);
  assert.equal(missingResult.ok, false);
  assert.match(missingResult.errors.join('\n'), /is missing/);
});

test('reruns only failed missing stale or input-affected lanes and retains all-five PASS', () => {
  // Given: each supported affected-lane reason and four current unaffected PASS lanes.
  const variants = [
    { previous: 'FAIL' },
    { previous: 'MISSING' },
    { stale: true },
    { input_affected: true },
  ].map((change) => {
    const candidate = record();
    candidate.review.complete = false;
    candidate.review.lanes[2] = {
      ...candidate.review.lanes[2], ...change, rerun: true, current: 'PENDING',
    };
    return candidate;
  });
  const skipped = structuredClone(variants[0]);
  skipped.review.lanes[2].rerun = false;
  const redundant = structuredClone(variants[0]);
  redundant.review.lanes[0].rerun = true;
  // When: focused, skipped-affected, and redundant records are validated.
  const results = [...variants, skipped, redundant]
    .map((input) => validator().validateExecutionContext(input, trustedContext(input)));
  // Then: only the focused choice is accepted and completion still requires five current PASS verdicts.
  assert.equal(results.slice(0, 4).every(({ ok }) => ok), true);
  assert.equal(results[4].ok, false);
  assert.equal(results[5].ok, false);
  const incomplete = record();
  incomplete.review.lanes[4].current = 'INCONCLUSIVE';
  assert.equal(validator().validateExecutionContext(incomplete, trustedContext(incomplete)).ok, false);
});

test('exposes execution-context validation through the existing public record CLI', (t) => {
  // Given: a compact record on disk.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lazybuddy-execution-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = path.join(root, 'execution.json');
  const value = record('execution.json');
  const planCommands = writePlanCommands(root, value);
  fs.writeFileSync(input, `${JSON.stringify(value)}\n`);
  // When: the existing public record CLI validates it.
  const result = spawnSync(process.execPath, [validatorPath, 'execution', '--project-root', root,
    '--plan-commands-file', planCommands, input], { encoding: 'utf8' });
  // Then: the process reports an execution record pass.
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'PASS: execution record valid\n');
});

test('public execution CLI rejects missing or mismatched plan authority and obscured mutation', (t) => {
  // Given: valid artifacts plus unbound evaluation, mismatched plan, and option-obscured Git records.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lazybuddy-execution-adversarial-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'artifact.txt'), 'preserve\n');
  const nodeEval = record('artifact.txt');
  nodeEval.command_validation.commands[0].argv = ['node', '-e', 'require("node:fs").writeFileSync("pwned","x")'];
  const gitReset = record('artifact.txt');
  gitReset.command_validation.commands[0].argv = ['git', '-C', root, 'reset', '--hard'];
  const safe = record('artifact.txt');
  const safePlan = writePlanCommands(root, safe, 'safe-plan.json');
  const nodePlan = writePlanCommands(root, nodeEval, 'node-plan.json');
  const gitPlan = writePlanCommands(root, gitReset, 'git-plan.json');
  for (const [name, value] of Object.entries({ nodeEval, gitReset, safe })) {
    fs.writeFileSync(path.join(root, `${name}.json`), `${JSON.stringify(value)}\n`);
  }
  // When: each hostile record crosses the shipped CLI rather than the internal function alone.
  const unbound = spawnSync(process.execPath, [validatorPath, 'execution', '--project-root', root,
    path.join(root, 'nodeEval.json')], { encoding: 'utf8' });
  const mismatched = spawnSync(process.execPath, [validatorPath, 'execution', '--project-root', root,
    '--plan-commands-file', safePlan, path.join(root, 'nodeEval.json')], { encoding: 'utf8' });
  const boundEval = spawnSync(process.execPath, [validatorPath, 'execution', '--project-root', root,
    '--plan-commands-file', nodePlan, path.join(root, 'nodeEval.json')], { encoding: 'utf8' });
  const obscured = spawnSync(process.execPath, [validatorPath, 'execution', '--project-root', root,
    '--plan-commands-file', gitPlan, path.join(root, 'gitReset.json')], { encoding: 'utf8' });
  // Then: all fail closed and no certified command is executed.
  assert.notEqual(unbound.status, 0);
  assert.match(unbound.stderr, /plan commands/i);
  assert.notEqual(mismatched.status, 0);
  assert.match(mismatched.stderr, /stored plan command list|plan_sha256/);
  assert.notEqual(boundEval.status, 0);
  assert.match(boundEval.stderr, /unsafe shell token/);
  assert.notEqual(obscured.status, 0);
  assert.match(obscured.stderr, /mutation, remote access, or approval required/);
  assert.equal(fs.existsSync(path.join(root, 'pwned')), false);
  assert.equal(fs.readFileSync(path.join(root, 'artifact.txt'), 'utf8'), 'preserve\n');
});
