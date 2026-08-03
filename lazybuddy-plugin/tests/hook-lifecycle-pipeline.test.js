'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const pluginRoot = path.resolve(__dirname, '..');
const hooksFile = path.join(pluginRoot, 'hooks', 'hooks.json');
const dispatcher = path.join(pluginRoot, 'scripts', 'hooks', 'lifecycle-event.js');
const fixtureRoot = path.join(__dirname, 'fixtures', 'hook-events');
const temporaryProjects = [];

test.after(() => {
  for (const projectDir of temporaryProjects) fs.rmSync(projectDir, { recursive: true, force: true });
});

const originalHandlers = Object.freeze({
  SessionStart: 'bash "${CODEBUDDY_PLUGIN_ROOT}/scripts/hooks/session-start.sh"',
  UserPromptSubmit: 'bash "${CODEBUDDY_PLUGIN_ROOT}/scripts/hooks/user-prompt-submit.sh"',
  PreToolUse: 'bash "${CODEBUDDY_PLUGIN_ROOT}/scripts/hooks/pre-tool-use.sh"',
  PostToolUse: 'bash "${CODEBUDDY_PLUGIN_ROOT}/scripts/hooks/post-tool-use.sh"',
  PostToolUseFailure: 'bash "${CODEBUDDY_PLUGIN_ROOT}/scripts/hooks/post-tool-use-failure.sh"',
  PreCompact: 'bash "${CODEBUDDY_PLUGIN_ROOT}/scripts/hooks/pre-compact.sh"',
  Stop: 'bash "${CODEBUDDY_PLUGIN_ROOT}/scripts/hooks/stop-gate.sh"',
  StopFailure: 'bash "${CODEBUDDY_PLUGIN_ROOT}/scripts/hooks/stop-failure.sh"',
  TaskCreated: 'bash "${CODEBUDDY_PLUGIN_ROOT}/scripts/hooks/task-created.sh"',
  TaskCompleted: 'bash "${CODEBUDDY_PLUGIN_ROOT}/scripts/hooks/task-completed.sh"',
  SubagentStart: 'bash "${CODEBUDDY_PLUGIN_ROOT}/scripts/hooks/subagent-start.sh"',
  SubagentStop: 'bash "${CODEBUDDY_PLUGIN_ROOT}/scripts/hooks/subagent-stop.sh"',
});

const addedEvents = Object.freeze([
  'PermissionRequest', 'PermissionDenied', 'Notification', 'PostCompact', 'SessionEnd',
  'InstructionsLoaded', 'ConfigChange', 'CwdChanged', 'FileChanged', 'WorktreeCreate',
  'WorktreeRemove', 'Elicitation', 'ElicitationResult',
]);

function readHooks() {
  return JSON.parse(fs.readFileSync(hooksFile, 'utf8')).hooks;
}

function hookCommand(hooks, event) {
  return hooks[event][0].hooks[0].command;
}

function fixture(name, projectDir) {
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, `${name}.json`), 'utf8').replaceAll('${PROJECT_DIR}', projectDir));
}

function setupProject(status = 'executing') {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lazybuddy-hook-event-'));
  temporaryProjects.push(projectDir);
  const runDir = path.join(projectDir, '.lazybuddy', 'runs', 'run-001');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'state.json'), `${JSON.stringify({ status, progress: { completed_count: 2 } }, null, 2)}\n`);
  return { projectDir, runDir };
}

function dispatch(event, payload, projectDir, maxBuffer = 256 * 1024) {
  return spawnSync(process.execPath, [dispatcher, event], {
    cwd: projectDir,
    env: { ...process.env, CODEBUDDY_PROJECT_DIR: projectDir },
    input: `${JSON.stringify(payload)}\n`,
    encoding: 'utf8',
    maxBuffer,
    timeout: 3_000,
  });
}

function output(result) {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('preserves the original twelve handler commands byte for byte', () => {
  // Given: the released twelve-handler declaration.
  const hooks = readHooks();

  // When: the original event routes are enumerated.
  const routes = Object.fromEntries(Object.keys(originalHandlers).map(event => [event, hookCommand(hooks, event)]));

  // Then: every existing event retains its exact handler command.
  assert.deepEqual(routes, originalHandlers);
});

test('declares exactly twenty-five documented events through one added-event boundary', () => {
  // Given: the package hook declaration and shared event vocabulary.
  const hooks = readHooks();
  const vocabulary = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'contracts', 'lazyseries-host-event-vocabulary.v1.json'), 'utf8'));
  const consumers = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'contracts', 'codebuddy-hook-consumers.v1.json'), 'utf8'));

  // When: hook routes and new-event targets are enumerated.
  const events = Object.keys(hooks);
  const addedTargets = new Set(addedEvents.map(event => hookCommand(hooks, event)));

  // Then: the declaration is exact, excludes deferred Teams scheduling, and uses one dispatcher.
  assert.deepEqual(new Set(events), new Set(vocabulary.raw_events));
  assert.equal(events.length, 25);
  assert.equal(events.includes('TeammateIdle'), false);
  assert.equal(addedTargets.size, 1);
  assert.match([...addedTargets][0], /lifecycle-event\.js/);
  assert.deepEqual(new Set(Object.keys(consumers.events)), new Set(vocabulary.raw_events));
  assert.ok(Object.values(consumers.events).every(consumer => ['concrete', 'advisory'].includes(consumer.mode)));
  assert.ok(addedEvents.every(event => consumers.events[event].completion_authority === false));
  assert.equal(consumers.boundary.max_payload_bytes, 65_536);
  assert.deepEqual(consumers.boundary.exit_codes, { accepted: 0, rejected: 65, internal_error: 70 });
  assert.ok(addedEvents.every(event => hooks[event][0].hooks[0].timeout === consumers.boundary.timeout_seconds));
});

test('emits a normalized record and consumer outcome for every added event fixture', () => {
  // Given: one active run and a documented fixture for each added event.
  const { projectDir } = setupProject();

  // When: each fixture crosses the real dispatcher boundary.
  const results = addedEvents.map(event => output(dispatch(event, fixture(event, projectDir), projectDir)));

  // Then: each event is persisted once with an explicit consumer and no completion authority.
  assert.deepEqual(results.map(result => result.raw_event), addedEvents);
  assert.ok(results.every(result => result.outcome === 'recorded'));
  assert.ok(results.every(result => typeof result.record_path === 'string' && fs.statSync(result.record_path).size > 0));
  for (const result of results) {
    const record = JSON.parse(fs.readFileSync(result.record_path, 'utf8'));
    assert.equal(record.consumer.completion_authority, false);
    assert.equal(record.raw_event, result.raw_event);
    if (record.payload.message !== undefined) assert.equal(record.payload.message.redacted, true);
  }
});

test('repeated delivery is idempotent and permission events never complete work', () => {
  // Given: an active run whose progress is incomplete and one permission request delivery.
  const { projectDir, runDir } = setupProject();
  const payload = fixture('PermissionRequest', projectDir);

  // When: the identical event is delivered twice.
  const first = output(dispatch('PermissionRequest', payload, projectDir));
  const duplicate = output(dispatch('PermissionRequest', payload, projectDir));
  const state = JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8'));

  // Then: only one record exists and completion-bearing state is untouched.
  assert.equal(first.outcome, 'recorded');
  assert.equal(duplicate.outcome, 'duplicate');
  assert.equal(first.event_id, duplicate.event_id);
  assert.equal(state.status, 'executing');
  assert.deepEqual(state.progress, { completed_count: 2 });
  assert.equal(state.hook_lifecycle.last_permission.outcome, 'requested');
});

test('config file cwd and worktree changes invalidate active evidence without completing the run', () => {
  // Given: an active run and every evidence-invalidating lifecycle event.
  const { projectDir, runDir } = setupProject('verifying');
  const invalidators = ['PostCompact', 'InstructionsLoaded', 'ConfigChange', 'CwdChanged', 'FileChanged', 'WorktreeCreate', 'WorktreeRemove'];

  // When: each event crosses the dispatcher.
  for (const event of invalidators) output(dispatch(event, fixture(event, projectDir), projectDir));
  const state = JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8'));

  // Then: typed invalidations are recorded while status and progress remain unchanged.
  assert.equal(state.status, 'verifying');
  assert.deepEqual(state.progress, { completed_count: 2 });
  assert.deepEqual(new Set(state.hook_lifecycle.invalidations.map(item => item.event)), new Set(invalidators));
  assert.ok(state.hook_lifecycle.invalidations.every(item => item.completion_authority === false));
});

test('inactive runs receive normalized advisory records but no state mutation', () => {
  // Given: a completed run and one advisory event.
  const { projectDir, runDir } = setupProject('complete');
  const before = fs.readFileSync(path.join(runDir, 'state.json'), 'utf8');

  // When: Notification is dispatched.
  const result = output(dispatch('Notification', fixture('Notification', projectDir), projectDir));

  // Then: the record is explicit advisory evidence and inactive state is byte-identical.
  assert.equal(result.active_state, 'inactive');
  assert.equal(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8'), before);
});

test('rejects malformed oversized secret missing-common and stale-cwd payloads with typed nonzero exits', () => {
  // Given: hostile inputs spanning every parser boundary.
  const { projectDir } = setupProject();
  const cases = [
    ['PermissionRequest', '{not-json', 'malformed_json'],
    ['Notification', JSON.stringify({ ...fixture('Notification', projectDir), message: 'x'.repeat(70 * 1024) }), 'payload_too_large'],
    ['Elicitation', JSON.stringify({ ...fixture('Elicitation', projectDir), api_secret: 'sk-abcdefghijklmnopqrstuvwxyz123456' }), 'secret_detected'],
    ['PostCompact', JSON.stringify({ cwd: projectDir, hook_event_name: 'PostCompact' }), 'missing_common_field'],
    ['FileChanged', JSON.stringify({ ...fixture('FileChanged', projectDir), cwd: path.dirname(projectDir) }), 'stale_cwd'],
  ];

  // When/Then: every hostile payload fails closed with the expected machine reason.
  for (const [event, input, reason] of cases) {
    const result = spawnSync(process.execPath, [dispatcher, event], {
      cwd: projectDir,
      env: { ...process.env, CODEBUDDY_PROJECT_DIR: projectDir },
      input,
      encoding: 'utf8',
      timeout: 3_000,
    });
    assert.notEqual(result.status, 0, `${event} unexpectedly passed`);
    assert.equal(JSON.parse(result.stderr).reason, reason);
  }
});

test('rejects added events that omit their required event-specific fields', () => {
  // Given: valid added-event fixtures with their event-specific data removed.
  const { projectDir } = setupProject();
  const required = {
    PermissionRequest: ['request_id', 'tool_name'],
    PermissionDenied: ['request_id', 'tool_name'],
    Notification: ['notification_type'],
    PostCompact: ['trigger'],
    SessionEnd: ['reason'],
    InstructionsLoaded: ['source'],
    ConfigChange: ['source'],
    CwdChanged: ['new_cwd'],
    FileChanged: ['file_path', 'change_type'],
    WorktreeCreate: ['worktree_path'],
    WorktreeRemove: ['worktree_path'],
    Elicitation: ['request_id', 'server_name'],
    ElicitationResult: ['request_id', 'status'],
  };

  // When/Then: each missing field fails through the real dispatcher with one typed reason.
  for (const [event, fields] of Object.entries(required)) {
    for (const field of fields) {
      const payload = fixture(event, projectDir);
      delete payload[field];
      const result = dispatch(event, payload, projectDir);
      assert.notEqual(result.status, 0, `${event}.${field} unexpectedly passed`);
      assert.equal(JSON.parse(result.stderr).reason, 'missing_event_field');
    }
  }
});
