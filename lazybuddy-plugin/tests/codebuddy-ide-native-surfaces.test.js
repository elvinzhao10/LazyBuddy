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

function evidenceFixture(t) {
  const fixture = nativeFixture(t);
  const evidenceTemplatePath = path.join(fixture.sandbox, 'evidence-template.json');
  const evidenceObservationPath = path.join(fixture.sandbox, 'evidence-observation.json');
  const evidenceReceiptPath = path.join(fixture.sandbox, 'evidence-receipt.json');
  const template = output(command([
    'evidence-template', '--template', fixture.pendingPath, '--output', evidenceTemplatePath,
    '--generated-at', '2026-08-03T10:01:00Z', '--json',
  ]));
  const digest = 'c'.repeat(64);
  const surface = (surface_id, status, details) => ({
    surface_id,
    native_mode: template.surfaces.find((item) => item.surface_id === surface_id).native_mode,
    status,
    evidence_digest: digest,
    details,
  });
  const observation = {
    schema_version: 1,
    record_type: 'codebuddy-ide-evidence-observation',
    observation_id: 'obs:ide:evidence:001',
    session_id: 'session:evidence:001',
    observed_at: '2026-08-03T10:05:00Z',
    expires_at: '2026-08-03T11:05:00Z',
    marketplace: template.marketplace,
    workspace: template.workspace,
    surfaces: [
      surface('openFile', 'observed', { contract: 'documented', invocation: 'not-performed' }),
      surface('openDiff', 'observed', { contract: 'documented', invocation: 'not-performed' }),
      surface('getDiagnostics', 'observed', { captured_at: '2026-08-03T10:06:00Z', root: fixture.projectRoot, read_only: true }),
      surface('close_tab', 'observed', { contract: 'documented', invocation: 'not-performed' }),
      surface('oauth', 'unavailable', { availability: 'unavailable', reason_code: 'HOST_UNSUPPORTED' }),
      surface('roots', 'observed', { roots: [fixture.projectRoot] }),
      surface('sampling', 'unavailable', { availability: 'unavailable', reason_code: 'HOST_UNSUPPORTED' }),
      surface('prompts', 'unavailable', { availability: 'unavailable', reason_code: 'HOST_UNSUPPORTED' }),
      surface('resources', 'observed', { availability: 'available' }),
      surface('browser-preview', 'observed', { preview_id: 'preview:001' }),
      surface('browser-error-feedback', 'observed', { errors: [{ error_digest: 'd'.repeat(64), verification_evidence_digest: 'e'.repeat(64) }] }),
      surface('artifacts', 'observed', { entries: [{ entry_id: 'artifact:001', relative_path: 'artifacts/report.json', digest }] }),
      surface('files', 'observed', { entries: [{ entry_id: 'file:001', relative_path: 'src/app.js', digest }] }),
      surface('changes', 'observed', { entries: [{ entry_id: 'change:001', relative_path: 'src/app.js', digest }] }),
      surface('native-checkpoint-restore', 'observed', { checkpoint_id: 'checkpoint:001', scope_root: fixture.projectRoot, external_files: false, ledger_effect: 'none' }),
    ],
  };
  return { ...fixture, evidenceTemplatePath, evidenceObservationPath, evidenceReceiptPath, template, observation };
}

function observeEvidence(fixture, now = '2026-08-03T10:10:00Z') {
  fs.writeFileSync(fixture.evidenceObservationPath, `${JSON.stringify(fixture.observation)}\n`);
  return command([
    'evidence-observe', '--template', fixture.evidenceTemplatePath,
    '--observation', fixture.evidenceObservationPath, '--output', fixture.evidenceReceiptPath,
    '--now', now, '--json',
  ]);
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

test('IDE evidence template describes every native MCP, preview, artifact, and checkpoint surface', (t) => {
  // Given: the marketplace-bound pending IDE template from the native plan/task surface.
  const fixture = nativeFixture(t);
  const evidenceTemplatePath = path.join(fixture.sandbox, 'evidence-template.json');

  // When: a Todo16 evidence descriptor is requested without invoking the live host.
  const descriptor = output(command([
    'evidence-template', '--template', fixture.pendingPath, '--output', evidenceTemplatePath,
    '--generated-at', '2026-08-03T10:01:00Z', '--json',
  ]));

  // Then: every requested surface is pending with an explicit native mode.
  assert.equal(descriptor.record_type, 'codebuddy-ide-evidence-template');
  assert.deepEqual(descriptor.surfaces.map(({ surface_id, native_mode, status }) => ({ surface_id, native_mode, status })), [
    { surface_id: 'openFile', native_mode: 'invoke-documented', status: 'pending' },
    { surface_id: 'openDiff', native_mode: 'invoke-documented', status: 'pending' },
    { surface_id: 'getDiagnostics', native_mode: 'observe', status: 'pending' },
    { surface_id: 'close_tab', native_mode: 'invoke-documented', status: 'pending' },
    { surface_id: 'oauth', native_mode: 'observe', status: 'pending' },
    { surface_id: 'roots', native_mode: 'observe', status: 'pending' },
    { surface_id: 'sampling', native_mode: 'observe', status: 'pending' },
    { surface_id: 'prompts', native_mode: 'observe', status: 'pending' },
    { surface_id: 'resources', native_mode: 'observe', status: 'pending' },
    { surface_id: 'browser-preview', native_mode: 'observe', status: 'pending' },
    { surface_id: 'browser-error-feedback', native_mode: 'observe', status: 'pending' },
    { surface_id: 'artifacts', native_mode: 'observe', status: 'pending' },
    { surface_id: 'files', native_mode: 'observe', status: 'pending' },
    { surface_id: 'changes', native_mode: 'observe', status: 'pending' },
    { surface_id: 'native-checkpoint-restore', native_mode: 'invoke-documented', status: 'pending' },
  ]);
  assert.equal(descriptor.invocation, 'not-performed');
  assert.equal(descriptor.host_readiness.status, 'pending');
});

test('IDE evidence observation accepts sanitized native receipts without advancing the ledger', (t) => {
  // Given: a current sanitized MCP, preview, artifact, and checkpoint observation.
  const fixture = evidenceFixture(t);

  // When: the observation is ingested at the descriptor boundary.
  const receipt = output(observeEvidence(fixture));

  // Then: observed and typed-unavailable surfaces remain evidence-only.
  assert.equal(receipt.status, 'observed');
  assert.equal(receipt.host_readiness.status, 'pending');
  assert.equal(receipt.promotion, 'prohibited');
  assert.equal(receipt.ledger_effect, 'none');
  assert.equal(receipt.surfaces.find((item) => item.surface_id === 'getDiagnostics').details.read_only, true);
  assert.equal(receipt.surfaces.find((item) => item.surface_id === 'sampling').status, 'unavailable');
  assert.equal(JSON.stringify(receipt).includes('token'), false);
});

test('IDE evidence observation rejects OAuth secret material', (t) => {
  // Given: an OAuth observation carrying secret material.
  const fixture = evidenceFixture(t);
  fixture.observation.surfaces.find((item) => item.surface_id === 'oauth').details.access_token = 'secret-value';

  // When: the secret-bearing observation crosses the receipt boundary.
  const result = observeEvidence(fixture);

  // Then: serialization fails closed without a receipt.
  assert.equal(errorCode(result), 'SECRET_MATERIAL_REJECTED');
  assert.equal(fs.existsSync(fixture.evidenceReceiptPath), false);
});

test('IDE evidence observation rejects diagnostics outside the authorized root', (t) => {
  // Given: diagnostics attributed to a directory outside the selected workspace.
  const fixture = evidenceFixture(t);
  fixture.observation.surfaces.find((item) => item.surface_id === 'getDiagnostics').details.root = fixture.sandbox;

  // When: the unauthorized root crosses the receipt boundary.
  const result = observeEvidence(fixture);

  // Then: the receipt is rejected as unauthorized.
  assert.equal(errorCode(result), 'UNAUTHORIZED_ROOT');
});

test('IDE evidence observation rejects stale diagnostics', (t) => {
  // Given: diagnostics captured before the current host observation.
  const fixture = evidenceFixture(t);
  fixture.observation.surfaces.find((item) => item.surface_id === 'getDiagnostics').details.captured_at = '2026-08-03T09:00:00Z';

  // When: stale diagnostics cross the receipt boundary.
  const result = observeEvidence(fixture);

  // Then: stale read-only data cannot become current evidence.
  assert.equal(errorCode(result), 'STALE_DIAGNOSTIC');
});

test('IDE evidence observation rejects external-file checkpoint claims', (t) => {
  // Given: a UI checkpoint claiming coverage of external files and ledger progress.
  const fixture = evidenceFixture(t);
  const checkpoint = fixture.observation.surfaces.find((item) => item.surface_id === 'native-checkpoint-restore');
  checkpoint.details.external_files = true;
  checkpoint.details.ledger_effect = 'complete';

  // When: the overbroad checkpoint crosses the receipt boundary.
  const result = observeEvidence(fixture);

  // Then: native UI state cannot claim external coverage or canonical completion.
  assert.equal(errorCode(result), 'CHECKPOINT_SCOPE_INVALID');
});

test('IDE evidence observation rejects artifacts without a digest', (t) => {
  // Given: artifact metadata with no content digest.
  const fixture = evidenceFixture(t);
  delete fixture.observation.surfaces.find((item) => item.surface_id === 'artifacts').details.entries[0].digest;

  // When: incomplete artifact evidence crosses the receipt boundary.
  const result = observeEvidence(fixture);

  // Then: the artifact cannot be accepted as evidence.
  assert.equal(errorCode(result), 'ARTIFACT_EVIDENCE_INVALID');
});

test('IDE evidence observation types unsupported MCP but rejects an unavailable preview UI', (t) => {
  // Given: unsupported MCP features and an unavailable browser preview surface.
  const fixture = evidenceFixture(t);
  const preview = fixture.observation.surfaces.find((item) => item.surface_id === 'browser-preview');
  preview.status = 'unavailable';
  preview.details = { availability: 'unavailable', reason_code: 'UI_UNAVAILABLE' };

  // When: unavailable UI is presented as the happy observation receipt.
  const result = observeEvidence(fixture);

  // Then: optional MCP remains typed unavailable, while required preview proof fails.
  assert.equal(fixture.observation.surfaces.find((item) => item.surface_id === 'sampling').status, 'unavailable');
  assert.equal(errorCode(result), 'UI_SURFACE_UNAVAILABLE');
});

test('IDE checkpoint evidence cannot mutate a canonical run ledger', (t) => {
  // Given: a canonical ledger file under the selected project root.
  const fixture = evidenceFixture(t);
  const ledger = path.join(fixture.projectRoot, '.lazybuddy', 'runs', 'run-001', 'state.json');
  fs.mkdirSync(path.dirname(ledger), { recursive: true });
  fs.writeFileSync(ledger, '{"status":"active"}\n');
  const before = fs.readFileSync(ledger);

  // When: a native checkpoint observation is accepted.
  output(observeEvidence(fixture));

  // Then: the canonical ledger remains byte-identical.
  assert.deepEqual(fs.readFileSync(ledger), before);
});

test('failed repeated IDE evidence ingestion preserves the prior atomic receipt', (t) => {
  // Given: one accepted receipt followed by secret-bearing evidence.
  const fixture = evidenceFixture(t);
  output(observeEvidence(fixture));
  const before = fs.readFileSync(fixture.evidenceReceiptPath);
  fixture.observation.surfaces.find((item) => item.surface_id === 'oauth').details.client_secret = 'hidden-value';

  // When: the invalid repeated observation is rejected.
  const result = observeEvidence(fixture);

  // Then: the prior receipt stays byte-identical and contains no secret.
  assert.equal(errorCode(result), 'SECRET_MATERIAL_REJECTED');
  assert.deepEqual(fs.readFileSync(fixture.evidenceReceiptPath), before);
  assert.equal(fs.readFileSync(fixture.evidenceReceiptPath, 'utf8').includes('hidden-value'), false);
});
