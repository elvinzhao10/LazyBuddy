import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { processCall } from './command-fixture.mjs';
import { producerAttemptObservations } from '../producers.mjs';
import { createMiniDom } from './fixtures/mini-dom.mjs';

// T16 interface under test: nested execution drill-down (plan -> batch -> task,
// where entering a level changes aggregation) plus the actual run timeline over
// recorded T09 attempt observations. Observation fixtures are driven through the
// REAL T02 CLI route: the project is initialized and commanded through cli.mjs as a
// subprocess, observations are recorded through the T02 recordObservations route via
// the execution view's production observation path, and the snapshot is read back
// through the CLI reducer. The planned DAG derives from T07 compose; retries are new
// attempts and never add DAG edges.
const dom = createMiniDom();
globalThis.document = dom.document;

const { composeGraphSet } = await import('../../project/plans/dependencies.mjs');
const { evaluateTaskGate, normalizeDependencyFacts } = await import('../../project/plans/readiness.mjs');
const { executionDocument, recordExecutionObservations, tasksWithAttempts } = await import('../ui/execution-model.mjs');
const { createExecutionView } = await import('../ui/execution-view.mjs');
const { liveExecutionProjection } = await import('../ui/live-execution-model.mjs');
const { intervalGeometry, parseAttemptObservations, timelineModel } = await import('../ui/timeline-model.mjs');
const { presentationModel } = await import('../ui/project-presentation.mjs');
const { capture: captureServiceSnapshot } = await import('../service-snapshot.mjs');

const plugin = fileURLToPath(new URL('../../../', import.meta.url));
const producer = join(plugin, 'shared/dashboard/producers.mjs');
const projectCLI = fileURLToPath(new URL('../../project/cli.mjs', import.meta.url));
const workload = join(plugin, 'shared/dashboard/test/producer-workload.mjs');
const python = process.env.B4_PYTHON ?? 'python3';
const PROJECT_ID = 'project:t16';
const ACTOR = 'chat:t16';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const settle = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const evidenceDirectory = process.env.T16_EVIDENCE_DIR
  ?? '/Users/Admin/Desktop/lazyseries/.omo/evidence/lazyseries-1.4.0-project-platform/T16';

async function waitForFile(file, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { await access(file); return; }
    catch { if (Date.now() > deadline) throw new Error(`timed out waiting for ${file}`); await settle(25); }
  }
}

function launch(root, args) {
  const child = spawn(process.execPath, [producer, ...args, '--project-root', root, '--project-id', PROJECT_ID,
    '--run-id', 'probe', '--actor', ACTOR, '--python', python]);
  let stdout = ''; let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const done = new Promise(resolve => child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr })));
  return { pid: child.pid, child, done };
}

async function context(root, attempt, worker, task, index, criterion = 'C1') {
  const result = await processCall([process.execPath, producer, 'context', '--parent-task-id', 'P', '--task-id', task,
    '--criterion-id', criterion, '--attempt-id', attempt, '--worker-id', worker,
    '--plan-commands-file', join(root, '.lazybuddy/runs/probe/commands.json'), '--command-index', String(index),
    '--project-root', root, '--project-id', PROJECT_ID, '--run-id', 'probe', '--actor', ACTOR, '--python', python]);
  assert.equal(result.code, 0, result.stderr);
  const file = join(root, '.lazybuddy', `${attempt.replace(/[^a-z0-9-]/gi, '_')}.json`);
  await writeFile(file, result.stdout);
  return file;
}

function invokeProject(root, action, input) {
  const result = spawnSync(process.execPath, [projectCLI, action, '--project-root', root, '--project-id', PROJECT_ID,
    '--actor', 'local:t16-test'], { cwd: root, input: input ?? '', encoding: 'utf8', timeout: 30000 });
  return { code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function reduceCLI(action, state, contextOptions) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [projectCLI, '--reduce'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const output = []; const errors = [];
    child.stdout.on('data', chunk => output.push(chunk));
    child.stderr.on('data', chunk => errors.push(chunk));
    child.on('error', reject);
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error); });
    child.on('close', code => {
      if (code !== 0) reject(new Error(`--reduce ${action} failed: ${Buffer.concat(errors).toString('utf8')}`));
      else resolve(JSON.parse(Buffer.concat(output).toString('utf8')));
    });
    child.stdin.end(JSON.stringify({ action, state, context: contextOptions }));
  });
}

const fixture = { root: null };

test.before(async () => {
  const root = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 't16-execution-')));
  await processCall(['git', '-C', root, 'init', '-q'], '', { GIT_CONFIG_NOSYSTEM: '1', HOME: root });
  await processCall(['git', '-C', root, 'config', 'user.name', 'Execution QA'], '', { GIT_CONFIG_NOSYSTEM: '1', HOME: root });
  await processCall(['git', '-C', root, 'config', 'user.email', 'execution@example.invalid'], '', { GIT_CONFIG_NOSYSTEM: '1', HOME: root });
  await writeFile(join(root, '.gitignore'), '.lazybuddy/\n');
  await mkdir(join(root, 'docs'), { recursive: true });
  await writeFile(join(root, 'docs/requirements.md'), '# Requirements\n\n## C1\n\nActual artifact is independently verified.\n');
  await writeFile(join(root, 'docs/plan-a.md'), '# Plan A\n\nProduce the artifact through the bounded worker route; one independent verifier confirms criterion c1.\n');
  await writeFile(join(root, 'docs/plan-b.md'), '# Plan B\n\nBranch A and branch B must both be independently verified before join J opens.\n');
  await processCall(['git', '-C', root, 'add', '.gitignore', 'docs'], '', { GIT_CONFIG_NOSYSTEM: '1', HOME: root });
  await processCall(['git', '-C', root, 'commit', '-qm', 'fixture'], '', { GIT_CONFIG_NOSYSTEM: '1', HOME: root });
  const created = await processCall(['bash', join(plugin, 'scripts/state/create-run.sh'), 'probe', 'Execution QA'], '', { CWD: root, PATH: process.env.PATH });
  assert.equal(created.code, 0, created.stderr);
  const run = join(root, '.lazybuddy/runs/probe');
  const head = (await processCall(['git', '-C', root, 'rev-parse', 'HEAD'])).stdout.trim();
  const plan = '# Plan\n- [x] [C1] Actual artifact is independently verified\n';
  const artifact = join(run, 'actual.txt');
  const overlap = join(run, 'overlap.txt');
  const killed = join(run, 'killed.txt');
  const markerR = join(run, 'marker-r'); const releaseR = join(run, 'release-r');
  const markerB = join(run, 'marker-b'); const releaseB = join(run, 'release-b');
  const markerK = join(run, 'marker-k'); const releaseK = join(run, 'release-k');
  const commands = [
    [process.execPath, workload, 'wait-write', artifact, 'right', markerR, releaseR],
    [process.execPath, workload, 'wait-write', overlap, 'overlap', markerB, releaseB],
    [process.execPath, workload, 'verify', artifact, 'right'],
    [process.execPath, workload, 'wait-write', killed, 'never', markerK, releaseK]];
  const commandsBytes = `${JSON.stringify(commands)}\n`;
  const state = JSON.parse(readFileSync(join(run, 'state.json'), 'utf8'));
  const criteria = [{ id: 'C1', task_id: 'A', version: 1, requirement: 'Actual artifact is independently verified',
    applicability: 'required', verification: 'unverified', scenarios: [], result_ids: [], history: [] }];
  state.status = 'active'; state.plan_reference = '.lazybuddy/runs/probe/plan.md'; state.plan_revision = 1;
  state._approved_plan_sha256 = digest(plan); state.dashboard_project_id = PROJECT_ID;
  state.tasks = [{ id: 'P', title: 'Parent', status: 'running', depends_on: [], execution_authority: {
    repo_head: head, criterion_ids: ['C1', 'C2'], plan_reference: state.plan_reference, plan_sha256: digest(plan),
    plan_commands_path: '.lazybuddy/runs/probe/commands.json', plan_commands_sha256: digest(commandsBytes),
  } },
  { id: 'A', title: 'Produce the artifact', status: 'queued', depends_on: [], criteria },
  { id: 'B', title: 'Overlap branch', status: 'queued', depends_on: [], criteria: criteria.map(item => ({ ...item, id: 'C2', task_id: 'B' })) }];
  mkdirSync(join(run, 'checkpoints'), { recursive: true });
  writeFileSync(join(run, 'plan.md'), plan);
  writeFileSync(join(run, 'checkpoints/plan-revision.md'), plan);
  writeFileSync(join(run, 'commands.json'), commandsBytes);
  writeFileSync(join(run, 'state.json'), JSON.stringify(state));
  Object.assign(fixture, { root, run, markerR, releaseR, markerB, releaseB, markerK, releaseK,
    planADoc: readFileSync(join(root, 'docs/plan-a.md')), planBDoc: readFileSync(join(root, 'docs/plan-b.md')) });
});

test.after(() => {
  const receipt = [];
  if (fixture.root) {
    if (existsSync(fixture.root)) {
      rmSync(fixture.root, { recursive: true, force: true });
      receipt.push('fixture-root-removed');
    }
    assert.equal(existsSync(fixture.root), false);
  }
  process.stdout.write(`cleanup receipt: ${receipt.join(',')}\n`);
});

// Plan graphs bind the CURRENT accepted plan revision: the CLI command sequence
// (register_plan then link_native_run) determines it, so documents and facts are
// built from the real recorded state rather than hardcoded numbers.
function planRevisionOf(state, planId) {
  const plan = state?.plans?.find(entry => entry.id === planId);
  return plan?.revision ?? 1;
}

function graphDocuments(state = null) {
  return [
    { schema_version: 1, plan_id: 'plan:execution-a', plan_revision: planRevisionOf(state, 'plan:execution-a'),
      content_sha256: digest(fixture.planADoc), resources: [], edges: [], tasks: [
        { id: 'A', title: 'Produce the independently verified artifact', criteria: [{ id: 'c1', revision: 1 }] }] },
    { schema_version: 1, plan_id: 'plan:execution-b', plan_revision: planRevisionOf(state, 'plan:execution-b'),
      content_sha256: digest(fixture.planBDoc), resources: [], edges: [], tasks: [
        { id: 'A', title: 'Branch A — produce the confirmed result', criteria: [{ id: 'c1', revision: 1 }] },
        { id: 'B', title: 'Branch B — produce the pending result', criteria: [{ id: 'c1', revision: 1 }] },
        { id: 'J', title: 'Join — both branches confirmed', criteria: [], join: { mode: 'all' }, dependencies: [
          { id: 'dep-a', kind: 'depends-on-gate', condition: 'independent-verification-confirmed',
            target: { type: 'task', plan_id: 'plan:execution-b', task_id: 'A' } },
          { id: 'dep-b', kind: 'depends-on-gate', condition: 'independent-verification-confirmed',
            target: { type: 'task', plan_id: 'plan:execution-b', task_id: 'B' } }] }] },
  ];
}

function dependencyFacts(state = null) {
  const digestA = digest(fixture.planADoc); const digestB = digest(fixture.planBDoc);
  const observedAt = '2026-10-06T00:00:00Z';
  const revisionA = planRevisionOf(state, 'plan:execution-a'); const revisionB = planRevisionOf(state, 'plan:execution-b');
  return [
    { id: 'fact:a-finished', kind: 'task', condition: 'execution-finished', value: true, observed_at: observedAt,
      plan_id: 'plan:execution-a', task_id: 'A', basis: { plan_revision: revisionA, content_sha256: digestA, criterion_revisions: {} } },
    { id: 'fact:a-verified', kind: 'task', condition: 'independent-verification-confirmed', value: true, observed_at: observedAt,
      plan_id: 'plan:execution-a', task_id: 'A', basis: { plan_revision: revisionA, content_sha256: digestA, criterion_revisions: { c1: 1 } } },
    { id: 'fact:b-a-finished', kind: 'task', condition: 'execution-finished', value: true, observed_at: observedAt,
      plan_id: 'plan:execution-b', task_id: 'A', basis: { plan_revision: revisionB, content_sha256: digestB, criterion_revisions: {} } },
    { id: 'fact:b-a-verified', kind: 'task', condition: 'independent-verification-confirmed', value: true, observed_at: observedAt,
      plan_id: 'plan:execution-b', task_id: 'A', basis: { plan_revision: revisionB, content_sha256: digestB, criterion_revisions: { c1: 1 } } },
    { id: 'fact:b-b-finished', kind: 'task', condition: 'execution-finished', value: true, observed_at: observedAt,
      plan_id: 'plan:execution-b', task_id: 'B', basis: { plan_revision: revisionB, content_sha256: digestB, criterion_revisions: {} } },
  ];
}

const BATCHES = {
  'plan:execution-a': [{ id: 'batch:build-a', title: 'Batch — build and verify the artifact', taskIds: ['A'] }],
  'plan:execution-b': [{ id: 'batch:branches-b', title: 'Batch — two branches with a join', taskIds: ['A', 'B', 'J'] }],
};

test('nested execution and timeline render the two required fixtures from real recorded observations', async () => {
  const root = fixture.root; const run = fixture.run;
  let recorded; let observedState; let snapshot; let attempts; let model; let composed;
  try {
    // 1. A worker attempt is killed mid-run: dispatched, never terminal.
    const ctxK = await context(root, 'executor:killed', 'worker:executor-a', 'A', 3);
    const k = launch(root, ['execute', '--context-file', ctxK, '--artifact-path', '.lazybuddy/runs/probe/killed.txt',
      '--timeout', '3']);
    await waitForFile(join(run, 'producer-attempts', digest('executor:killed'), 'start.json'));
    k.child.kill('SIGKILL');
    await k.done;
    await settle(150);
    await writeFile(fixture.releaseK, 'go\n');

    // 2. The same agent reconnects with a NEW attempt that finishes the work, and a
    //    second agent overlaps it in real wall-clock time on another branch.
    const ctxR = await context(root, 'executor:resumed', 'worker:executor-a', 'A', 0);
    const r = launch(root, ['execute', '--context-file', ctxR, '--artifact-path', '.lazybuddy/runs/probe/actual.txt']);
    await waitForFile(fixture.markerR);
    const ctxB = await context(root, 'executor:overlap-b', 'worker:executor-b', 'B', 1, 'C2');
    const b = launch(root, ['execute', '--context-file', ctxB, '--artifact-path', '.lazybuddy/runs/probe/overlap.txt']);
    await waitForFile(fixture.markerB);
    await writeFile(fixture.releaseR, 'go\n'); await writeFile(fixture.releaseB, 'go\n');
    const [doneR, doneB] = await Promise.all([r.done, b.done]);
    assert.equal(doneR.code, 0, doneR.stderr || doneR.stdout);
    assert.equal(doneB.code, 0, doneB.stderr || doneB.stdout);

    // 3. A separate verifier with its own identity approves the resumed attempt.
    const ctxV = await context(root, 'verifier:distinct', 'worker:verifier-1', 'A', 2);
    const doneV = await launch(root, ['verify', '--context-file', ctxV, '--artifact-path', '.lazybuddy/runs/probe/actual.txt',
      '--executor-id', 'worker:executor-a', '--executor-attempt-id', 'executor:resumed']).done;
    assert.equal(doneV.code, 0, doneV.stderr || doneV.stdout);
    assert.ok(existsSync(join(run, 'completion-authority.json')), 'the real verifier published completion authority');
    const review = JSON.parse(readFileSync(join(run, 'completion', digest('C1\n1\nverifier:distinct'), 'review.json'), 'utf8'));
    assert.equal(review.verdict, 'approved');
    assert.equal(review.verifier.identity, 'worker:verifier-1');
    const executorManifest = JSON.parse(readFileSync(join(run, 'producer-attempts', digest('executor:resumed'), 'terminal.json'), 'utf8'));
    assert.equal(executorManifest.worker_id, 'worker:executor-a');
    assert.notEqual(review.verifier.identity, executorManifest.worker_id, 'verifier identity stays distinct from the worker');

    // The production service snapshot and live adapter consume these same
    // producer records without inventing batches, steps, agents or retry edges.
    const capturedRun = await captureServiceSnapshot({ projectRoot: root, projectId: PROJECT_ID, runId: 'probe', python });
    const liveProjection = liveExecutionProjection(capturedRun.snapshot, { asOf: new Date().toISOString() });
    assert.deepEqual(liveProjection.document.nodes.map(node => node.id).sort(), ['A', 'B', 'P']);
    const nativeAttempts = capturedRun.snapshot.tasks.flatMap(task => task.attempts);
    assert.ok(nativeAttempts.length >= 3, 'real execute and verify producers create distinct native attempts');
    assert.equal(new Set(nativeAttempts.map(attempt => attempt.id)).size, nativeAttempts.length);
    assert.ok(liveProjection.timeline.intervals.length >= 2, 'timestamped native attempts render on the production timeline');
    assert.ok(liveProjection.timeline.intervals.every(interval => Number.isFinite(interval.startMs)
      && typeof interval.agentId === 'string' && interval.agentId.length > 0
      && ['executing', 'finished', 'failed', 'cancelled'].includes(interval.state)));
    assert.deepEqual(liveProjection.timeline.retryChains, [], 'attempt ordering never fabricates a retry relationship');
    const liveTask = liveExecutionProjection(capturedRun.snapshot, { taskId: 'A', asOf: new Date().toISOString() });
    assert.deepEqual(liveTask.document.nodes.map(node => node.id).sort(),
      capturedRun.snapshot.tasks.find(task => task.id === 'A').attempts.map(attempt => attempt.id).sort());

    // 4. Observations derive from the recorded native evidence (T09 producer route).
    const observedAt = new Date().toISOString();
    recorded = await producerAttemptObservations({
      projectRoot: root, runId: 'probe', observedAt, staleAfterMs: 100,
      attempts: [
        { attemptId: 'executor:killed', waitingMarker: fixture.markerK },
        { attemptId: 'executor:resumed', resumesAttemptId: 'executor:killed' },
        { attemptId: 'executor:overlap-b', waitingMarker: fixture.markerB },
        { attemptId: 'verifier:distinct' },
      ],
    });
    assert.equal(recorded.length, 4);
    const payload = identity => JSON.parse(recorded.find(entry => entry.id === `observation:attempt:probe:${identity}`).text);
    const killed = payload('executor:killed'); const resumed = payload('executor:resumed');
    const overlapB = payload('executor:overlap-b'); const verifier = payload('verifier:distinct');
    assert.equal(killed.activity.state, 'stale');
    assert.equal(killed.activity.interval.end, null);
    assert.equal(resumed.attempt.resumes_attempt, 'executor:killed');
    assert.equal(resumed.activity.state, 'finished');
    assert.equal(overlapB.agent.id, 'worker:executor-b');
    assert.equal(verifier.agent.id, 'worker:verifier-1');
    assert.equal(verifier.role, 'verifier');
    const intersection = Math.min(Date.parse(resumed.activity.interval.end), Date.parse(overlapB.activity.interval.end))
      - Math.max(Date.parse(resumed.activity.interval.start), Date.parse(overlapB.activity.interval.start));
    assert.ok(intersection > 0, `the two agents must overlap in real time (got ${intersection}ms)`);

    // 5. The project fixture is built through the REAL T02 CLI route (subprocess).
    const init = invokeProject(root, 'init');
    assert.equal(init.code, 0, init.stderr);
    assert.ok(existsSync(join(root, '.lazyseries/project.json')), 'explicit init creates the neutral registry');
    const applied = [
      ['register_source', { id: 'source:plan-a', path: 'docs/plan-a.md', role: 'plan' }],
      ['register_source', { id: 'source:plan-b', path: 'docs/plan-b.md', role: 'plan' }],
      ['register_plan', { id: 'plan:execution-a', source: { source_id: 'source:plan-a',
        sha256: digest(fixture.planADoc), anchor_id: 'document' }, declared_lifecycle: 'planned', baseline_refs: [] }],
      ['register_plan', { id: 'plan:execution-b', source: { source_id: 'source:plan-b',
        sha256: digest(fixture.planBDoc), anchor_id: 'document' }, declared_lifecycle: 'planned', baseline_refs: [] }],
      ['link_native_run', { plan_id: 'plan:execution-a', native_project_id: PROJECT_ID, run_id: 'probe' }],
      ['link_native_run', { plan_id: 'plan:execution-b', native_project_id: PROJECT_ID, run_id: 'probe' }],
    ];
    for (let index = 0; index < applied.length; index += 1) {
      const [operation, operationPayload] = applied[index];
      const result = invokeProject(root, 'command', JSON.stringify({ schema_version: 1,
        command_id: `t16:${operation}:${index}`, project_id: PROJECT_ID, expected_revision: index,
        operation, payload: operationPayload }));
      assert.equal(result.code, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).receipt.status, 'saved');
    }
    const realState = JSON.parse(readFileSync(join(root, '.lazybuddy/project/state.json'), 'utf8'));

    // 6. The execution view's production observation path records through the T02
    //    route, and the snapshot is read back through the CLI reducer.
    const { state: observed, recorded: recordedIds } = recordExecutionObservations(realState, recorded);
    assert.deepEqual(recordedIds, recorded.map(entry => entry.id));
    assert.equal(observed.observation_revision, recorded.length);
    observedState = observed;
    snapshot = await reduceCLI('snapshot', observed, {});
    assert.equal(snapshot.observations.length, recorded.length);
    assert.equal(snapshot.observation_revision, recorded.length);
    const parsed = parseAttemptObservations(snapshot.observations);
    assert.equal(parsed.attempts.length, 4);
    assert.deepEqual(parsed.ignored, []);
    attempts = parsed.attempts;

    // 7. DAG acyclicity through T07 compose; retries never add DAG edges.
    composed = composeGraphSet(graphDocuments(observed), { state: observed });
    assert.equal(composed.taskAt('plan:execution-a', 'A').task.id, 'A');
    const joinTask = composed.taskAt('plan:execution-b', 'J').task;
    assert.deepEqual(joinTask.dependencies.map(input => input.id), ['dep-a', 'dep-b']);
    for (const graph of graphDocuments(observed)) {
      for (const task of graph.tasks) {
        for (const input of task.dependencies ?? []) {
          assert.notEqual(input.target.task_id, task.id, 'a retry is a new attempt, never a self dependency');
        }
      }
    }
    const recomposed = composeGraphSet(graphDocuments(observed), { state: observed });
    assert.deepEqual([...composed.tasks.keys()].sort(), [...recomposed.tasks.keys()].sort(),
      'recording attempt observations leaves the plan DAG unchanged');

    // 8. The two-branch join is blocked through the T07 gate evaluator.
    const facts = normalizeDependencyFacts(dependencyFacts(observed));
    const graphB = composed.graphFor('plan:execution-b');
    const joinGate = evaluateTaskGate(graphB, joinTask, { state: observed, set: composed, facts });
    assert.equal(joinGate.status, 'blocked');
    const statuses = Object.fromEntries(joinGate.inputs.map(input => [input.input_id, input.status]));
    assert.equal(statuses['dep-a'], 'satisfied');
    assert.equal(statuses['dep-b'], 'not-established');

    // 9. Timeline: shared axis, real overlap, stale open interval, retry chain.
    model = timelineModel(attempts, { asOf: observedAt });
    assert.equal(model.lanes.length, 3, 'one lane per distinct agent');
    assert.ok(model.overlaps.some(overlap => (overlap.a === 'executor:resumed' && overlap.b === 'executor:overlap-b')
      || (overlap.a === 'executor:overlap-b' && overlap.b === 'executor:resumed')), 'the two workers overlap');
    const staleInterval = model.intervals.find(interval => interval.attemptId === 'executor:killed');
    assert.equal(staleInterval.state, 'stale');
    assert.equal(staleInterval.open, true);
    assert.deepEqual(model.retryChains, [{ from: 'executor:killed', to: 'executor:resumed', lane: staleInterval.lane }]);
    assert.ok(model.peakConcurrency >= 2);
  } finally {
    for (const release of [fixture.releaseR, fixture.releaseB, fixture.releaseK]) {
      try { await writeFile(release, 'go\n'); } catch { /* already released or removed */ }
    }
  }

  // 10. Fixture A (one worker / one verifier, success): expanded AND collapsed.
  const observedAt = new Date().toISOString();
  const factsInput = dependencyFacts(observedState);
  const documents = {
    aPlan: executionDocument({ state: observedState, set: composed, planId: 'plan:execution-a', facts: factsInput,
      observations: snapshot.observations, batches: BATCHES['plan:execution-a'], level: 'plan', focusId: null }),
    aBatch: executionDocument({ state: observedState, set: composed, planId: 'plan:execution-a', facts: factsInput,
      observations: snapshot.observations, batches: BATCHES['plan:execution-a'], level: 'batch', focusId: 'batch:build-a' }),
    aTask: executionDocument({ state: observedState, set: composed, planId: 'plan:execution-a', facts: factsInput,
      observations: snapshot.observations, batches: BATCHES['plan:execution-a'], level: 'task', focusId: 'A' }),
    bPlan: executionDocument({ state: observedState, set: composed, planId: 'plan:execution-b', facts: factsInput,
      observations: snapshot.observations, batches: BATCHES['plan:execution-b'], level: 'plan', focusId: null }),
    bBatch: executionDocument({ state: observedState, set: composed, planId: 'plan:execution-b', facts: factsInput,
      observations: snapshot.observations, batches: BATCHES['plan:execution-b'], level: 'batch', focusId: 'batch:branches-b' }),
  };

  // Entering a level CHANGES aggregation, not just zoom.
  assert.deepEqual(documents.aPlan.nodes.map(node => node.kind), ['batch', 'gate']);
  assert.deepEqual(documents.aBatch.nodes.map(node => node.kind).sort(), ['task', 'verifier']);
  assert.deepEqual(documents.aTask.nodes.map(node => node.kind).sort(),
    ['attempt', 'attempt', 'attempt', 'evidence', 'evidence', 'evidence', 'step', 'step', 'step']);
  assert.match(documents.aPlan.nodes[0].summary, /1 worker task/);
  assert.match(documents.aBatch.nodes.find(node => node.id === 'A').summary, /worker:executor-a/);
  const planModelIds = presentationModel(documents.aPlan).nodes.map(node => node.id);
  const batchModelIds = presentationModel(documents.aBatch).nodes.map(node => node.id);
  assert.ok(!planModelIds.includes('A'), 'the plan level aggregates the worker task away');
  assert.ok(batchModelIds.includes('A'), 'the batch level shows the individual worker task');

  // Fixture A expanded: worker finished + verified; verifier stage with its own steps.
  const workerTask = documents.aBatch.nodes.find(node => node.id === 'A');
  assert.equal(workerTask.execution.state, 'neutral');
  assert.match(workerTask.execution.label, /Finished · 2 attempts/);
  assert.equal(workerTask.verification.state, 'verified');
  const verifierNode = documents.aBatch.nodes.find(node => node.kind === 'verifier');
  assert.equal(verifierNode.id, 'verifier:worker:verifier-1');
  assert.equal(verifierNode.children.length, 1);
  assert.equal(verifierNode.children[0].id, 'vstep:verifier:distinct');
  const aEdges = documents.aBatch.edges;
  assert.ok(aEdges.some(edge => edge.from === 'A' && edge.to === 'verifier:worker:verifier-1' && edge.kind === 'gate'));

  // Fixture A collapsed: the plan-level gate keeps the verification state visible.
  const collapsedGate = presentationModel(documents.aPlan).nodes.find(node => node.id === 'gate:plan:execution-a');
  assert.equal(collapsedGate.collapsedGroup, true);
  assert.match(collapsedGate.summary, /collapsed: 1 checks?, all confirmed/);
  const expandedGate = presentationModel(documents.aPlan, { collapsed: new Set() }).nodes
    .find(node => node.id === 'check:plan:execution-a:A:c1');
  assert.equal(expandedGate.verification.state, 'verified');

  // Retry history: attempts as NEW identities with a history edge, never a DAG edge,
  // and the verifier attempt is never chained as a worker retry.
  const aTaskEdges = documents.aTask.edges;
  const historyEdges = aTaskEdges.filter(edge => edge.kind === 'history');
  assert.equal(historyEdges.length, 1);
  assert.equal(historyEdges[0].from, 'attempt:executor:killed');
  assert.equal(historyEdges[0].to, 'attempt:executor:resumed');
  assert.match(historyEdges[0].label, /gains no cycle/);
  const evidenceIds = documents.aTask.nodes.filter(node => node.kind === 'evidence').map(node => node.id);
  assert.deepEqual(evidenceIds.sort(), ['evidence:verifier:verifier:distinct', 'evidence:worker:executor:killed', 'evidence:worker:executor:resumed']);
  for (const evidence of documents.aTask.nodes.filter(node => node.kind === 'evidence')) {
    if (evidence.id.startsWith('evidence:worker:')) {
      assert.match(evidence.title, /worker artifact evidence/);
    } else {
      assert.match(evidence.title, /verifier receipt/);
    }
  }

  // Fixture B (two-branch join, one confirmed + one pending): expanded AND collapsed.
  const bJoin = documents.bBatch.nodes.find(node => node.kind === 'join');
  assert.equal(bJoin.id, 'join:plan:execution-b:J');
  assert.equal(bJoin.execution.state, 'attention');
  assert.match(bJoin.summary, /dep-a: confirmed/);
  assert.match(bJoin.summary, /dep-b: pending/);
  const bJoinEdges = documents.bBatch.edges.filter(edge => edge.to === 'join:plan:execution-b:J');
  assert.deepEqual(bJoinEdges.map(edge => edge.from).sort(), ['B', 'verifier:worker:verifier-1']);
  assert.match(bJoinEdges.find(edge => edge.from === 'B').label, /pending/);
  assert.match(bJoinEdges.find(edge => edge.from === 'verifier:worker:verifier-1').label, /confirmed/);
  const branchB = documents.bBatch.nodes.find(node => node.id === 'B');
  assert.equal(branchB.verification.state, 'neutral');
  assert.match(branchB.verification.label, /Verification pending/);
  const bCollapsedGate = presentationModel(documents.bPlan).nodes.find(node => node.id === 'gate:plan:execution-b');
  assert.match(bCollapsedGate.summary, /collapsed: 2 checks, 1 pending/);
  const bChecks = presentationModel(documents.bPlan, { collapsed: new Set() }).nodes
    .filter(node => node.id.startsWith('check:plan:execution-b:'));
  assert.deepEqual(bChecks.map(check => check.verification.state).sort(), ['attention', 'verified']);
  assert.match(documents.bPlan.statusSentence.text, /join gate?s? blocked/);

  // 11. The DOM view: separate DAG and timeline panes, expandable verifier, stale
  //     never running, selection and viewport preserved across an update tick.
  const viewA = createExecutionView({ document: documents.aBatch, timeline: model });
  const dagPane = viewA.element.querySelector('[data-testid="execution-dag"]');
  const timelinePane = viewA.element.querySelector('[data-testid="execution-timeline"]');
  assert.ok(dagPane, 'the planned DAG renders as its own pane');
  assert.ok(timelinePane, 'the actual timeline renders as a separate pane');
  assert.notEqual(dagPane, timelinePane);
  assert.ok(viewA.element.querySelectorAll('.execution-node').length >= 2);
  assert.equal(viewA.element.querySelectorAll('.execution-lane').length, 3);
  const liveDocument = { ...structuredClone(documents.aBatch),
    graphLabel: 'Run task dependency graph',
    graphDescription: 'Recorded task dependencies for this bound native run.',
    timelineLabel: 'Recorded attempts',
    timelineDescription: 'Only attempts with recorded timestamps appear.',
    laneLabel: 'Reported worker',
    durationLabel: 'native attempt timestamps',
    inspectorSource: 'Authenticated native run run:fixture at revision 4',
    levelLabels: { plan: 'Project', batch: 'Run', task: 'Task' } };
  const liveView = createExecutionView({ document: liveDocument, timeline: model });
  assert.equal(liveView.element.querySelector('.execution-graph-heading').textContent, 'Run task dependency graph');
  assert.equal(liveView.element.querySelector('[data-testid="execution-dag"]').getAttribute('aria-label'), 'Run task dependency graph');
  assert.equal(liveView.element.querySelector('.execution-timeline-heading').textContent, 'Recorded attempts');
  assert.equal(liveView.element.querySelector('.execution-timeline-viewport').getAttribute('aria-label'), 'Recorded attempts by Reported worker');
  assert.ok([...liveView.element.querySelectorAll('.execution-lane-label')]
    .every(label => label.textContent.startsWith('Reported worker · ')));
  assert.match(liveView.element.querySelector('.execution-notes').textContent, /durations are native attempt timestamps/);
  assert.doesNotMatch(liveView.element.querySelector('.execution-notes').textContent, /recorded-session-duration/);
  assert.match(liveView.element.querySelector('.execution-pane-legend').textContent, /Recorded task dependencies/);
  assert.doesNotMatch(liveView.element.querySelector('.execution-pane-legend').textContent, /accepted plan graph|agent lane/);
  assert.match(liveView.element.querySelector('[data-testid="execution-breadcrumbs"]').textContent, /Project: .*Run:/);
  assert.doesNotMatch(liveView.element.querySelector('[data-testid="execution-breadcrumbs"]').textContent, /Plan:|Batch:/);
  assert.match(liveView.element.querySelector('[data-testid="execution-status"]').textContent, /level Run/);
  assert.doesNotMatch(liveView.element.querySelector('[data-testid="execution-status"]').textContent, /level batch/);
  assert.match(liveView.element.querySelector('.execution-notes').textContent, /concurrent attempts? at peak/);
  assert.match(liveView.element.querySelector('.execution-notes').textContent, /on different reported worker lanes/);
  const sameLaneTimeline = structuredClone(model);
  sameLaneTimeline.overlaps.push({ a: 'same-worker:first', b: 'same-worker:second', laneA: 0, laneB: 0, ms: 12 });
  const sameLaneView = createExecutionView({ document: liveDocument, timeline: sameLaneTimeline });
  assert.match(sameLaneView.element.querySelector('.execution-notes').textContent, /on the same reported worker lane/);
  liveView.select('A');
  assert.match(liveView.element.querySelector('[data-testid="execution-inspector"]').textContent,
    /Authenticated native run run:fixture at revision 4/);
  assert.doesNotMatch(liveView.element.querySelector('[data-testid="execution-inspector"]').textContent, /Accepted plan/);
  const bars = [...viewA.element.querySelectorAll('.execution-interval')];
  assert.equal(bars.length, 4);
  const staleBar = bars.find(bar => bar.dataset.attemptId === 'executor:killed');
  assert.equal(staleBar.dataset.state, 'stale');
  assert.equal(staleBar.dataset.open, 'true');
  assert.equal(staleBar.dataset.endMs, '');
  assert.ok(!bars.some(bar => bar.dataset.state === 'running'), 'no stale attempt ever renders as running');
  const geometry = intervalGeometry(model);
  const resumedBar = bars.find(bar => bar.dataset.attemptId === 'executor:resumed');
  const overlapBar = bars.find(bar => bar.dataset.attemptId === 'executor:overlap-b');
  assert.notEqual(resumedBar.dataset.lane, overlapBar.dataset.lane, 'overlapping agents occupy different lanes');
  const left = geometry.get('executor:resumed'); const right = geometry.get('executor:overlap-b');
  assert.equal(resumedBar.getAttribute('x'), `${left.leftPercent.toFixed(3)}%`);
  assert.equal(resumedBar.getAttribute('width'), `${left.widthPercent.toFixed(3)}%`);
  assert.ok(bars.every(bar => !bar.hasAttribute('style')), 'timeline intervals use CSP-safe SVG presentation attributes');
  assert.ok([...viewA.element.querySelectorAll('.execution-axis-tick')].every(tick => !tick.hasAttribute('style')),
    'timeline ticks use CSP-safe SVG presentation attributes');
  assert.ok(left.leftPercent < right.leftPercent + right.widthPercent && right.leftPercent < left.leftPercent + left.widthPercent,
    'interval bars overlap on the shared time axis');

  // Verifier expansion in the DOM: its steps render under the verifier identity.
  const verifierToggle = viewA.element.querySelector('.execution-node[data-node-id="verifier:worker:verifier-1"] .execution-toggle');
  assert.equal(verifierToggle.getAttribute('aria-expanded'), 'true');
  assert.ok(viewA.element.querySelector('.execution-node[data-node-id="vstep:verifier:distinct"]'));
  viewA.toggleGroup('verifier:worker:verifier-1');
  assert.equal(viewA.element.querySelector('.execution-node[data-node-id="vstep:verifier:distinct"]'), null,
    'collapsing the verifier hides its steps');
  viewA.toggleGroup('verifier:worker:verifier-1');
  assert.ok(viewA.element.querySelector('.execution-node[data-node-id="vstep:verifier:distinct"]'));

  // Selection, collapsed state and viewport survive a simulated polling update.
  viewA.toggleGroup('verifier:worker:verifier-1');
  viewA.select('A');
  viewA.focusNode('A');
  viewA.setViewport({ scale: 1.5, scrollLeft: 96, scrollTop: 48 }, 'test-refresh');
  const timelineBefore = viewA.element.querySelector('.execution-timeline-viewport');
  timelineBefore.scrollLeft = 72;
  timelineBefore.scrollTop = 18;
  const viewportBefore = viewA.getStats();
  const nextTimeline = timelineModel(attempts, { asOf: new Date(Date.now() + 60000).toISOString() });
  const update = viewA.applyUpdate(documents.aBatch, nextTimeline);
  assert.equal(update.selectedPreserved, true);
  assert.equal(viewA.getStats().selectedId, 'A');
  assert.equal(viewA.element.querySelector('.execution-node[aria-pressed="true"]')?.dataset.nodeId, 'A');
  assert.deepEqual(viewA.getStats().collapsed, ['verifier:worker:verifier-1']);
  assert.equal(viewA.getStats().level, 'batch');
  assert.deepEqual(viewA.getStats().viewport, viewportBefore.viewport);
  assert.equal(viewA.element.dataset.timelineViewport, '72,18');
  assert.deepEqual(viewA.getStats().viewport, { scale: 1.5, scrollLeft: 96, scrollTop: 48 },
    'nonzero graph pan and zoom survive the status refresh');
  assert.ok(viewA.element.querySelector('[data-testid="execution-breadcrumbs"]'));

  // The drill-down control exists for tasks and batches, absent at the attempt level.
  viewA.select('A');
  assert.ok(viewA.element.querySelector('[data-testid="execution-drill"]'));
  const viewTask = createExecutionView({ document: documents.aTask, timeline: model });
  viewTask.select('attempt:executor:resumed');
  assert.equal(viewTask.element.querySelector('[data-testid="execution-drill"]'), null);
  const attemptCard = viewTask.element.querySelector('.execution-node[data-node-id="attempt:executor:killed"]');
  assert.equal(attemptCard.querySelectorAll('.status')[0].dataset.state, 'stale',
    'the interrupted attempt renders stale, never running');

  // 12. Fixture B DOM: blocked join visible expanded; collapsed gate reveals the pending check.
  const viewB = createExecutionView({ document: documents.bBatch, timeline: model });
  const joinCard = viewB.element.querySelector('.execution-node[data-node-id="join:plan:execution-b:J"]');
  assert.ok(joinCard.textContent.includes('Blocked'));
  const viewBPlan = createExecutionView({ document: documents.bPlan, timeline: model });
  const gateCard = viewBPlan.element.querySelector('.execution-node[data-node-id="gate:plan:execution-b"]');
  assert.match(gateCard.textContent, /collapsed: 2 checks, 1 pending/);
  viewBPlan.toggleGroup('gate:plan:execution-b');
  assert.ok(viewBPlan.element.querySelector('.execution-node[data-node-id="check:plan:execution-b:B:c1"]'));
  assert.match(viewBPlan.element.querySelector('.execution-node[data-node-id="check:plan:execution-b:B:c1"]').textContent, /Pending/);

  // 13. The exact consumed fixture is exported for the browser proof (same data path).
  mkdirSync(evidenceDirectory, { recursive: true });
  const laterAsOf = new Date(Date.now() + 60000).toISOString();
  const laterRecords = await producerAttemptObservations({
    projectRoot: fixture.root, runId: 'probe', observedAt: laterAsOf, staleAfterMs: 100,
    attempts: [
      { attemptId: 'executor:killed', waitingMarker: fixture.markerK },
      { attemptId: 'executor:resumed', resumesAttemptId: 'executor:killed' },
      { attemptId: 'executor:overlap-b', waitingMarker: fixture.markerB },
      { attemptId: 'verifier:distinct' },
    ],
  });
  const fixtureJson = {
    writtenAt: new Date().toISOString(), projectId: PROJECT_ID, runId: 'probe',
    state: observedState, graphDocuments: graphDocuments(observedState), facts: factsInput, batches: BATCHES,
    initial: {
      observations: snapshot.observations, asOf: observedAt, timeline: model,
      documents: {
        'fixture-a-plan': documents.aPlan, 'fixture-a-batch': documents.aBatch, 'fixture-a-task': documents.aTask,
        'fixture-b-plan': documents.bPlan, 'fixture-b-batch': documents.bBatch,
      },
    },
    update: { observations: laterRecords, asOf: laterAsOf, timeline: nextTimeline },
  };
  writeFileSync(join(evidenceDirectory, 'execution-fixture.json'), `${JSON.stringify(fixtureJson, null, 2)}\n`);
  assert.equal(tasksWithAttempts({ set: composed, planId: 'plan:execution-a', observations: snapshot.observations }).join(), 'A');
  assert.deepEqual(tasksWithAttempts({ set: composed, planId: 'plan:execution-b', observations: snapshot.observations }).sort(), ['A', 'B']);
});

test('adversarial: stale attempts fail closed and never fabricate liveness or terminal outcomes', async () => {
  const observedAt = new Date().toISOString();
  const base = {
    id: 'observation:attempt:probe:executor:doctored', subject: { kind: 'run', id: 'probe' },
    classification: 'observed', observed_by: 'dashboard-producer/activity@1', observed_at: observedAt,
    provenance: { kind: 'native_event', reference: 'run:probe#doctored' }, content_revision: null,
  };
  const activity = over => JSON.stringify({
    schema_version: 'lazybuddy.producer-attempt-activity.v1', role: 'worker',
    agent: { id: 'worker:executor-a', role: 'worker' }, session: { id: 's1', basis: 'process', pid: 1 },
    attempt: { id: 'executor:doctored', task_id: 'A', criterion_id: 'C1', criterion_version: 1, plan_revision: 1,
      consumed_plan_revision: 1, resumes_attempt: null, resume_relation: null, resume_basis: null },
    step: { id: 'step:executor:doctored:0', command_index: 0, argv_sha256: '0'.repeat(64) },
    activity: { state: 'stale', liveness: 'unknown', interval: { start: observedAt, ...over }, waiting: null,
      duration_basis: 'recorded-session-duration', live_conversational_agent: false },
    delivery: { dispatch: { status: 'published' }, ack: { status: 'observed' }, consumption: { status: 'unobserved' } },
    conversational_telemetry: { status: 'unavailable', reason: 'NOT_REPORTED_BY_PRODUCER' },
  });
  // A doctored "stale" record claiming a terminal end fails closed.
  assert.throws(() => parseAttemptObservations([{ ...base, text: activity({ end: observedAt, end_observed: true }) }]),
    error => error.code === 'STALE_ATTEMPT_NEEDS_OPEN_INTERVAL');
  // A missing interval start fails closed.
  assert.throws(() => parseAttemptObservations([{ ...base, id: 'observation:attempt:probe:executor:open', text: activity({ start: null }) }]),
    error => error.code === 'INTERVAL_START_REQUIRED');
  // Duplicate observation identities fail closed.
  const single = [{ ...base, text: activity({}) }];
  parseAttemptObservations(single);
  assert.throws(() => parseAttemptObservations([...single, ...single.map(entry => ({ ...entry }))]),
    error => error.code === 'DUPLICATE_OBSERVATION');
  // Unsupported observations are ignored with a typed reason, never reinterpreted.
  const ignored = parseAttemptObservations([
    { ...base, id: 'observation:git:probe', text: JSON.stringify({ schema_version: 'other.v1', status: 'observed' }) },
    { ...base, id: 'observation:broken:probe', text: '{not json' },
  ]);
  assert.deepEqual(ignored.attempts, []);
  assert.deepEqual(ignored.ignored.map(entry => entry.reason), ['UNSUPPORTED_OBSERVATION', 'UNSUPPORTED_OBSERVATION']);
  // timelineModel requires an as-of time.
  const parsed = parseAttemptObservations(single);
  assert.throws(() => timelineModel(parsed.attempts, {}), error => error.code === 'AS_OF_REQUIRED');
  // A genuinely stale-but-open record renders stale, never running.
  const model = timelineModel(parsed.attempts, { asOf: observedAt });
  assert.equal(model.intervals[0].state, 'stale');
  assert.equal(model.intervals[0].open, true);
  assert.equal(model.intervals[0].renderedEndMs, Date.parse(observedAt));
});

test('adversarial: an invalid cycle cannot enter the rendered DAG through the execution path', () => {
  const documents = graphDocuments();
  const doctored = structuredClone(documents[1]);
  // Doctor a mutual dependency A <-> J: compose must reject it before any rendering.
  doctored.tasks.find(task => task.id === 'A').dependencies = [
    { id: 'dep-cycle', kind: 'depends-on-gate', condition: 'independent-verification-confirmed',
      target: { type: 'task', plan_id: 'plan:execution-b', task_id: 'J' } }];
  assert.throws(() => composeGraphSet([documents[0], doctored], { state: minimalPlanState() }),
    error => error.code === 'INVALID_CYCLE');
  assert.throws(() => executionDocument({ state: minimalPlanState(), set: { graphFor: () => null },
    planId: 'plan:none', observations: [], level: 'plan' }), error => error.code === 'UNKNOWN_PLAN');
});

// Minimal plan registry for compose grounding in the pure adversarial test:
// composeGraphSet only resolves plan identities from state.plans here.
function minimalPlanState() {
  return { plans: [{ id: 'plan:execution-a' }, { id: 'plan:execution-b' }] };
}
