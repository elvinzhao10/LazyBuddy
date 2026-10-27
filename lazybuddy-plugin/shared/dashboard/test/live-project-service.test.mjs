import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile, unlink, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { serviceFixture, serviceCLI, http } from './service-fixture.mjs';
import { plugin, processCall } from './command-fixture.mjs';
import { listen } from '../service-http.mjs';
import { ServiceError } from '../service-files.mjs';

const projectCLI = fileURLToPath(new URL('../../project/cli.mjs', import.meta.url));
const digest = value => createHash('sha256').update(value).digest('hex');

async function projectCall(root, action, value) {
  return processCall([process.execPath, projectCLI, action, '--project-root', root,
    '--project-id', 'project:b1', '--actor', 'test:live-project'], value === undefined ? '' : JSON.stringify(value));
}

test('authenticated project routes read native state and registered Markdown through one bounded authority', async () => {
  const f = await serviceFixture();
  const markdown = '# Live plan\n\n- [ ] Read the registered original\n';
  try {
    assert.equal((await f.request('/api/project')).status, 404, 'project initialization remains explicit');
    assert.equal((await http(f.live.url, '/api/project')).status, 401, 'project state requires the in-memory session');
    await mkdir(join(f.root, '.omo/plans'), { recursive: true });
    await writeFile(join(f.root, '.omo/plans/live.md'), markdown);
    await writeFile(join(f.root, '.omo/plans/nested.md'), '# Nested identity\n');
    assert.equal((await projectCall(f.root, 'init')).code, 0);
    assert.equal((await http(f.live.url, '/api/project/telemetry')).status, 401);
    const telemetry = await f.request('/api/project/telemetry');
    assert.equal(telemetry.status, 200);
    assert.equal(telemetry.value.schema, 'lazyseries/runtime-telemetry@1');
    assert.equal(telemetry.value.project_id, 'project:b1');
    assert.equal(telemetry.value.run_id, f.options.runId);
    assert.equal(telemetry.value.usage, null, 'absence of structured usage is not a zero token claim');
    const usageRecord = { id: 'usage:recorded', request_id: 'request:recorded', kind: 'final-value',
      observed_at: '2026-10-26T12:00:00Z', usage: { input_tokens: 123, output_tokens: 21, cached_input: 80 }, status: 'completed' };
    const recordedUsage = await processCall(['bash', join(plugin, 'scripts/state/append-event.sh'), f.options.runId, 'provider_usage',
      JSON.stringify({ usage_record: usageRecord })], '', { CWD: f.root });
    assert.equal(recordedUsage.code, 0, recordedUsage.stderr);
    const usageResponse = await f.request('/api/project/telemetry');
    assert.equal(usageResponse.status, 200);
    assert.equal(usageResponse.value.usage.total_tokens, 144, 'native event capture supplies provider usage without double counting cached tokens');
    await mkdir(join(f.root, '.lazybuddy/state/telemetry'), { recursive: true });
    const costPath = join(f.root, '.lazybuddy/state/telemetry/cost-outcomes.json');
    await writeFile(costPath, JSON.stringify({ schema_version: 'lazyseries.cost-outcome-store.v1', completed: [{ schema_version: 'lazyseries.cost-outcome.v1',
      run_id: 'cost:fixture', route: 'direct', measurement_scope: 'fixture-validation', elapsed_ms: 200, tool_invocations: 3, agent_invocations: 1,
      evidence_bytes: 20, reruns: 0, rework_count: 0 }] }));
    const cost = (await f.request('/api/project/telemetry')).value.cost_history;
    assert.equal(cost.state, 'observed'); assert.equal(cost.records[0].measurement_scope, 'fixture-validation');
    await unlink(costPath); await symlink(join(f.root, 'proof.txt'), costPath);
    const linkedCost = (await f.request('/api/project/telemetry')).value.cost_history;
    assert.equal(linkedCost.state, 'unavailable'); assert.equal(linkedCost.code, 'COST_HISTORY_UNREADABLE');
    await unlink(costPath);
    const registered = await projectCall(f.root, 'command', { schema_version: 1, command_id: 'register:live',
      project_id: 'project:b1', expected_revision: 0, operation: 'register_source',
      payload: { id: 'source:live', path: '.omo/plans/live.md', role: 'plan' } });
    assert.equal(registered.code, 0, registered.stderr);
    const nested = await projectCall(f.root, 'command', { schema_version: 1, command_id: 'register:nested',
      project_id: 'project:b1', expected_revision: 1, operation: 'register_source',
      payload: { id: 'source:group/plan', path: '.omo/plans/nested.md', role: 'plan' } });
    assert.equal(nested.code, 0, nested.stderr);

    const project = await f.request('/api/project');
    assert.equal(project.status, 200); assert.equal(project.value.project.sources[0].id, 'source:live');
    const source = await f.request('/api/project/sources/source:live');
    assert.equal(source.status, 200); assert.equal(source.value.content, markdown);
    assert.equal(source.value.sha256, digest(markdown));
    const nestedSource = await f.request('/api/project/sources/source:group%2Fplan');
    assert.equal(nestedSource.status, 200); assert.equal(nestedSource.value.source_id, 'source:group/plan');
    assert.equal((await f.request('/api/project/sources/source:unknown')).status, 404);
    assert.equal((await f.request('/api/project/commands', { body: { schema_version: 1, command_id: 'foreign',
      project_id: 'project:foreign', expected_revision: 1, operation: 'register_plan', payload: {} } })).status, 409);

    const accepted = await f.request('/api/project/commands', { body: { schema_version: 1, command_id: 'plan:live',
      project_id: 'project:b1', expected_revision: 2, operation: 'register_plan', payload: { id: 'plan:live',
        source: { source_id: 'source:live', sha256: digest(markdown), anchor_id: 'document' },
        declared_lifecycle: 'planned', baseline_refs: [] } } });
    assert.equal(accepted.status, 200); assert.equal(accepted.value.receipt.status, 'saved');
    assert.equal(accepted.value.snapshot.plans[0].id, 'plan:live');
    const assessment = await f.request('/api/project/plan-transition-assessment', { body: {
      plan_id: 'plan:live', to_lifecycle: 'active', payload: {} } });
    assert.equal(assessment.status, 200); assert.equal(assessment.value.allowed, false);
    assert.ok(assessment.value.reasons.some(reason => reason.code === 'NATIVE_RUN_REQUIRED'));
    const architecture = await f.request('/api/project/architecture');
    assert.equal(architecture.status, 200); assert.equal(architecture.value.docId, 'architecture:project:b1');
    const git = await f.request('/api/project/git');
    assert.equal(git.status, 200); assert.ok(['observed', 'unavailable'].includes(git.value.git.status));
    const evidence = await f.request('/api/project/evidence');
    assert.equal(evidence.status, 200); assert.equal(evidence.value.docId, 'evidence:project:b1');

    const artifact = await f.request('/api/project/commands', { body: { schema_version: 1,
      command_id: 'artifact:live', project_id: 'project:b1', expected_revision: 3,
      operation: 'artifact.register', payload: { id: 'artifact:live-plan', type: 'design_note',
        producer: 'test:live-project', path: '.omo/plans/live.md', sha256: digest(markdown) } } });
    assert.equal(artifact.status, 200); assert.equal(artifact.value.receipt.status, 'saved');
    const indexedArtifactId = 'artifact:.omo/plans/live.md';
    const preview = await f.request('/api/project/evidence/preview', { body: { artifact_id: indexedArtifactId } });
    assert.equal(preview.status, 200, JSON.stringify(preview.value)); assert.equal(preview.value.available, true);
    assert.equal(preview.value.kind, 'markdown');
    assert.deepEqual(preview.value.blocks.slice(0, 2).map(block => block.type), ['heading', 'list_item']);
    assert.equal((await f.request('/api/project/evidence/preview', { body: { artifact_id: 'artifact:missing' } })).status, 404);
    assert.equal((await f.request('/api/project/evidence/preview', { body: { artifact_id: '../live.md' } })).status, 400);
    assert.equal((await http(f.live.url, '/api/project/evidence/preview', {
      body: { artifact_id: indexedArtifactId } })).status, 401);

    await unlink(join(f.root, '.omo/plans/live.md'));
    await symlink('/etc/passwd', join(f.root, '.omo/plans/live.md'));
    const refused = await f.request('/api/project/sources/source:live');
    assert.equal(refused.status, 422); assert.equal(refused.value.code, 'SOURCE_UNAVAILABLE');
    assert.equal(JSON.stringify(refused.value).includes('root:'), false, 'outside bytes never cross the route');
    const refusedPreview = await f.request('/api/project/evidence/preview', { body: { artifact_id: indexedArtifactId } });
    assert.equal(refusedPreview.status, 200); assert.equal(refusedPreview.value.available, false);
    assert.equal(refusedPreview.value.reason, 'artifact_inaccessible');
    assert.equal(JSON.stringify(refusedPreview.value).includes('root:'), false, 'symlink target bytes never cross the route');
  } finally { await f.cleanup(); }
});

test('an initialized project starts the authenticated shell before any native run exists', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'live-project-only-')));
  const args = ['--project-root', root, '--project-id', 'project:b1', '--asset-root', join(plugin, 'shared/dashboard/ui')];
  let live = null;
  try {
    assert.equal((await projectCall(root, 'init')).code, 0);
    const started = await processCall([process.execPath, serviceCLI, 'start', ...args]);
    assert.equal(started.code, 0, started.stderr); live = JSON.parse(started.stdout);
    const credential = await readFile(live.credential_file, 'utf8');
    const session = await http(live.url, '/api/session', { body: {}, headers: { 'x-dashboard-bootstrap': credential } });
    assert.equal(session.status, 200); const authorization = `Bearer ${session.value.token}`;
    const project = await http(live.url, '/api/project', { headers: { authorization } });
    assert.equal(project.status, 200); assert.equal(project.value.project.summary.plan_count, 0);
    const run = await http(live.url, '/api/snapshot', { headers: { authorization } });
    assert.equal(run.status, 409); assert.equal(run.value.code, 'RUN_NOT_BOUND');
    assert.equal((await http(live.url, '/')).status, 200, 'the exact production shell assets remain available');
  } finally {
    if (live) {
      const stopped = await processCall([process.execPath, serviceCLI, 'stop', ...args]);
      assert.equal(stopped.code, 0, stopped.stderr);
    }
    await rm(root, { recursive: true, force: true });
  }
});

test('project-only and a real run named project-only retain separate service identities', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'live-project-binding-')));
  const common = ['--project-root', root, '--project-id', 'project:b1',
    '--asset-root', join(plugin, 'shared/dashboard/ui')];
  const projectArgs = [...common];
  const runArgs = [...common, '--run-id', 'project-only'];
  let projectLive = null; let runLive = null;
  try {
    assert.equal((await processCall(['bash', join(plugin, 'scripts/state/create-run.sh'),
      'project-only', 'Lifecycle namespace regression'], '', { CWD: root })).code, 0);
    assert.equal((await projectCall(root, 'init')).code, 0);
    const projectStarted = await processCall([process.execPath, serviceCLI, 'start', ...projectArgs]);
    assert.equal(projectStarted.code, 0, projectStarted.stderr); projectLive = JSON.parse(projectStarted.stdout);
    const runStarted = await processCall([process.execPath, serviceCLI, 'start', ...runArgs]);
    assert.equal(runStarted.code, 0, runStarted.stderr); runLive = JSON.parse(runStarted.stdout);
    assert.notEqual(projectLive.credential_file, runLive.credential_file);
    assert.notEqual(projectLive.identity.instance, runLive.identity.instance);
    assert.notEqual(projectLive.identity.port, runLive.identity.port);
    assert.equal(projectLive.identity.runId, null);
    assert.equal(runLive.identity.runId, 'project-only');
  } finally {
    if (runLive) assert.equal((await processCall([process.execPath, serviceCLI, 'stop', ...runArgs])).code, 0);
    if (projectLive) assert.equal((await processCall([process.execPath, serviceCLI, 'stop', ...projectArgs])).code, 0);
    await rm(root, { recursive: true, force: true });
  }
});

test('project transport preserves a stale artifact preview as ARTIFACT_CHANGED 409', async () => {
  const credential = 'a'.repeat(64);
  const control = { credential, identity: { port: 0 } };
  const live = await listen({ port: 0, projectId: 'project:b1', runId: null,
    authority: { readProjectEvidencePreview() { throw new ServiceError('ARTIFACT_CHANGED', 409); } } }, control);
  try {
    const session = await http(live.origin, '/api/session', { body: {},
      headers: { 'x-dashboard-bootstrap': credential } });
    assert.equal(session.status, 200);
    const response = await http(live.origin, '/api/project/evidence/preview', {
      body: { artifact_id: 'artifact:stale-preview' },
      headers: { authorization: `Bearer ${session.value.token}` } });
    assert.equal(response.status, 409);
    assert.deepEqual(response.value, { status: 'rejected', code: 'ARTIFACT_CHANGED' });
  } finally { await live.close(); }
});
