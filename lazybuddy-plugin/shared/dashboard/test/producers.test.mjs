import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { processCall } from './command-fixture.mjs';
import { buddyAuthority } from '../service-adapter.mjs';

const plugin = fileURLToPath(new URL('../../../', import.meta.url));
const producer = join(plugin, 'shared/dashboard/producers.mjs');
const workload = join(plugin, 'shared/dashboard/test/producer-workload.mjs');
const python = process.env.B4_PYTHON ?? 'python3';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function call(root, args) {
  return processCall([process.execPath, producer, ...args, '--project-root', root, '--project-id', 'project:b4',
    '--run-id', 'probe', '--actor', 'chat:b4', '--python', python]);
}
async function context(root, attempt, worker, index) {
  const result = await call(root, ['context', '--parent-task-id', 'P', '--task-id', 'A', '--criterion-id', 'C1',
    '--attempt-id', attempt, '--worker-id', worker, '--plan-commands-file', join(root, '.lazybuddy/runs/probe/commands.json'),
    '--command-index', String(index)]);
  assert.equal(result.code, 0, result.stderr);
  const file = join(root, '.lazybuddy', `${attempt}.json`); await writeFile(file, result.stdout); return file;
}
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'b4-producer-')));
  await processCall(['git', '-C', root, 'init', '-q'], '', { GIT_CONFIG_NOSYSTEM: '1', HOME: root });
  await processCall(['git', '-C', root, 'config', 'user.name', 'Producer QA'], '', { GIT_CONFIG_NOSYSTEM: '1', HOME: root });
  await processCall(['git', '-C', root, 'config', 'user.email', 'producer@example.invalid'], '', { GIT_CONFIG_NOSYSTEM: '1', HOME: root });
  await writeFile(join(root, '.gitignore'), '.lazybuddy/\n');
  await processCall(['git', '-C', root, 'add', '.gitignore'], '', { GIT_CONFIG_NOSYSTEM: '1', HOME: root });
  await processCall(['git', '-C', root, 'commit', '-qm', 'fixture'], '', { GIT_CONFIG_NOSYSTEM: '1', HOME: root });
  const created = await processCall(['bash', join(plugin, 'scripts/state/create-run.sh'), 'probe', 'Producer QA'], '', { CWD: root, PATH: process.env.PATH });
  assert.equal(created.code, 0, created.stderr);
  const run = join(root, '.lazybuddy/runs/probe'); const head = (await processCall(['git', '-C', root, 'rev-parse', 'HEAD'])).stdout.trim();
  const plan = '# Plan\n- [x] [C1] Actual artifact is independently verified\n';
  const artifact = join(root, '.lazybuddy/runs/probe/actual.txt');
  const cancelledStarted = join(root, '.lazybuddy/runs/probe/cancelled-started');
  const cancelledRelease = join(root, '.lazybuddy/runs/probe/cancelled-release');
  const commands = [[process.execPath, workload, 'write', artifact, 'wrong'], [process.execPath, workload, 'verify', artifact, 'right'],
    [process.execPath, workload, 'write', artifact, 'right'],
    [process.execPath, workload, 'wait-write', artifact, 'cancelled', cancelledStarted, cancelledRelease]];
  const commandsBytes = `${JSON.stringify(commands)}\n`;
  const state = JSON.parse(await readFile(join(run, 'state.json')));
  state.status = 'active'; state.plan_reference = '.lazybuddy/runs/probe/plan.md'; state.plan_revision = 1;
  state._approved_plan_sha256 = digest(plan); state.dashboard_project_id = 'project:b4';
  state.tasks = [{ id: 'P', title: 'Parent', status: 'running', depends_on: [], execution_authority: {
    repo_head: head, criterion_ids: ['C1'], plan_reference: state.plan_reference, plan_sha256: digest(plan),
    plan_commands_path: '.lazybuddy/runs/probe/commands.json', plan_commands_sha256: digest(commandsBytes),
  } }, { id: 'A', title: 'Child', status: 'queued', depends_on: [], criteria: [{ id: 'C1', task_id: 'A', version: 1,
    requirement: 'Actual artifact is independently verified', applicability: 'required', verification: 'unverified', scenarios: [], result_ids: [], history: [] }] }];
  await mkdir(join(run, 'checkpoints'), { recursive: true });
  await Promise.all([writeFile(join(run, 'plan.md'), plan), writeFile(join(run, 'checkpoints/plan-revision.md'), plan),
    writeFile(join(run, 'commands.json'), commandsBytes), writeFile(join(run, 'state.json'), JSON.stringify(state))]);
  return { root, run, artifact, cleanup: () => rm(root, { recursive: true }) };
}

test('real failed verification is retained before distinct successful process publishes trusted snapshot proof', async () => {
  const f = await fixture();
  try {
    const executor1 = await context(f.root, 'executor:wrong', 'worker:executor-1', 0);
    const firstExecution = await call(f.root, ['execute', '--context-file', executor1, '--artifact-path', '.lazybuddy/runs/probe/actual.txt']);
    assert.equal(firstExecution.code, 0, firstExecution.stderr || firstExecution.stdout);
    const verifier1 = await context(f.root, 'verifier:wrong', 'worker:verifier-1', 1);
    const failed = await call(f.root, ['verify', '--context-file', verifier1, '--artifact-path', '.lazybuddy/runs/probe/actual.txt',
      '--executor-id', 'worker:executor-1', '--executor-attempt-id', 'executor:wrong']);
    assert.equal(failed.code, 9); await assert.rejects(readFile(join(f.run, 'completion-authority.json')));
    const cancelled = await context(f.root, 'executor:cancelled', 'worker:executor-cancelled', 3);
    const cancelFile = join(f.run, 'cancel'); await writeFile(cancelFile, 'cancel\n');
    const cancelledExecution = await call(f.root, ['execute', '--context-file', cancelled, '--cancel-file', cancelFile,
      '--artifact-path', '.lazybuddy/runs/probe/actual.txt']);
    assert.notEqual(cancelledExecution.code, 0); assert.equal(JSON.parse(cancelledExecution.stdout).terminal.result.status, 'cancelled');
    const executor2 = await context(f.root, 'executor:right', 'worker:executor-2', 2);
    const secondExecution = await call(f.root, ['execute', '--context-file', executor2, '--artifact-path', '.lazybuddy/runs/probe/actual.txt']);
    assert.equal(secondExecution.code, 0, secondExecution.stderr || secondExecution.stdout);
    const spoofed = await context(f.root, 'verifier:spoofed', 'worker:verifier-spoofed', 1);
    const rejected = await call(f.root, ['verify', '--context-file', spoofed, '--artifact-path', '.lazybuddy/runs/probe/actual.txt',
      '--executor-id', 'worker:invented', '--executor-attempt-id', 'executor:right']);
    assert.equal(rejected.code, 65); await assert.rejects(readFile(join(f.run, 'completion-authority.json')));
    const verifier2 = await context(f.root, 'verifier:right', 'worker:verifier-2', 1);
    const passed = await call(f.root, ['verify', '--context-file', verifier2, '--artifact-path', '.lazybuddy/runs/probe/actual.txt',
      '--executor-id', 'worker:executor-2', '--executor-attempt-id', 'executor:right']);
    assert.equal(passed.code, 0, passed.stderr);
    const input = await buddyAuthority.read({ projectRoot: f.root, projectId: 'project:b4', runId: 'probe', python });
    const snapshot = await buddyAuthority.project(input);
    assert.equal(snapshot.tasks.find(task => task.id === 'A').progress.verified, 1);
    assert.deepEqual(snapshot.tasks.find(task => task.id === 'A').attempts.map(item => item.execution),
      ['finished', 'failed', 'cancelled', 'finished', 'finished', 'finished']);
    const outputs = [JSON.parse((await readFile(executor2)).toString()), JSON.parse((await readFile(verifier2)).toString())];
    assert.notEqual(outputs[0].worker_id, outputs[1].worker_id);
  } finally { await f.cleanup(); }
});
