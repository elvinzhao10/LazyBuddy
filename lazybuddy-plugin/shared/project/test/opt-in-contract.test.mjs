import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAPABILITY_OPERATIONS } from '../contract.mjs';
import { projectCapability } from '../model.mjs';
import { VOLATILE, buildNormalized, clean, defaultView, snapshotBody } from '../qa/inactivity-baseline.mjs';

const CLI = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const RUN_ID = 't02-opt-in';
const PROJECT_ID = 'project:opt-in-contract';
const ACTOR = 'local:opt-in-test';

const hash = value => createHash('sha256').update(value).digest('hex');

function put(root, path, content) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  writeFileSync(target, content, { mode: 0o600 });
}

function manifest(root) {
  const files = {};
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else {
        const stat = lstatSync(path, { bigint: true });
        files[relative(root, path).split('\\').join('/')] = { sha256: hash(readFileSync(path)), bytes: Number(stat.size) };
      }
    }
  }
  visit(root);
  return files;
}

function invoke(root, action, input, options = {}) {
  const args = [CLI, action, '--project-root', root, '--project-id', options.projectId ?? PROJECT_ID, '--actor', options.actor ?? ACTOR];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], shell: false, timeout: 25000 });
    const output = []; const errors = [];
    child.stdout.on('data', chunk => output.push(chunk));
    child.stderr.on('data', chunk => errors.push(chunk));
    child.on('error', reject);
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error); });
    child.on('close', (code, signal) => resolve({
      code, signal,
      stdout: Buffer.concat(output).toString('utf8'),
      stderr: Buffer.concat(errors).toString('utf8'),
    }));
    child.stdin.end(input === undefined ? '' : typeof input === 'string' ? input : JSON.stringify(input));
  });
}

function fixture(t, withNative = false) {
  const root = join(realpathSync(tmpdir()), `${RUN_ID}-${process.pid}-${t.name.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}`);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  put(root, 'docs/requirements.md', '# Requirements\n\n## requirement:offline — Work offline\n\nReading works offline.\n');
  put(root, '.omo/plans/plan.md', '# Plan\n\n- [ ] Keep the original document.\n');
  if (withNative) {
    put(root, '.lazybuddy/state.json', '{"legacy_state":"preserve"}\n');
    put(root, '.lazybuddy/decisions/ledger.jsonl', '{"decision":"preserve"}\n');
    put(root, '.lazybuddy/runs/run-old/state.json', JSON.stringify({
      run_id: 'run-old', dashboard_project_id: 'native:old', status: 'done', verification: 'verified',
    }) + '\n');
    put(root, '.lazybuddy/dashboard/service.json', '{"credential":"fixture-only","owner":"native"}\n');
    put(root, '.lazybuddy/dashboard-queue/queue.json', '{"project_id":"native:old","revision":1,"plans":[]}\n');
    put(root, '.lazybuddy/dashboard-queue/revision', '1\n');
    put(root, '.codebuddy/settings.local.json', '{"preserve":true}\n');
  }
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

// IO-1: no registry until explicit opt-in. The native CLI keeps its imported fail-closed
// refusal (typed PROJECT_NOT_INITIALIZED, nonzero exit) and stays fully inert; the typed
// tool route completes normally (no crash, nothing created, no revision).
test('IO-1 pre-init reads are inert: nothing is created, no revision exists, originals untouched', async t => {
  const root = fixture(t);
  const before = manifest(root);

  const read = await invoke(root, 'read');
  assert.equal(read.signal, null);
  assert.notEqual(read.code, 0);
  assert.match(read.stderr, /^PROJECT_NOT_INITIALIZED\n$/);
  assert.equal(read.stdout, '');
  assert.deepEqual(manifest(root), before, 'A pre-init read must not touch any file');
  assert.equal(existsSync(join(root, '.lazybuddy')), false, 'No registry directory may appear before opt-in');

  const command = await invoke(root, 'command', {
    schema_version: 1, command_id: 'cmd:pre-init', project_id: PROJECT_ID, expected_revision: 0,
    operation: 'register_source', payload: { id: 'source:requirements', path: 'docs/requirements.md', role: 'requirements' },
  });
  assert.notEqual(command.code, 0);
  assert.match(command.stderr, /^PROJECT_NOT_INITIALIZED\n$/);
  assert.deepEqual(manifest(root), before, 'A pre-init command must not create the registry');
  t.diagnostic(JSON.stringify({ refusal: 'PROJECT_NOT_INITIALIZED', files_before: Object.keys(before).length,
    files_after: Object.keys(manifest(root)).length, registry_created: false, revision: 'none exists' }));
});

test('IO-1 tool-route pre-init reads complete as typed results without side effects', () => {
  const before = null;
  const read = projectCapability(before, { schema_version: 1, operation: 'project.read', project_id: PROJECT_ID });
  assert.equal(read.status, 'not_initialized');
  assert.equal(read.hint, 'PROJECT_NOT_INITIALIZED');
  assert.equal(read.initialized, false);
  assert.ok(!Object.hasOwn(read, 'snapshot'));
  assert.equal(read.operation, 'project.read');
});

// IO-3: MCP/chat project tool routes through the command path return a typed
// NOT_INITIALIZED hint at model level: never a crash, never a side effect.
test('IO-3 every capability operation answers pre-init with the typed not-initialized hint', () => {
  for (const operation of CAPABILITY_OPERATIONS) {
    const answer = projectCapability(null, { schema_version: 1, operation });
    assert.equal(answer.status, 'not_initialized', operation);
    assert.equal(answer.hint, 'PROJECT_NOT_INITIALIZED', operation);
    assert.equal(answer.initialized, false, operation);
    assert.equal(answer.operation, operation);
  }
  assert.throws(() => projectCapability(null, { schema_version: 1, operation: 'set_verified' }));
});

// IO-2 helper: the qa harness reproduces the T01 normalization conventions exactly.
test('IO-2 helper normalizes like the T01 baseline normalizer', () => {
  assert.deepEqual([...VOLATILE], ['timestamp', 'ts', 'started', 'pid', 'port', 'instance', 'url', 'executable',
    'executable_sha256', 'service_sha256', 'token', 'expiry', 'credential_file', 'state_sha256', 'queue_sha256', 'sha256']);
  const snapshotJson = { b: 2, a: 1, cursor: 'x'.repeat(64), nested: { ts: 1, port: 2, kept: 'v' }, list: [{ sha256: 'd' }, { id: 'i' }] };
  const cleaned = clean(snapshotJson);
  assert.deepEqual(Object.keys(cleaned), ['a', 'b', 'cursor', 'list', 'nested']);
  assert.equal(cleaned.cursor, '<cursor:omitted-volatile>');
  assert.deepEqual(Object.keys(cleaned.nested), ['kept']);
  assert.deepEqual(cleaned.list, [{}, { id: 'i' }], 'Array order is semantic and preserved');

  const rawSnapshot = `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(snapshotJson)}`;
  assert.deepEqual(snapshotBody(rawSnapshot), cleaned, 'The body is isolated from the first brace');
  assert.throws(() => snapshotBody('no json here'), SyntaxError);

  const indexBody = `<!doctype html><html><body>
<span data-testid="connection-status">Not connected</span>
<nav id="view-tabs" hidden>
<button id="work-tab" aria-pressed="true">Work</button>
<button id="project-tab" aria-pressed="false">Project</button>
</nav>
<div id="work-root"></div><div id="verification-root"></div>
</body></html>`;
  const view = defaultView(indexBody);
  assert.equal(view.nav.hidden_pre_connect, true);
  assert.deepEqual(view.nav.destinations, [
    { id: 'work-tab', aria_pressed: 'true', label: 'Work' },
    { id: 'project-tab', aria_pressed: 'false', label: 'Project' },
  ]);
  assert.deepEqual(view.view_roots_in_document_order, ['work-root', 'verification-root']);
  assert.deepEqual(view.project_destinations_present, ['project']);
  assert.equal(view.connection_status_initial, 'Not connected');
  assert.match(view.index_body_sha256, /^[a-f0-9]{64}$/);

  const normalized = buildNormalized(rawSnapshot, indexBody);
  assert.equal(normalized.api_snapshot_normalized.nested.kept, 'v');
  assert.deepEqual(Object.keys(normalized), ['normalizer', 'api_snapshot_normalized', 'default_view']);
  assert.match(normalized.normalizer, /T01 baseline-normalize\.mjs v1 conventions/);
});

// IO-4: explicit opt-out removes the registry and leaves every native file untouched.
test('IO-4 removing the project registry leaves native state byte-identical and returns to pre-init', async t => {
  const root = fixture(t, true);
  const nativePaths = ['.lazybuddy/state.json', '.lazybuddy/decisions/ledger.jsonl', '.lazybuddy/runs/run-old/state.json',
    '.lazybuddy/dashboard/service.json', '.lazybuddy/dashboard-queue/queue.json', '.lazybuddy/dashboard-queue/revision',
    '.codebuddy/settings.local.json', 'docs/requirements.md', '.omo/plans/plan.md'];
  const nativeBefore = Object.fromEntries(nativePaths.map(path => [path, hash(readFileSync(join(root, path)))]));

  const initialized = JSON.parse((await invoke(root, 'init')).stdout);
  assert.equal(initialized.revision, 0);
  const command = {
    schema_version: 1, command_id: 'cmd:register', project_id: PROJECT_ID, expected_revision: 0,
    operation: 'register_source', payload: { id: 'source:requirements', path: 'docs/requirements.md', role: 'requirements' },
  };
  const registered = JSON.parse((await invoke(root, 'command', command)).stdout);
  assert.equal(registered.receipt.status, 'saved');
  assert.equal(registered.snapshot.revision, 1);
  assert.ok(existsSync(join(root, '.lazybuddy/project/state.json')));

  rmSync(join(root, '.lazybuddy/project'), { recursive: true, force: true });
  assert.equal(existsSync(join(root, '.lazybuddy/project')), false);
  for (const path of nativePaths) assert.equal(hash(readFileSync(join(root, path))), nativeBefore[path], `${path} changed`);
  assert.deepEqual(readdirSync(join(root, '.lazybuddy')).sort(),
    ['dashboard', 'dashboard-queue', 'decisions', 'runs', 'state.json'].sort());

  const after = await invoke(root, 'read');
  assert.match(after.stderr, /^PROJECT_NOT_INITIALIZED\n$/);
  assert.equal(hash(readFileSync(join(root, 'docs/requirements.md'))), nativeBefore['docs/requirements.md'],
    'The registered original Markdown stays byte-identical through opt-out');

  const reinitialized = JSON.parse((await invoke(root, 'init')).stdout);
  assert.equal(reinitialized.revision, 0, 'Opt-out returns the store to a fresh pre-init state');
  for (const path of nativePaths) assert.equal(hash(readFileSync(join(root, path))), nativeBefore[path], `${path} changed after re-init`);
  t.diagnostic(JSON.stringify({ native_files_compared: nativePaths.length, registry_removed: '.lazybuddy/project',
    post_opt_out_read: 'PROJECT_NOT_INITIALIZED', reinit_revision: 0, original_markdown_untouched: true }));
});
