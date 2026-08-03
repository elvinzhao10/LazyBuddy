'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { defaultRouteForHost } = require('../scripts/lifecycle/host-handoff');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const CLI = path.join(PLUGIN_ROOT, 'scripts', 'lazybuddy-codebuddy-ide-surfaces.js');
const MARKETPLACE = path.join(PLUGIN_ROOT, '..', '.codebuddy-plugin', 'marketplace.json');
const SURFACES = [
  'automation-status',
  'plan-design-todo',
  'plan-files',
  'primary-root-branch',
  'queue-parallel-status',
  'skill-management',
  'task-continuation',
  'workspace-grouped-tasks',
];

function command(args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: PLUGIN_ROOT, encoding: 'utf8' });
}

function output(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.notEqual(result.stdout, '');
  return JSON.parse(result.stdout);
}

function nativeFixture(t) {
  const sandbox = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lazybuddy ide hostile '));
  const projectRoot = path.join(sandbox, 'project');
  const pendingPath = path.join(sandbox, 'pending.json');
  const observationPath = path.join(sandbox, 'observation.json');
  const observedPath = path.join(sandbox, 'observed.json');
  fs.mkdirSync(projectRoot);
  t.after(() => fs.rmSync(sandbox, { recursive: true }));
  const pending = output(command([
    'template', '--project-root', projectRoot, '--primary-root', projectRoot, '--branch', 'main',
    '--marketplace', MARKETPLACE, '--output', pendingPath, '--generated-at', '2026-08-03T10:00:00Z', '--json',
  ]));
  const observation = {
    schema_version: 1,
    record_type: 'codebuddy-ide-native-observation',
    observation_id: 'obs:ide:001',
    session_id: 'session:001',
    observed_at: '2026-08-03T10:05:00Z',
    expires_at: '2026-08-03T11:05:00Z',
    marketplace: pending.marketplace,
    workspace: { roots: [projectRoot], primary_root: projectRoot, branch: 'main' },
    surfaces: SURFACES.map(surface_id => ({ surface_id, status: 'observed', value_digest: 'a'.repeat(64) })),
    tasks: [{ task_id: 'task:001', group_id: 'group:project', status: 'queued', value_digest: 'b'.repeat(64) }],
  };
  return { sandbox, projectRoot, pendingPath, observationPath, observedPath, pending, observation };
}

function observeFixture(fixture, now = '2026-08-03T10:10:00Z') {
  fs.writeFileSync(fixture.observationPath, `${JSON.stringify(fixture.observation)}\n`);
  return command([
    'observe', '--template', fixture.pendingPath, '--observation', fixture.observationPath,
    '--output', fixture.observedPath, '--now', now, '--json',
  ]);
}

function errorCode(result) {
  assert.equal(result.status, 1, result.stdout);
  return JSON.parse(result.stderr).error.code;
}

test('CodeBuddy IDE keeps the CLI-backed marketplace as its default route', () => {
  // Given: the CodeBuddy IDE host identity.
  // When: lifecycle status selects the default installation route.
  const route = defaultRouteForHost('codebuddy-ide');

  // Then: the persistent user-scope marketplace remains the default.
  assert.equal(route, 'codebuddy-marketplace');
});

test('pending native template ingests sanitized IDE observations without promoting readiness', (t) => {
  // Given: a real project root and the shipped release-root marketplace.
  const sandbox = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lazybuddy ide native '));
  const projectRoot = path.join(sandbox, 'project');
  const pendingPath = path.join(sandbox, 'pending.json');
  const observationPath = path.join(sandbox, 'observation.json');
  const observedPath = path.join(sandbox, 'observed.json');
  fs.mkdirSync(projectRoot);
  t.after(() => fs.rmSync(sandbox, { recursive: true }));

  // When: the CLI emits a pending template and ingests a current sanitized host observation.
  const pending = output(command([
    'template', '--project-root', projectRoot, '--primary-root', projectRoot, '--branch', 'main',
    '--marketplace', MARKETPLACE, '--output', pendingPath, '--generated-at', '2026-08-03T10:00:00Z', '--json',
  ]));
  fs.writeFileSync(observationPath, `${JSON.stringify({
    schema_version: 1,
    record_type: 'codebuddy-ide-native-observation',
    observation_id: 'obs:ide:001',
    session_id: 'session:001',
    observed_at: '2026-08-03T10:05:00Z',
    expires_at: '2026-08-03T11:05:00Z',
    marketplace: pending.marketplace,
    workspace: { roots: [projectRoot], primary_root: projectRoot, branch: 'main' },
    surfaces: SURFACES.map(surface_id => ({ surface_id, status: 'observed', value_digest: 'a'.repeat(64) })),
    tasks: [{ task_id: 'task:001', group_id: 'group:project', status: 'queued', value_digest: 'b'.repeat(64) }],
  })}\n`);
  const observed = output(command([
    'observe', '--template', pendingPath, '--observation', observationPath, '--output', observedPath,
    '--now', '2026-08-03T10:10:00Z', '--json',
  ]));

  // Then: the observation is recorded, marketplace-bound, and cannot promote host readiness.
  assert.equal(pending.status, 'pending');
  assert.equal(pending.installation_route, 'codebuddy-marketplace');
  assert.equal(observed.status, 'observed');
  assert.equal(observed.host_readiness.status, 'pending');
  assert.equal(observed.promotion, 'prohibited');
  assert.deepEqual(observed.freshness.marketplace_identity, pending.marketplace);
  assert.deepEqual(JSON.parse(fs.readFileSync(observedPath, 'utf8')), observed);
});

test('template refuses multiple workspace roots without an explicit primary root', (t) => {
  // Given: two real workspace roots and no primary-root selection.
  const sandbox = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lazybuddy ide roots '));
  const first = path.join(sandbox, 'first');
  const second = path.join(sandbox, 'second');
  fs.mkdirSync(first);
  fs.mkdirSync(second);
  t.after(() => fs.rmSync(sandbox, { recursive: true }));

  // When: a pending template is requested for both roots.
  const result = command([
    'template', '--project-root', first, '--project-root', second, '--branch', 'main',
    '--marketplace', MARKETPLACE, '--output', path.join(sandbox, 'pending.json'),
    '--generated-at', '2026-08-03T10:00:00Z', '--json',
  ]);

  // Then: the command fails closed before emitting a template.
  assert.equal(errorCode(result), 'PRIMARY_ROOT_REQUIRED');
  assert.equal(fs.existsSync(path.join(sandbox, 'pending.json')), false);
});

test('observation refuses a stale marketplace version', (t) => {
  // Given: a pending template and an observation for an older marketplace version.
  const fixture = nativeFixture(t);
  fixture.observation.marketplace = { ...fixture.observation.marketplace, version: '1.0.2' };

  // When: the stale observation crosses the receipt boundary.
  const result = observeFixture(fixture);

  // Then: marketplace freshness fails and no mirror is emitted.
  assert.equal(errorCode(result), 'MARKETPLACE_STALE');
  assert.equal(fs.existsSync(fixture.observedPath), false);
});

test('observation refuses an unknown persistent task status', (t) => {
  // Given: a sanitized observation with a task state outside the native vocabulary.
  const fixture = nativeFixture(t);
  fixture.observation.tasks[0].status = 'maybe-done';

  // When: the observation crosses the receipt boundary.
  const result = observeFixture(fixture);

  // Then: the unknown state is rejected rather than folded into completion.
  assert.equal(errorCode(result), 'UNKNOWN_TASK_STATUS');
  assert.equal(fs.existsSync(fixture.observedPath), false);
});

test('observation refuses duplicate native mirrors', (t) => {
  // Given: an observation that repeats one surface and omits another.
  const fixture = nativeFixture(t);
  fixture.observation.surfaces[7].surface_id = fixture.observation.surfaces[0].surface_id;

  // When: the observation crosses the receipt boundary.
  const result = observeFixture(fixture);

  // Then: duplicate mirror identity fails closed.
  assert.equal(errorCode(result), 'DUPLICATE_MIRROR');
  assert.equal(fs.existsSync(fixture.observedPath), false);
});

test('observation refuses package-only readiness promotion', (t) => {
  // Given: an otherwise valid observation carrying a forged readiness claim.
  const fixture = nativeFixture(t);
  fixture.observation.host_readiness = { status: 'ready', source: 'package' };

  // When: package-only evidence crosses the receipt boundary.
  const result = observeFixture(fixture);

  // Then: the unexpected promotion field is rejected and nothing is written.
  assert.equal(errorCode(result), 'NATIVE_OBSERVATION_INVALID');
  assert.equal(fs.existsSync(fixture.observedPath), false);
});

test('hostile task strings remain inert and cannot create a receipt', (t) => {
  // Given: a task identifier containing a shell substitution and a target marker.
  const fixture = nativeFixture(t);
  const marker = path.join(fixture.sandbox, 'executed');
  fixture.observation.tasks[0].task_id = `task:$(touch ${marker})`;

  // When: the hostile observation crosses the JSON boundary.
  const result = observeFixture(fixture);

  // Then: it is rejected as data without executing or promoting anything.
  assert.equal(errorCode(result), 'NATIVE_OBSERVATION_INVALID');
  assert.equal(fs.existsSync(marker), false);
  assert.equal(fs.existsSync(fixture.observedPath), false);
});

test('failed repeated ingestion preserves the prior atomic receipt', (t) => {
  // Given: one successfully written receipt followed by an invalid repeated observation.
  const fixture = nativeFixture(t);
  const initial = output(observeFixture(fixture));
  const initialBytes = fs.readFileSync(fixture.observedPath, 'utf8');
  fixture.observation.tasks[0].status = 'unknown';

  // When: repeated ingestion fails before the atomic replacement boundary.
  const result = observeFixture(fixture);

  // Then: the prior receipt remains byte-identical and still non-promoting.
  assert.equal(errorCode(result), 'UNKNOWN_TASK_STATUS');
  assert.equal(fs.readFileSync(fixture.observedPath, 'utf8'), initialBytes);
  assert.equal(initial.host_readiness.status, 'pending');
});

test('observation refuses February 30 instead of normalizing it as current', (t) => {
  // Given: an ISO-shaped observation whose calendar date does not exist.
  const fixture = nativeFixture(t);
  fixture.observation.observed_at = '2026-02-30T10:05:00Z';
  fixture.observation.expires_at = '2026-02-30T11:05:00Z';

  // When: the impossible date crosses the timestamp boundary.
  const result = observeFixture(fixture, '2026-02-30T10:10:00Z');

  // Then: the command rejects it as malformed and emits no current receipt.
  assert.equal(errorCode(result), 'NATIVE_OBSERVATION_INVALID');
  assert.equal(fs.existsSync(fixture.observedPath), false);
});
