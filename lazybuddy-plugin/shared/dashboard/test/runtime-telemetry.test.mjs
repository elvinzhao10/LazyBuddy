import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeTelemetry, attachCostHistory } from '../adapters/telemetry.mjs';
import { queueFixture, accepted } from './queue-fixture.mjs';
import { processCall, plugin } from './command-fixture.mjs';
import { readInput } from '../commands.mjs';
import { buddyAuthority } from '../service-adapter.mjs';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

const project = { project_id: 'project:telemetry', revision: 1, sources: [], observations: [] };
const usage = (id, kind, values) => ({ event: 'usage', payload: { usage_record: { id, request_id: 'request:one', kind,
  observed_at: '2026-10-26T12:00:00Z', usage: values, status: 'failed' } } });

test('real post-tool hook advisory rows keep a bound native run readable without granting completion authority', async () => {
  const f = await queueFixture('hook-telemetry');
  try {
    accepted(await f.create()); accepted(await f.call('activate', f.activation));
    const statePath = join(f.root, '.lazybuddy/runs', f.activation.run_id, 'state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8')); state.status = 'executing'; await writeFile(statePath, JSON.stringify(state));
    const hook = await processCall(['bash', join(plugin, 'scripts/hooks/post-tool-use.sh')],
      JSON.stringify({ cwd: f.root, tool_name: 'mcp__docs__search', tool_input: { prompt: 'private-input' } }), { CWD: f.root });
    assert.equal(hook.code, 0, hook.stderr);
    const run = buddyAuthority.project(await readInput({ ...f.binding, runId: f.activation.run_id }));
    const observation = run.observations.find(entry => entry.event === 'post-tool-use'); assert.ok(observation);
    assert.equal(observation.payload.tool_name, 'mcp__docs__search'); assert.equal(observation.provenance.kind, 'legacy');
    assert.ok(run.tasks.every(task => task.verification !== 'verified'));
    const telemetry = runtimeTelemetry(project, run);
    assert.equal(telemetry.monitor.trace[0].kind, 'mcp'); assert.ok(!JSON.stringify(telemetry).includes('private-input'));
  } finally { await f.cleanup(); }
});

test('runtime telemetry leaves absent usage unknown and keeps exact zero distinct', () => {
  assert.equal(runtimeTelemetry(project).usage, null);
  const result = runtimeTelemetry(project, { run_id: 'run', tasks: [], observations: [usage('zero', 'final-value', { total_tokens: 0 })] });
  assert.equal(result.usage.total_tokens, 0); assert.equal(result.usage.complete, true);
});

test('runtime telemetry normalizes physical requests without adding cached/reasoning subsets or parent aggregates', () => {
  const parent = usage('parent', 'parent-aggregate', { total_tokens: 900 });
  parent.payload.usage_record.request_id = 'request:parent';
  const result = runtimeTelemetry(project, { run_id: 'run', tasks: [], observations: [
    usage('delta', 'delta', { input_tokens: 60 }), usage('final', 'final-value', { input_tokens: 100, output_tokens: 20, cached_input: 50, reasoning_output: 10 }),
    parent,
  ] });
  assert.equal(result.usage.total_tokens, 120); assert.equal(result.usage.requests.length, 1);
});

test('partial usage stays partial and malformed usage becomes an inspectable problem', () => {
  const partial = runtimeTelemetry(project, { tasks: [], observations: [usage('input-only', 'final-value', { input_tokens: 10 })] });
  assert.equal(partial.usage.total_tokens, null); assert.equal(partial.usage.complete, false);
  const invalid = runtimeTelemetry(project, { tasks: [], observations: [usage('bad', 'mystery', { total_tokens: 100 })] });
  assert.equal(invalid.usage, null); assert.equal(invalid.problems[0].id, 'usage-records');
});

test('failed and blocked work, source problems and run collector failures stay visible', () => {
  const result = runtimeTelemetry({ ...project, sources: [{ id: 'source:a', path: 'plan.md', observation: { status: 'missing' } }] },
    { run_id: 'run', tasks: [{ id: 'task:a', title: 'Failed build', execution: 'failed', verification: 'unverified' }], observations: [] }, 'RUN_READ_FAILED');
  assert.equal(result.tasks.failed, 1); assert.equal(result.problems_total, 3);
});

test('run monitor separates execution from verification, uses real UTC bins and leaves unreported usage gaps', () => {
  const event = (minute, payload = {}) => ({ event: 'post-tool-use', payload, provenance: { timestamp: `2026-10-26T12:${minute}:00Z`, source_id: 'ledger', line: 1 } });
  const result = runtimeTelemetry(project, { run_id: 'run', tasks: [
    { id: 'T1', execution: 'finished', criteria: [{ applicability: 'required', verification: 'unverified' }], attempts: [] },
    { id: 'T2', execution: 'failed', blocker: 'blocked', criteria: [{ applicability: 'optional', verification: 'verified' }] }
  ], observations: [event('00'), event('03')] });
  assert.deepEqual(result.monitor.progress, { finished: 1, total: 2, verified: 0, required: 1, blocked: 1 });
  assert.equal(result.monitor.bins.length, 4);
  assert.deepEqual(result.monitor.bins.map(bin => bin.events), [1, 0, 0, 1]);
  assert.ok(result.monitor.bins.every(bin => bin.tokens === null));
});

test('resource observations expose bounded identity and provenance without raw tool inputs or configuration values', () => {
  const result = runtimeTelemetry(project, { tasks: [], observations: [{ event: 'harness_step', provenance: { timestamp: '2026-10-26T12:00:00Z',
    source_id: 'native', source_event_id: 'step:1', line: 7 }, payload: { runtime_trace: { kind: 'mcp', name: 'search', server_name: 'docs', task_id: 'T1',
    attempt_id: 'attempt:1', worker_id: 'worker:1', model: 'model:one', settings_profile: 'profile:strict', status: 'completed', duration_ms: 25,
    env: { API_KEY: 'private-value' }, arguments: 'private-input' } } }] });
  const trace = result.monitor.trace[0]; assert.equal(trace.task_id, 'T1'); assert.equal(trace.server, 'docs'); assert.equal(trace.line, 7);
  assert.equal(trace.settings_profile, 'profile:strict'); assert.equal(trace.duration_ms, 25);
  assert.ok(!JSON.stringify(result).includes('private-value')); assert.ok(!JSON.stringify(result).includes('private-input'));
});

test('token bins count normalized requests once and exclude aggregate and cached subsets', () => {
  const final = usage('final', 'final-value', { input_tokens: 100, output_tokens: 10, cached_input: 50 });
  const result = runtimeTelemetry(project, { tasks: [], observations: [usage('delta', 'delta', { input_tokens: 500 }), final] });
  assert.equal(result.monitor.bins.reduce((sum, bin) => sum + (bin.tokens ?? 0), 0), 110);
});

test('retained efficiency history stays scoped, bounded and allowlisted; unsafe reads never scan elsewhere', async () => {
  const record = { schema_version: 'lazyseries.cost-outcome.v1', run_id: 'r1', route: 'direct', measurement_scope: 'fixture-validation',
    elapsed_ms: 60000, tool_invocations: 5, agent_invocations: 1, evidence_bytes: 20, reruns: 0, rework_count: 0, secret: 'private-value' };
  const paths = [];
  const readFile = async (path, limit) => { paths.push(path); assert.equal(limit, 1048576);
    return JSON.stringify({ schema_version: 'lazyseries.cost-outcome-store.v1', completed: [record] }); };
  const result = await attachCostHistory({}, { runtime: 'LazyTrae', readFile });
  assert.deepEqual(paths, ['.lazytrae/state/telemetry/cost-outcomes.json']); assert.equal(result.cost_history.records[0].measurement_scope, 'fixture-validation');
  assert.ok(!JSON.stringify(result).includes('private-value'));
  const invalid = await attachCostHistory({}, { runtime: 'LazyBuddy', readFile: async () => JSON.stringify({ schema_version: 'lazyseries.cost-outcome-store.v1', completed: [record, record] }) });
  assert.equal(invalid.cost_history.state, 'unavailable');
  const unreadable = await attachCostHistory({}, { runtime: 'LazyBuddy', readFile: async () => { throw new Error('/private/path'); } });
  assert.equal(unreadable.cost_history.code, 'COST_HISTORY_UNREADABLE'); assert.ok(!JSON.stringify(unreadable).includes('/private/path'));
});

test('token bins bind repeated record IDs to their physical requests', () => {
  const first = usage('shared', 'final-value', { total_tokens: 10 });
  const second = usage('shared', 'final-value', { total_tokens: 20 });
  first.payload.usage_record.request_id = 'request:first';
  second.payload.usage_record.request_id = 'request:second';
  second.payload.usage_record.observed_at = '2026-10-26T12:03:00Z';
  const result = runtimeTelemetry(project, { tasks: [], observations: [first, second] });
  assert.deepEqual(result.monitor.bins.map(bin => bin.tokens), [10, null, null, 20]);
});

test('overflowed token bins stay unknown when later requests are recorded', () => {
  const observations = [Number.MAX_SAFE_INTEGER, 1, 2].map((value, index) => {
    const item = usage(`record:${index}`, 'final-value', { total_tokens: value });
    item.payload.usage_record.request_id = `request:${index}`;
    return item;
  });
  const result = runtimeTelemetry(project, { tasks: [], observations });
  assert.equal(result.monitor.bins[0].tokens, null);
});
