import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { binding } from '../service-lifecycle.mjs';

// T3a: one dashboard per repository, isolated per `.lazybuddy` store. The
// runtime-neutral `.lazyseries/project.json` registry is the only shared
// surface, so a foreign runtime (LazyTrae, LazyQoder) reaching for this root
// must refuse typed without touching Buddy's store bytes, and Buddy's own
// dashboard surfaces must resolve their store roots only inside `.lazybuddy`.
const DASHBOARD = fileURLToPath(new URL('../', import.meta.url));
const PLUGIN_ROOT = resolve(DASHBOARD, '../..');
const PROJECT_CLI = join(PLUGIN_ROOT, 'shared/project/cli.mjs');
const PROJECTOR = join(DASHBOARD, 'projector.mjs');
const PROJECT_ID = 'project:store-isolation';
const ACTOR = 'local:store-isolation-test';

// The sibling plugins share one worktrees checkout layout
// (<worktrees>/<Name>/1.4.0-completion/<name>-plugin); when present the real
// foreign CLIs are exercised against the same root. In a standalone clone the
// cross-runtime half skips and the hand-authored foreign-identity half below
// still proves the refusal.
const WORKTREES = resolve(PLUGIN_ROOT, '../../..');
const TRAE_CLI = join(WORKTREES, 'LazyTrae/1.4.0-completion/lazytrae-plugin/packages/cli/src/index.js');
const QODER_CLI = join(WORKTREES, 'LazyQoder/1.4.0-completion/lazyqoder-plugin/shared/dashboard-host/project.mjs');
const traeAvailable = existsSync(TRAE_CLI);
const qoderAvailable = existsSync(QODER_CLI);

const hash = value => createHash('sha256').update(value).digest('hex');
const deepSorted = value => Array.isArray(value) ? value.map(deepSorted)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, deepSorted(value[key])]))
    : value;
// The bridge persists the registry in its canonical sorted-keys encoding.
const registryBytes = value => `${JSON.stringify(deepSorted(value))}\n`;

function run(argv, options = {}) {
  return new Promise((resolve_, reject) => {
    const child = spawn(argv[0], argv.slice(1), { cwd: options.cwd ?? dirname(argv[1]), shell: false,
      stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 });
    const output = []; const errors = [];
    child.stdout.on('data', chunk => output.push(chunk));
    child.stderr.on('data', chunk => errors.push(chunk));
    child.on('error', reject);
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error); });
    child.on('close', (code, signal) => resolve_({
      code, signal,
      stdout: Buffer.concat(output).toString('utf8'),
      stderr: Buffer.concat(errors).toString('utf8'),
    }));
    child.stdin.end(options.input === undefined ? '' : options.input);
  });
}

const buddyCLI = (root, action, input) => run([process.execPath, PROJECT_CLI, action,
  '--project-root', root, '--project-id', PROJECT_ID, '--actor', ACTOR], { cwd: root, input });

function storeInventory(root) {
  const files = {};
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else files[relative(root, path)] = hash(readFileSync(path));
    }
  };
  for (const namespace of ['.lazybuddy', '.lazyseries']) {
    const store = join(root, namespace);
    if (existsSync(store)) visit(store);
  }
  return files;
}

function fixture(t, name) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), `lazybuddy-store-isolation-${name}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function put(root, path, content, mode = 0o600) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  writeFileSync(target, content, { mode });
  return target;
}

test('own init owns one store; sibling foreign-runtime CLIs refuse and leave every store byte unchanged', async t => {
  const root = fixture(t, 'matrix');
  put(root, 'docs/requirements.md', '# Requirements\n\n## feature:iso — Isolation\n\nSource.\n');

  const initialized = await buddyCLI(root, 'init');
  assert.equal(initialized.code, 0, initialized.stderr);
  assert.equal(existsSync(join(root, '.lazybuddy/project/owner.json')), true, 'Buddy init creates its own store owner');
  assert.equal(existsSync(join(root, '.lazybuddy/project/state.json')), true, 'Buddy init creates its own state document');
  const registry = JSON.parse(readFileSync(join(root, '.lazyseries/project.json'), 'utf8'));
  assert.equal(registry.runtime, 'LazyBuddy');
  assert.equal(registry.project_id, PROJECT_ID);
  const owned = storeInventory(root);
  assert.ok(Object.keys(owned).length >= 3, 'the snapshot covers registry, owner and state bytes');

  // Foreign runtime: the real LazyTrae CLI against the same root. Trae refuses
  // a registry another runtime owns instead of creating a second owner.
  if (!traeAvailable) t.skip(`LazyTrae worktree CLI not found at ${TRAE_CLI}`);
  else {
    const refused = await run([process.execPath, TRAE_CLI, 'project', 'init', '--actor', 'cross:trae'], { cwd: root });
    assert.equal(refused.code, 1, `Trae init must fail closed: ${refused.stdout}${refused.stderr}`);
    assert.equal(JSON.parse(refused.stderr).code, 'REGISTRY_FOREIGN_RUNTIME');
    assert.equal(existsSync(join(root, '.lazytrae/state/project.json')), false,
      'a refused Trae init creates no Trae state document');
  }
  // Foreign runtime: the real LazyQoder CLI, carrying the registry's own
  // project id so the only foreign fact is the owning runtime.
  if (!qoderAvailable) t.skip(`LazyQoder worktree CLI not found at ${QODER_CLI}`);
  else {
    const refused = await run([process.execPath, QODER_CLI, 'init', '--project-root', root,
      '--project-id', PROJECT_ID, '--actor', 'cross:qoder'], { cwd: root });
    assert.notEqual(refused.code, 0, 'Qoder init must fail closed');
    assert.equal(refused.stderr.trim(), 'REGISTRY_FOREIGN_RUNTIME');
    assert.equal(existsSync(join(root, '.lazyqoder')), false,
      'a refused Qoder init creates no second native store directory');
  }
  // No cross-store mutation: every Buddy and registry byte is unchanged after
  // the foreign attempts, whatever scaffolding the foreign runtime left in its
  // own namespace.
  assert.deepEqual(storeInventory(root), owned,
    'foreign-runtime init attempts must leave the owning store byte-identical');
  // The owning runtime keeps full service after the refusals.
  const reread = await buddyCLI(root, 'read');
  assert.equal(reread.code, 0, reread.stderr);
  assert.equal(JSON.parse(reread.stdout).repository_key, registry.repository_key);
  t.diagnostic(JSON.stringify({ trae_cli_exercised: traeAvailable, qoder_cli_exercised: qoderAvailable,
    refusal: 'REGISTRY_FOREIGN_RUNTIME', store_bytes_unchanged: true }));
});

// F-04 portable half: a registry whose only foreign fact is the owning runtime
// refuses init typed, and the shared registry never flaps between runtimes.
test('a foreign-runtime registry refuses init and the source mirror without adopting or flapping', async t => {
  const root = fixture(t, 'foreign-registry');
  put(root, 'docs/requirements.md', '# Requirements\n\n## feature:iso — Isolation\n\nSource.\n');
  const initialized = await buddyCLI(root, 'init');
  assert.equal(initialized.code, 0, initialized.stderr);
  const registryPath = join(root, '.lazyseries/project.json');
  const own = readFileSync(registryPath);
  const flipped = JSON.parse(own.toString('utf8'));
  flipped.runtime = 'LazyQoder';
  writeFileSync(registryPath, registryBytes(flipped));
  const foreign = readFileSync(registryPath);
  const ownedStore = storeInventory(root);

  for (let attempt = 1; attempt <= 2; attempt++) {
    const refused = await buddyCLI(root, 'init');
    assert.notEqual(refused.code, 0, `foreign-runtime init attempt ${attempt} must fail closed`);
    assert.match(refused.stderr, /REGISTRY_FOREIGN_RUNTIME/);
    assert.equal(readFileSync(registryPath).compare(foreign), 0,
      'a refused init must leave the foreign registry byte-identical');
  }
  assert.deepEqual(storeInventory(root), ownedStore, 'refused inits leave the native store untouched');

  // Mirror guard: a mutating command against a foreign-owned registry refuses
  // instead of rewriting the shared source pointer list.
  const mirror = await buddyCLI(root, 'command', JSON.stringify({
    schema_version: 1, command_id: 'iso:mirror', project_id: PROJECT_ID, expected_revision: 0,
    operation: 'register_source', payload: { id: 'source:req', path: 'docs/requirements.md', role: 'requirements' },
  }));
  assert.notEqual(mirror.code, 0, 'a foreign-runtime registry must not be mirrored');
  assert.match(mirror.stderr, /REGISTRY_FOREIGN_RUNTIME/);
  assert.equal(readFileSync(registryPath).compare(foreign), 0,
    'the refused mirror leaves the foreign registry byte-identical');

  // Restoring Buddy's own runtime resumes normal service on the same bytes.
  writeFileSync(registryPath, own);
  const resumed = await buddyCLI(root, 'init');
  assert.equal(resumed.code, 0, resumed.stderr);
  assert.equal(JSON.parse(readFileSync(registryPath, 'utf8')).runtime, 'LazyBuddy');
  t.diagnostic(JSON.stringify({ refusal: 'REGISTRY_FOREIGN_RUNTIME', registry_bytes_stable: true,
    mirror_refused: true, own_runtime_resumes: true }));
});

test('the dashboard service and projector resolve store roots only inside .lazybuddy', async t => {
  const root = fixture(t, 'namespace');
  const initialized = await buddyCLI(root, 'init');
  assert.equal(initialized.code, 0, initialized.stderr);

  // Service binding: the resolved dashboard store root (receipts, credentials)
  // lives under `.lazybuddy/dashboard` and never under a foreign namespace or
  // the shared registry directory.
  const projectBound = await binding({ projectRoot: root, projectId: PROJECT_ID, runId: null });
  const projectRelative = relative(root, projectBound.directory);
  assert.match(projectRelative, /^\.lazybuddy[/\\]dashboard[/\\][0-9a-f]{64}$/);
  mkdirSync(join(root, '.lazybuddy/runs/run-iso'), { recursive: true, mode: 0o700 });
  const runBound = await binding({ projectRoot: root, projectId: PROJECT_ID, runId: 'run-iso' });
  assert.match(relative(root, runBound.directory), /^\.lazybuddy[/\\]dashboard[/\\][0-9a-f]{64}$/);

  // Projector: the dashboard read path refuses run directories outside its
  // own `.lazybuddy/runs` namespace, including the sibling namespaces.
  for (const foreignNamespace of ['.lazytrae/runs/foreign', '.lazyqoder/runs/foreign']) {
    const runDir = join(root, foreignNamespace);
    mkdirSync(runDir, { recursive: true, mode: 0o700 });
    const refused = await run([process.execPath, PROJECTOR, '--project-root', root, '--run-dir', runDir],
      { cwd: root });
    assert.equal(refused.code, 65, `the projector must refuse ${foreignNamespace}`);
    assert.equal(JSON.parse(refused.stderr).code, 'RUN_OUTSIDE_PROJECT');
  }
  t.diagnostic(JSON.stringify({ service_store_root: projectRelative, projector_refusal: 'RUN_OUTSIDE_PROJECT',
    refused_namespaces: ['.lazytrae/runs', '.lazyqoder/runs'] }));
});

// Adversarial: tampered shared documents and a moved-away state document must
// refuse typed without ever rewriting the remaining store bytes.
test('tampered or missing store documents refuse typed without mutation', async t => {
  const root = fixture(t, 'tampered');
  put(root, 'docs/requirements.md', '# Requirements\n\n## feature:iso — Isolation\n\nSource.\n');
  assert.equal((await buddyCLI(root, 'init')).code, 0);
  const registryPath = join(root, '.lazyseries/project.json');
  const statePath = join(root, '.lazybuddy/project/state.json');
  const registry = readFileSync(registryPath);
  const state = readFileSync(statePath);

  // Malformed registry: typed parse refusal, state bytes untouched.
  writeFileSync(registryPath, '{broken registry\n');
  const corrupt = await buddyCLI(root, 'read');
  assert.notEqual(corrupt.code, 0);
  assert.match(corrupt.stderr, /^INVALID_JSON\n$/);
  assert.equal(readFileSync(statePath).compare(state), 0, 'a corrupt registry must not touch the state document');
  writeFileSync(registryPath, registry);

  // Stale store: the state document is moved away while the registry stays.
  const movedAway = join(root, 'state.json.moved');
  renameSync(statePath, movedAway);
  const missing = await buddyCLI(root, 'read');
  assert.notEqual(missing.code, 0);
  assert.match(missing.stderr, /^PROJECT_NOT_INITIALIZED\n$/);
  assert.equal(existsSync(statePath), false, 'the refused read must not recreate a state document');
  renameSync(movedAway, statePath);
  assert.equal((await buddyCLI(root, 'read')).code, 0, 'service resumes after the state returns');
  t.diagnostic(JSON.stringify({ corrupt_registry: 'INVALID_JSON', missing_state: 'PROJECT_NOT_INITIALIZED',
    state_bytes_stable: true, no_state_recreated: true }));
});
