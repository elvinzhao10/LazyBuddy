import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMiniDom } from './fixtures/mini-dom.mjs';

// V2-T5 view test: the health panel renders ONLY observed facts from a REAL
// collector snapshot (the real adapters/health.mjs over a real disposable
// copy of this plugin package plus a real project root). Honesty classes
// proven here: no adapter => explicit unavailable, never zero-as-healthy;
// a missing entry point / tampered vendor pin => typed WARN chips rendered
// from real findings; malformed snapshots are refused whole; a failing
// adapter renders its typed code. No secret bytes ever reach the DOM.
const dom = createMiniDom();
globalThis.document = dom.document;

const { collectProjectHealth } = await import('../adapters/health.mjs');
const { createHealthView, HEALTH_VIEW_SCHEMA } = await import('../ui/health-view.mjs');

const pluginRoot = fileURLToPath(new URL('../../../', import.meta.url));
const repoRoot = dirname(pluginRoot);
const runtimed = process.version; // the probe must observe exactly this

const fixture = { root: null, project: null };

// A real disposable copy of the observed plugin surface: the pinned vendor
// trees (per the pin manifests), the manifests themselves, the declared
// surfaces (manifest, MCP entries, hook scripts, skills). Breaking this copy
// proves WARN renders without touching the working tree.
async function materializeFixturePlugin() {
  const root = await mkdtemp(join(tmpdir(), 't5-health-view-'));
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
  const project = join(root, 'project');
  await mkdir(join(project, '.lazybuddy/project'), { recursive: true });
  await writeFile(join(project, '.lazybuddy/project/owner.json'), JSON.stringify({
    schema_version: 1, owner: 'LazyBuddy/project', project_id: 'project:t5', repository_key: 'repo:test' }));
  await writeFile(join(project, '.lazybuddy/project/state.json'), JSON.stringify({
    schema_version: 1, revision: 7, runtime: 'LazyBuddy', project_id: 'project:t5' }));
  await mkdir(join(project, '.lazybuddy/project-observations'), { recursive: true });
  await writeFile(join(project, '.lazybuddy/project-observations/journal.jsonl'),
    `${JSON.stringify({ id: 'obs:1', version: 1 })}\n`);
  return { root, pluginRoot: join(root, 'repo/lazybuddy-plugin'), repoRoot: join(root, 'repo'), project };
}

const collect = source => collectProjectHealth({ projectRoot: source.project, projectId: 'project:t5',
  pluginRoot: source.pluginRoot, repoRoot: source.repoRoot });

test.before(async () => {
  fixture.root = (await materializeFixturePlugin()).root;
  fixture.project = join(fixture.root, 'project');
});

test.after(async () => {
  if (fixture.root) await rm(fixture.root, { recursive: true, force: true });
});

const sectionOf = (view, id) => view.element.querySelector(`[data-testid="health-section"][data-section-id="${id}"]`);
const itemsOf = (view, id) => [...view.element.querySelectorAll(`[data-section-id="${id}"] [data-testid="health-item"]`)];

test('a real collector snapshot renders sections, observed facts and honest unavailable rows', async () => {
  const source = { pluginRoot: join(fixture.root, 'repo/lazybuddy-plugin'), repoRoot: join(fixture.root, 'repo'),
    project: fixture.project };
  const snapshot = await collect(source);
  assert.equal(snapshot.schema, HEALTH_VIEW_SCHEMA);

  const view = createHealthView({ adapter: { read: async () => snapshot } });
  await new Promise(resolve => setTimeout(resolve, 0)); // let the adapter promise land
  assert.equal(view.getStats().snapshotObserved, true);
  const rendered = view.element.querySelectorAll('[data-testid="health-section"]');
  assert.equal(rendered.length, snapshot.sections.length, 'every collector section renders');
  for (const section of snapshot.sections) {
    const panel = sectionOf(view, section.id);
    assert.ok(panel, `section ${section.id} renders`);
    assert.equal(panel.dataset.itemsObserved, 'true');
    assert.equal(panel.querySelectorAll('[data-testid="health-item"]').length, section.items.length);
  }

  // Observed facts surface verbatim: the manifest version, the executed node
  // --version, the store identity and revision all come from the snapshot.
  const manifestItem = view.element.querySelector('[data-item-id="plugin-manifest"]');
  assert.equal(manifestItem.dataset.status, 'ok');
  assert.equal(manifestItem.querySelector('[data-testid="health-item-observed"] code').textContent, '1.4.0');
  const nodeItem = view.element.querySelector('[data-item-id="runtime:node"]');
  assert.equal(nodeItem.querySelector('[data-testid="health-item-observed"] code').textContent, runtimed);
  const stateItem = view.element.querySelector('[data-item-id="store:state"]');
  assert.ok(stateItem.textContent.includes('revision 7'));
  assert.ok(stateItem.querySelector('[data-testid="health-item-observed"]').dataset.numeric === 'false');

  // Unobserved facts stay explicit unavailable — never zeros, never healthy.
  const hostItem = view.element.querySelector('[data-item-id="mcp:host-activation"]');
  assert.equal(hostItem.dataset.status, 'unavailable');
  assert.equal(hostItem.querySelector('.status').dataset.state, 'unavailable');
  assert.ok(hostItem.textContent.includes('not observed'));
  for (const row of view.element.querySelectorAll('[data-testid="health-item"]')) {
    assert.ok(['ok', 'warn', 'unavailable'].includes(row.dataset.status));
    const chipState = row.querySelector('.status').dataset.state;
    assert.equal(chipState, { ok: 'verified', warn: 'attention', unavailable: 'unavailable' }[row.dataset.status]);
  }

  // The journal row renders the real record count (exact, not invented).
  const journalItem = view.element.querySelector('[data-item-id="store:observation-journal"]');
  assert.equal(journalItem.dataset.status, 'ok');
  assert.equal(journalItem.querySelector('[data-testid="health-item-observed"] code').textContent, '1');
});

test('adversarial (misleading_success class): without an adapter the view never claims any observed fact', async () => {
  const view = createHealthView();
  assert.equal(view.getStats().snapshotObserved, false);
  const banner = view.element.querySelector('[data-testid="health-unavailable"]');
  assert.ok(banner, 'the honest unavailable banner renders');
  assert.equal(view.element.dataset.snapshotObserved, 'false');
  assert.equal(view.element.querySelectorAll('[data-testid="health-item"]').length, 0,
    'no item rows exist without an observed snapshot');
  assert.equal(view.element.querySelectorAll('[data-testid="health-item"][data-status="ok"]').length, 0,
    'nothing renders as ok');
  assert.ok(banner.textContent.includes('no health adapter is connected'));
  assert.ok(view.element.querySelector('[data-testid="health-unavailable-reason"]').textContent
    .includes('no health adapter'));

  // A pending adapter that never answered stays unavailable too (one microtask).
  const pending = createHealthView({ adapter: { read: () => new Promise(() => {}) } });
  assert.equal(pending.element.dataset.snapshotObserved, 'false');
  assert.ok(pending.element.querySelector('[data-testid="health-unavailable"]'));
});

test('adversarial (misleading_success class): real broken-plugin findings render as WARN, not as healthy', async () => {
  // Deliberately break the fixture copy: remove one project-family entry
  // point and byte-tamper one pinned dashboard file. Both findings must come
  // from the REAL collector re-running over the damaged tree.
  const source = { pluginRoot: join(fixture.root, 'repo/lazybuddy-plugin'), repoRoot: join(fixture.root, 'repo'),
    project: fixture.project };
  await rm(join(source.pluginRoot, 'shared/project/cli.mjs'));
  await appendFile(join(source.pluginRoot, 'shared/dashboard/adapters/host.mjs'),
    '// deliberate byte tamper for the V2-T5 warn proof\n');
  const broken = await collect(source);

  const entrypoint = broken.sections.find(section => section.id === 'entry-points').items
    .find(item => item.code === 'ENTRYPOINT_MISSING');
  assert.ok(entrypoint, 'the collector observed the missing entry point');
  assert.equal(entrypoint.observed, 'shared/project/cli.mjs');
  const vendor = broken.sections.find(section => section.id === 'vendor-integrity').items
    .find(item => item.id === 'vendor:dashboard');
  assert.equal(vendor.status, 'warn');
  assert.ok(vendor.detail.includes('adapters/host.mjs'), 'the tampered pin is named by relative path');

  const view = createHealthView({ adapter: { read: async () => broken } });
  await new Promise(resolve => setTimeout(resolve, 0));
  const warnRow = view.element.querySelector('[data-item-id="entrypoint:project:shared/project/cli.mjs"]');
  assert.equal(warnRow.dataset.status, 'warn');
  assert.equal(warnRow.dataset.code, 'ENTRYPOINT_MISSING');
  assert.equal(warnRow.querySelector('.status').dataset.state, 'attention');
  const vendorRow = view.element.querySelector('[data-item-id="vendor:dashboard"]');
  assert.equal(vendorRow.dataset.status, 'warn');
  assert.equal(vendorRow.dataset.code, 'VENDOR_BYTE_DRIFT');
  const sectionChip = sectionOf(view, 'entry-points').querySelector('[data-testid="health-section-chip"]');
  assert.ok(sectionChip.textContent.includes('warn'));
});

test('malformed snapshots are refused whole and adapters surface typed failure codes', async () => {
  const snapshot = await collect({ pluginRoot: join(fixture.root, 'repo/lazybuddy-plugin'),
    repoRoot: join(fixture.root, 'repo'), project: fixture.project });
  const view = createHealthView({ adapter: { read: async () => snapshot } });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(view.getStats().snapshotObserved, true);
  const revisionBefore = view.getStats().viewRevision;

  const refusals = [
    null,
    { schema: 'other@1', sections: [] },
    { schema: HEALTH_VIEW_SCHEMA },
    { schema: HEALTH_VIEW_SCHEMA, sections: [{ id: 'x', items: null }] },
  ];
  for (const payload of refusals) {
    view.update(payload);
    assert.equal(view.getStats().snapshotObserved, false, 'a refused snapshot is not observed');
    const banner = view.element.querySelector('[data-testid="health-unavailable"]');
    assert.ok(banner, 'the unavailable banner owns the surface');
    assert.equal(view.element.querySelectorAll('[data-testid="health-item"]').length, 0,
      'a malformed snapshot never half-renders');
  }
  // The last shape (unknown item status) renders section-level unavailability
  // while keeping the malformed row explicit rather than healthy.
  view.update({ schema: HEALTH_VIEW_SCHEMA, sections: [{ id: 'x', title: 'X', items: [{ id: 'i', label: 'L', status: 'fine' }] }] });
  assert.equal(view.element.querySelector('[data-item-id="i"]').dataset.status, 'unavailable');
  assert.equal(view.element.querySelector('[data-item-id="i"]').dataset.malformed, 'true');
  assert.ok(view.getStats().viewRevision > revisionBefore, 'every update re-renders');

  // A failing adapter renders its typed code; a bare error stays typed-generic.
  const failing = createHealthView({ adapter: { read: async () => { const error = new Error('x'); error.code = 'RUN_NOT_BOUND'; throw error; } } });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(failing.element.querySelector('[data-testid="health-unavailable"]').textContent.includes('RUN_NOT_BOUND'));
  const bare = createHealthView({ adapter: { read: async () => { throw new Error('boom'); } } });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(bare.element.querySelector('[data-testid="health-unavailable"]').textContent.includes('ADAPTER_READ_FAILED'));
});

test('no credential bytes ever reach the DOM: only snapshot fields render', async () => {
  const snapshot = await collect({ pluginRoot: join(fixture.root, 'repo/lazybuddy-plugin'),
    repoRoot: join(fixture.root, 'repo'), project: fixture.project });
  // Plant a marker fact in a detail (must render once) and keep a fake
  // credential in the adapter closure only (must never render).
  const marker = 'OBSERVED-MARKER-7f3a';
  const planted = structuredClone(snapshot);
  planted.sections[0].items[0].detail = `${planted.sections[0].items[0].detail} ${marker}`;
  const secret = 'a'.repeat(64);
  const view = createHealthView({ adapter: { read: async () => planted, secretTokenInClosure: secret } });
  await new Promise(resolve => setTimeout(resolve, 0));
  const text = view.element.textContent;
  assert.ok(text.includes(marker), 'the snapshot fact renders');
  assert.equal(text.includes(secret), false, 'closure material never renders');
  assert.equal(text.includes('Bearer '), false);
  assert.equal(text.toLowerCase().includes('credential'), false);
  assert.equal(text.toLowerCase().includes('password'), false);
});
