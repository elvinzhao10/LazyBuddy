import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serviceFixture, http } from './service-fixture.mjs';
import { listen } from '../service-http.mjs';
import { collectProjectHealth, HEALTH_SNAPSHOT_SCHEMA } from '../adapters/health.mjs';

// V2-T5 route test: GET /api/project/health is session-authenticated like
// every other project read, serves the doctor-style collector's snapshot for
// the bound project (no project initialization required — an unbound store
// is an honest unavailable item, not a 404), and stays secret-free: the test
// asserts the response bytes never contain the service credential, the
// bootstrap credential or the session token. Adversarial classes: a broken
// plugin copy behind an injected authority proves the route passes the
// option bag through (misleading_success), a tampered pinned vendor file
// surfaces a typed integrity WARN (malformed_input), and a hanging --version
// probe stays bounded (hung_commands). Run with the tooling venv python on
// PATH (the service helper shells out to python3).
const pluginRoot = fileURLToPath(new URL('../../../', import.meta.url));
const repoRoot = dirname(pluginRoot);

async function materializeFixturePlugin(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const pluginFiles = []; const repoFiles = [];
  for (const [manifest, tree, sidecar] of [['dashboard-vendor-manifest.v1.json', 'shared/dashboard', 'dashboard.vendor.json'],
    ['project-vendor-manifest.v1.json', 'shared/project', 'project.vendor.json']]) {
    repoFiles.push(`scripts/${manifest}`);
    pluginFiles.push(`shared/${sidecar}`);
    for (const pin of JSON.parse(await readFile(join(repoRoot, 'scripts', manifest), 'utf8')).files) {
      pluginFiles.push(`${tree}/${pin.path}`);
    }
  }
  pluginFiles.push('.workbuddy-plugin/plugin.json', '.mcp.json', 'hooks/hooks.json', 'mcp/profile-gate.sh');
  for (const server of ['status-dashboard', 'run-ledger', 'verification', 'docs', 'code-intel', 'context-graph']) {
    pluginFiles.push(`mcp/${server}/server.sh`);
  }
  const hooks = JSON.parse(await readFile(join(pluginRoot, 'hooks/hooks.json'), 'utf8'));
  for (const match of JSON.stringify(hooks).matchAll(/scripts\/hooks\/[A-Za-z0-9._-]+/g)) pluginFiles.push(match[0]);
  for (const skill of await readdir(join(pluginRoot, 'skills'))) pluginFiles.push(`skills/${skill}/SKILL.md`);
  for (const relative of pluginFiles) {
    const target = join(root, 'repo/lazybuddy-plugin', relative);
    await mkdir(dirname(target), { recursive: true });
    await cp(join(pluginRoot, relative), target);
  }
  for (const relative of ['agents', 'commands']) await mkdir(join(root, 'repo/lazybuddy-plugin', relative), { recursive: true });
  for (const relative of repoFiles) {
    const target = join(root, 'repo', relative);
    await mkdir(dirname(target), { recursive: true });
    await cp(join(repoRoot, relative), target);
  }
  return { root, pluginRoot: join(root, 'repo/lazybuddy-plugin'), repoRoot: join(root, 'repo') };
}

const flatten = value => {
  const found = [];
  const visit = (node, trail) => {
    if (node === null || typeof node !== 'object') return;
    for (const [key, entry] of Object.entries(node)) {
      if (typeof entry === 'string') found.push([`${trail}.${key}`, entry]);
      else if (entry !== null && typeof entry === 'object') visit(entry, `${trail}.${key}`);
    }
  };
  visit(value, '$');
  return found;
};

test('GET /api/project/health is session-authenticated and serves observed, secret-free facts', async () => {
  const f = await serviceFixture();
  try {
    assert.equal((await http(f.live.url, '/api/project/health')).status, 401,
      'the health route requires the in-memory session like every project read');
    const response = await f.request('/api/project/health');
    assert.equal(response.status, 200);
    const snapshot = response.value;
    assert.equal(snapshot.schema, HEALTH_SNAPSHOT_SCHEMA);
    assert.equal(snapshot.collector, 'dashboard/adapters/health@1');
    assert.equal(snapshot.subject.plugin, 'lazybuddy');

    // Every section/item is well-formed and every status is one of the three
    // honest states; the summary counts are recomputable from the items.
    const SECTION_IDS = ['plugin-package', 'entry-points', 'mcp-tools', 'hooks', 'skills',
      'runtimes', 'vendor-integrity', 'project-store', 'service-process'];
    assert.deepEqual(snapshot.sections.map(section => section.id), SECTION_IDS);
    const counts = { ok: 0, warn: 0, unavailable: 0 };
    for (const section of snapshot.sections) {
      assert.ok(Array.isArray(section.items) && section.items.length > 0, `${section.id} carries observed items`);
      for (const item of section.items) {
        assert.ok(['ok', 'warn', 'unavailable'].includes(item.status), `${section.id}/${item.id} status`);
        counts[item.status] += 1;
        if (item.status !== 'ok') assert.match(item.code ?? '', /^[A-Z][A-Z0-9_]{0,127}$/,
          `${section.id}/${item.id} carries a typed code for its non-ok state`);
      }
    }
    assert.deepEqual(snapshot.summary, counts);

    // The route works on a project root that was never initialized: the store
    // section reports STORE_NOT_INITIALIZED honestly instead of 404-ing like
    // /api/project, and the uptime fact is a real observed number.
    const owner = snapshot.sections.find(section => section.id === 'project-store').items
      .find(item => item.id === 'store:owner');
    assert.equal(owner.status, 'unavailable');
    assert.equal(owner.code, 'STORE_NOT_INITIALIZED');
    const uptime = snapshot.sections.find(section => section.id === 'service-process').items
      .find(item => item.id === 'process:uptime');
    assert.match(String(uptime.observed), /^\d+s$/);

    // Misleading-success guard: no credential, token or session material in
    // the served bytes — not in values, not in keys.
    const serialized = JSON.stringify(snapshot);
    const credential = await readFile(f.live.credential_file, 'utf8');
    assert.equal(serialized.includes(credential), false, 'the bootstrap credential never crosses the route');
    assert.equal(serialized.includes(f.live.authorization), false, 'the session token never crosses the route');
    for (const [key, value] of flatten(snapshot)) {
      assert.equal(/credential|secret|token|password/i.test(key), false, `no secret-shaped key reaches the route: ${key}`);
      assert.equal(/Bearer |BEGIN [A-Z ]*PRIVATE|sk-[A-Za-z0-9]/.test(value), false, `${key} carries no secret-shaped bytes`);
    }
    assert.equal(Object.keys(snapshot).includes('identity'), false, 'the service identity object stays off the snapshot');
  } finally { await f.cleanup(); }
});

test('adversarial (misleading_success class): a broken plugin tree renders typed WARN items through the route', async () => {
  const fixtureRoot = await materializeFixturePlugin('t5-health-route-broken-');
  const credential = 'b'.repeat(64);
  const control = { credential, identity: { port: 0 } };
  // The same authority contract the real adapter exposes: the option bag
  // reaches the collector, pointed here at a deliberately damaged copy.
  const authority = { readProjectHealth: (options, actor) => collectProjectHealth({ ...options, actor,
    pluginRoot: fixtureRoot.pluginRoot, repoRoot: fixtureRoot.repoRoot }) };
  const live = await listen({ port: 0, projectId: 'project:t5', runId: null, projectRoot: fixtureRoot.root,
    authority }, control);
  try {
    await rm(join(fixtureRoot.pluginRoot, 'shared/project/cli.mjs'));
    const session = await http(live.origin, '/api/session', { body: {}, headers: { 'x-dashboard-bootstrap': credential } });
    const response = await http(live.origin, '/api/project/health', { headers: { authorization: `Bearer ${session.value.token}` } });
    assert.equal(response.status, 200);
    const entrypoint = response.value.sections.find(section => section.id === 'entry-points').items
      .find(item => item.code === 'ENTRYPOINT_MISSING');
    assert.ok(entrypoint, 'the missing entry point is an observed WARN, not an omitted row');
    assert.equal(entrypoint.status, 'warn');
    assert.equal(entrypoint.observed, 'shared/project/cli.mjs');
    // Removing the entry point also unpins it: the same real finding surfaces
    // in the vendor integrity section under its own typed code — the doctor
    // reports the one damage from every angle that observed it.
    const projectVendor = response.value.sections.find(section => section.id === 'vendor-integrity').items
      .find(item => item.id === 'vendor:project');
    assert.equal(projectVendor.status, 'warn');
    assert.ok(projectVendor.detail.includes('VENDOR_FILE_MISSING'), projectVendor.detail);
    assert.ok(projectVendor.detail.includes('cli.mjs'));
  } finally { await live.close(); await rm(fixtureRoot.root, { recursive: true, force: true }); }
});

test('adversarial (malformed_input class): a tampered pinned vendor file warns by typed code and relative path', async () => {
  const fixtureRoot = await materializeFixturePlugin('t5-health-route-tamper-');
  const credential = 'c'.repeat(64);
  const control = { credential, identity: { port: 0 } };
  const authority = { readProjectHealth: options => collectProjectHealth({ ...options,
    pluginRoot: fixtureRoot.pluginRoot, repoRoot: fixtureRoot.repoRoot }) };
  const live = await listen({ port: 0, projectId: 'project:t5', runId: null, projectRoot: fixtureRoot.root,
    authority }, control);
  try {
    await appendFile(join(fixtureRoot.pluginRoot, 'shared/dashboard/adapters/host.mjs'),
      '// deliberate byte tamper: the recomputed hash must diverge from the pin\n');
    const session = await http(live.origin, '/api/session', { body: {}, headers: { 'x-dashboard-bootstrap': credential } });
    const response = await http(live.origin, '/api/project/health', { headers: { authorization: `Bearer ${session.value.token}` } });
    assert.equal(response.status, 200);
    const vendor = response.value.sections.find(section => section.id === 'vendor-integrity').items
      .find(item => item.id === 'vendor:dashboard');
    assert.equal(vendor.status, 'warn');
    assert.equal(vendor.code, 'VENDOR_BYTE_DRIFT');
    assert.ok(vendor.detail.includes('adapters/host.mjs'), 'the drifted pin is named by its relative path');
    const projectVendor = response.value.sections.find(section => section.id === 'vendor-integrity').items
      .find(item => item.id === 'vendor:project');
    assert.equal(projectVendor.status, 'ok', 'the untouched family stays ok — no collective failure');

    // A tampered sidecar is its own typed finding, distinct from byte drift.
    const sidecar = join(fixtureRoot.pluginRoot, 'shared/dashboard.vendor.json');
    await appendFile(sidecar, '\n');
    const again = await http(live.origin, '/api/project/health', { headers: { authorization: `Bearer ${session.value.token}` } });
    const drifted = again.value.sections.find(section => section.id === 'vendor-integrity').items
      .find(item => item.id === 'vendor:dashboard');
    assert.equal(drifted.status, 'warn');
    assert.ok([drifted.code, ...(drifted.detail.match(/[A-Z_]{4,}/g) ?? [])].includes('VENDOR_SIDECAR_DRIFT'));
  } finally { await live.close(); await rm(fixtureRoot.root, { recursive: true, force: true }); }
});

test('adversarial (hung_commands class): a hanging --version probe stays bounded and renders a typed timeout WARN', async () => {
  const fixtureRoot = await materializeFixturePlugin('t5-health-route-hung-');
  const credential = 'd'.repeat(64);
  const control = { credential, identity: { port: 0 } };
  const authority = { readProjectHealth: options => collectProjectHealth({ ...options,
    pluginRoot: fixtureRoot.pluginRoot, repoRoot: fixtureRoot.repoRoot,
    exec: () => new Promise(() => {}) }) }; // a wedged interpreter, never settling
  const live = await listen({ port: 0, projectId: 'project:t5', runId: null, projectRoot: fixtureRoot.root,
    authority }, control);
  try {
    const session = await http(live.origin, '/api/session', { body: {}, headers: { 'x-dashboard-bootstrap': credential } });
    const started = Date.now();
    const response = await http(live.origin, '/api/project/health', { headers: { authorization: `Bearer ${session.value.token}` } },
    );
    assert.equal(response.status, 200, 'the route answers despite the hung probes');
    const runtimes = response.value.sections.find(section => section.id === 'runtimes').items;
    assert.equal(runtimes.length, 2);
    for (const item of runtimes) {
      assert.equal(item.status, 'warn');
      assert.equal(item.code, 'RUNTIME_PROBE_TIMEOUT');
    }
    assert.ok(Date.now() - started < 15000, 'both probes were abandoned at the bounded deadline, not awaited forever');
  } finally { await live.close(); await rm(fixtureRoot.root, { recursive: true, force: true }); }
});

test('the collector refuses malformed bindings typed, and an unbound project root stays honestly unobserved', async () => {
  await assert.rejects(() => collectProjectHealth({ projectRoot: 'relative/path' }),
    error => error.code === 'INVALID_PROJECT_ROOT');
  await assert.rejects(() => collectProjectHealth({ pluginRoot: 'relative/path' }),
    error => error.code === 'INVALID_PLUGIN_ROOT');
  const snapshot = await collectProjectHealth({ pluginRoot: resolve(pluginRoot), repoRoot });
  const binding = snapshot.sections.find(section => section.id === 'project-store').items[0];
  assert.equal(binding.status, 'unavailable');
  assert.equal(binding.code, 'PROJECT_ROOT_UNBOUND');
});
