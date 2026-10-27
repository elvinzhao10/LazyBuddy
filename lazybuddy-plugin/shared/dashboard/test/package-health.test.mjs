import assert from 'node:assert/strict';
import test from 'node:test';
import { packageHealth, collectPackageInventory } from '../adapters/package-health.mjs';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

test('inventory names each package component, detects incomplete skills and excludes config secrets and linked files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harness-inventory-'));
  try {
    for (const path of ['skills/present', 'skills/missing', 'agents', 'hooks']) await mkdir(join(root, path), { recursive: true });
    await writeFile(join(root, 'skills/present/SKILL.md'), '# Skill');
    await writeFile(join(root, 'agents/worker.md'), '# Worker');
    await writeFile(join(root, 'hooks/hooks.json'), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ command: 'SECRET_COMMAND' }] }] } }));
    await writeFile(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { ledger: { env: { TOKEN: 'SECRET_TOKEN' }, command: 'SECRET_EXEC' } } }));
    await symlink(join(root, 'agents/worker.md'), join(root, 'agents/linked.md'));
    const result = await collectPackageInventory({ pluginRoot: root });
    assert.deepEqual(result.entries.map(entry => entry.name), ['missing', 'present', 'worker', 'SessionStart', 'ledger']);
    assert.equal(result.entries.find(entry => entry.id === 'skill:missing').package_state, 'missing');
    assert.ok(result.entries.every(entry => entry.runtime_state === 'unobserved'));
    assert.doesNotMatch(JSON.stringify(result), /SECRET_|linked.md/);
    assert.equal(result.coverage.find(entry => entry.kind === 'skill').total, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('package health separates shipped capabilities from unobserved host readiness', () => {
  const result = packageHealth({ runtime: 'LazyKimi', packageVersion: '1.4.0', capabilities: { browser: 'available' } });
  const items = result.sections.flatMap(section => section.items);
  assert.equal(items.find(item => item.id === 'browser').status, 'ok');
  assert.equal(items.find(item => item.id === 'project_telemetry').status, 'unavailable');
  assert.equal(items.find(item => item.id === 'activation').status, 'unavailable');
  assert.equal(items.find(item => item.id === 'upstream-version').observed, null);
  assert.equal(Object.values(result.summary).reduce((sum, count) => sum + count, 0), items.length);
});

test('the authenticated asset allowlist includes the lazily loaded health surface', () => {
  const manifest = JSON.parse(readFileSync(new URL('../ui/asset-manifest.json', import.meta.url), 'utf8'));
  for (const route of ['/health-view.mjs', '/health.css']) assert.ok(manifest.assets.some(asset => asset.route === route));
  assert.ok(!manifest.assets.some(asset => asset.route.includes('package-health')), 'server-only health implementation is not exposed as a browser asset');
});
