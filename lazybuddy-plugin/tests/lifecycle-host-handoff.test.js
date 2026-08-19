'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { prepareProductRoot, promoteRelease, stageRelease } = require('../scripts/lifecycle');
const { parseObservation } = require('../scripts/lifecycle/host-handoff');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const CLI = path.join(PLUGIN_ROOT, 'scripts', 'lazybuddy-lifecycle.js');
const ORIGIN = 'https://github.com/elvinzhao10/LazyBuddy.git';
const SERVERS = ['run-ledger', 'verification', 'status-dashboard', 'context-graph', 'code-intel', 'docs'];

function command(args, options = {}) {
  return spawnSync(process.execPath, [options.cli || CLI, ...args], {
    cwd: options.cwd || PLUGIN_ROOT,
    encoding: 'utf8',
    env: options.env || process.env,
  });
}

function json(result) {
  assert.notEqual(result.stdout, '', result.stderr);
  return JSON.parse(result.stdout);
}

function fixture() {
  const sandbox = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lazybuddy host handoff '));
  const installRoot = path.join(sandbox, 'durable root');
  const projectRoot = path.join(sandbox, 'project root');
  const sourceRoot = path.join(sandbox, 'source checkout');
  const packageRoot = path.join(sourceRoot, 'lazybuddy-plugin');
  fs.cpSync(PLUGIN_ROOT, packageRoot, { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, '.codebuddy-plugin'), { recursive: true });
  fs.copyFileSync(
    path.join(PLUGIN_ROOT, '..', '.codebuddy-plugin', 'marketplace.json'),
    path.join(sourceRoot, '.codebuddy-plugin', 'marketplace.json'),
  );
  fs.mkdirSync(projectRoot);
  const paths = prepareProductRoot({ installRoot, product: 'LazyBuddy' });
  const commitSha = 'a'.repeat(40);
  const staged = stageRelease(paths, { sourceRoot, version: '1.1.0', commitSha });
  const promoted = promoteRelease(paths, {
    ...staged,
    commitSha,
    entrypoint: 'lazybuddy-plugin/scripts/lazybuddy-lifecycle.js',
    manifestRelativePath: 'lazybuddy-plugin/.codebuddy-plugin/plugin.json',
    origin: ORIGIN,
    runtimePath: process.execPath,
    version: '1.1.0',
  });
  return { installRoot, paths, projectRoot, promoted, sandbox, sourceRoot };
}

function args(f, routes, extra = []) {
  return ['status', '--install-root', f.installRoot, '--project', f.projectRoot, '--json', ...routes.flatMap((route) => ['--route', route]), ...extra];
}

function workbuddyReceipt(f, overrides = {}) {
  return {
    schema_version: 1,
    type: 'workbuddy-marketplace-full-plugin',
    source: {
      route: 'workbuddy-marketplace',
      release_root: path.join(f.paths.releases, f.promoted.releaseId),
      manifest: 'lazybuddy-plugin/.workbuddy-plugin/plugin.json',
      manifest_sha256: crypto.createHash('sha256').update(fs.readFileSync(
        path.join(f.paths.releases, f.promoted.releaseId, 'lazybuddy-plugin', '.workbuddy-plugin', 'plugin.json'),
      )).digest('hex'),
      plugin: 'lazybuddy',
      version: '1.1.0',
    },
    host: 'workbuddy',
    build: '5.2.6+fixture.17',
    session_id: 'session:todo17-current',
    observed_at: new Date().toISOString(),
    capabilities: {
      skill: { id: 'lazy-programming', status: 'loaded' },
      command: { id: 'lazy-status', status: 'loaded' },
      agent: { id: 'lazybuddy-verifier', status: 'loaded' },
      hook: { id: 'SessionStart', status: 'loaded' },
      mcp: Object.fromEntries(SERVERS.map((name) => [name, 'connected'])),
    },
    ...overrides,
  };
}

test('status renders receipt-verified CodeBuddy and WorkBuddy handoffs without host mutation', (t) => {
  // Given: a durable release and a fake private WorkBuddy tree with caller-owned data.
  const f = fixture();
  const home = path.join(f.sandbox, 'fake home');
  const privateFile = path.join(home, '.workbuddy', 'plugins', 'private-state.json');
  fs.mkdirSync(path.dirname(privateFile), { recursive: true });
  fs.writeFileSync(privateFile, '{"caller":"owned"}\n');
  fs.rmSync(f.sourceRoot, { recursive: true });
  t.after(() => fs.rmSync(f.sandbox, { recursive: true }));

  // When: CodeBuddy marketplace, observed WorkBuddy plugin, and manual fallback handoffs are rendered.
  const options = { cli: f.paths.launcher, cwd: f.sandbox, env: { ...process.env, HOME: home } };
  const codebuddy = json(command(args(f, ['codebuddy-marketplace']), options));
  const full = json(command(args(f, ['workbuddy-full-plugin']), options));
  const fallback = json(command(args(f, ['manual-skills-mcp-fallback']), options));

  // Then: every route is namespaced, pending without observation, and never reads or changes private host state.
  assert.equal(codebuddy.host_handoff.namespace, 'lazybuddy');
  assert.equal(codebuddy.host_handoff.route, 'codebuddy-marketplace');
  assert.match(codebuddy.host_handoff.next_action.command, /^codebuddy plugin marketplace add /);
  assert.equal(full.host_handoff.expected_artifacts.plugin, 'lazybuddy');
  assert.equal(full.host_handoff.host_mutation, 'none');
  assert.equal(full.host_readiness.status, 'pending');
  assert.deepEqual(fallback.host_handoff.manual_mcp.connectors.map((item) => item.name), SERVERS);
  assert.deepEqual(fallback.host_handoff.degraded.excludes, ['commands', 'agents', 'hooks']);
  for (const output of [codebuddy, full, fallback]) assert.equal(JSON.stringify(output).includes(privateFile), false);
  assert.equal(fs.readFileSync(privateFile, 'utf8'), '{"caller":"owned"}\n');
});

test('status selects each marketplace plugin route by host when no route override is provided', (t) => {
  // Given: one receipt-verified durable release for each full-plugin host.
  const f = fixture();
  t.after(() => fs.rmSync(f.sandbox, { recursive: true }));
  const options = { cli: f.paths.launcher, cwd: f.sandbox };

  // When: status is invoked with only the host identity.
  const codebuddy = json(command(args(f, [], ['--host', 'codebuddy-ide']), options));
  const workbuddy = json(command(args(f, [], ['--host', 'workbuddy']), options));

  // Then: both hosts select their full marketplace plugin route by default.
  assert.equal(codebuddy.host_handoff.route, 'codebuddy-marketplace');
  assert.equal(codebuddy.host_handoff.expected_artifacts.plugin, 'lazybuddy@lazybuddy');
  assert.equal(workbuddy.host_handoff.route, 'workbuddy-full-plugin');
  assert.equal(workbuddy.host_handoff.expected_artifacts.plugin, 'lazybuddy');
});

test('WorkBuddy default status remains the marketplace full-plugin route while host proof is pending', (t) => {
  // Given: a receipt-verified durable package with no live WorkBuddy receipt.
  const f = fixture();
  t.after(() => fs.rmSync(f.sandbox, { recursive: true, force: true }));

  // When: status resolves the WorkBuddy host default.
  const result = command(args(f, [], ['--host', 'workbuddy']), { cli: f.paths.launcher, cwd: f.sandbox });
  const output = json(result);

  // Then: marketplace full-plugin remains selected without promoting package evidence to host evidence.
  assert.equal(result.status, 0);
  assert.equal(output.host_handoff.route, 'workbuddy-full-plugin');
  assert.deepEqual(output.host_handoff.route_priority, { rank: 1, fallback_rank: 2 });
  assert.equal(output.host_handoff.preflight.full_plugin, 'user-observed-only');
  assert.equal(output.host_handoff.receipt_templates.observation.source.route, 'workbuddy-marketplace');
  assert.equal(output.host_handoff.receipt_templates.removal.scope, 'receipt-owned-assets-only');
  assert.equal(output.host_handoff.receipt_templates.recovery.coexistence, false);
  assert.deepEqual(output.host_readiness, { status: 'pending' });
});

test('WorkBuddy status accepts only a current marketplace full-plugin capability receipt', (t) => {
  // Given: a live-session receipt bound to the active release, current host build, and all full-plugin capabilities.
  const f = fixture();
  const receiptPath = path.join(f.projectRoot, 'workbuddy-marketplace-receipt.json');
  fs.writeFileSync(receiptPath, `${JSON.stringify(workbuddyReceipt(f))}\n`);
  t.after(() => fs.rmSync(f.sandbox, { recursive: true, force: true }));

  // When: status validates the receipt against the current WorkBuddy build and session.
  const result = command(args(f, [], [
    '--host', 'workbuddy',
    '--host-build', '5.2.6+fixture.17',
    '--host-session', 'session:todo17-current',
    '--observation-receipt', receiptPath,
  ]), { cli: f.paths.launcher, cwd: f.sandbox });
  const output = json(result);

  // Then: the host is ready specifically through the marketplace full-plugin route.
  assert.equal(result.status, 0);
  assert.deepEqual(output.host_readiness, {
    status: 'ready',
    route: 'workbuddy-marketplace-full-plugin',
    build: '5.2.6+fixture.17',
    session_id: 'session:todo17-current',
  });
});

test('WorkBuddy receipt refuses stale build and session identity', (t) => {
  // Given: receipts whose host build or session differs from the current invocation.
  const f = fixture();
  t.after(() => fs.rmSync(f.sandbox, { recursive: true, force: true }));
  const cases = [
    ['stale-build', { build: '5.2.6+fixture.old' }],
    ['stale-session', { session_id: 'session:todo17-old' }],
  ];

  // When: status validates each stale identity against the current host context.
  const results = cases.map(([name, override]) => {
    const receiptPath = path.join(f.projectRoot, `${name}.json`);
    fs.writeFileSync(receiptPath, `${JSON.stringify(workbuddyReceipt(f, override))}\n`);
    return command(args(f, [], [
      '--host', 'workbuddy', '--host-build', '5.2.6+fixture.17', '--host-session', 'session:todo17-current',
      '--observation-receipt', receiptPath,
    ]), { cli: f.paths.launcher, cwd: f.sandbox });
  });

  // Then: neither stale identity can produce a ready status.
  for (const result of results) {
    assert.notEqual(result.status, 0);
    assert.equal(json(result).error.code, 'WORKBUDDY_RECEIPT_INVALID');
  }
});

test('WorkBuddy receipt requires an Agent and all six connected MCP servers', (t) => {
  // Given: one receipt missing its Agent and another missing one MCP status.
  const f = fixture();
  t.after(() => fs.rmSync(f.sandbox, { recursive: true, force: true }));
  const missingAgent = workbuddyReceipt(f);
  delete missingAgent.capabilities.agent;
  const missingMcp = workbuddyReceipt(f);
  delete missingMcp.capabilities.mcp.docs;

  // When: both incomplete capability receipts cross the lifecycle CLI boundary.
  const results = [['missing-agent', missingAgent], ['missing-mcp', missingMcp]].map(([name, receipt]) => {
    const receiptPath = path.join(f.projectRoot, `${name}.json`);
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`);
    return command(args(f, [], [
      '--host', 'workbuddy', '--host-build', '5.2.6+fixture.17', '--host-session', 'session:todo17-current',
      '--observation-receipt', receiptPath,
    ]), { cli: f.paths.launcher, cwd: f.sandbox });
  });

  // Then: both remain non-ready with a typed receipt error.
  for (const result of results) {
    assert.notEqual(result.status, 0);
    assert.equal(json(result).error.code, 'WORKBUDDY_RECEIPT_INVALID');
  }
});

test('WorkBuddy receipt rejects stale timestamps and credential-shaped content', (t) => {
  // Given: a historical receipt and an otherwise valid receipt carrying a forbidden credential field.
  const f = fixture();
  t.after(() => fs.rmSync(f.sandbox, { recursive: true, force: true }));
  const stale = workbuddyReceipt(f, { observed_at: '2026-07-01T10:00:00Z' });
  const credential = workbuddyReceipt(f);
  credential.capabilities.skill.api_token = 'fixture-secret-value';

  // When: status parses the two untrusted receipts.
  const results = [['stale', stale], ['credential', credential]].map(([name, receipt]) => {
    const receiptPath = path.join(f.projectRoot, `${name}.json`);
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`);
    return command(args(f, [], [
      '--host', 'workbuddy', '--host-build', '5.2.6+fixture.17', '--host-session', 'session:todo17-current',
      '--observation-receipt', receiptPath,
    ]), { cli: f.paths.launcher, cwd: f.sandbox });
  });

  // Then: both fail closed and no credential-shaped value is reflected in output.
  for (const result of results) {
    assert.notEqual(result.status, 0);
    assert.equal(json(result).error.code, 'WORKBUDDY_RECEIPT_INVALID');
    assert.equal(result.stdout.includes('fixture-secret-value'), false);
  }
});

test('parseObservation preserves a current matching CodeBuddy observation at an injected time', (t) => {
  // Given: one matching observation from the current UTC day.
  const f = fixture();
  const observation = path.join(f.projectRoot, 'current-workbuddy-observation.json');
  const receipt = {
    type: 'host-observation', host: 'codebuddy', observed_at: '2026-07-30T10:00:00Z', artifact: 'skill-and-mcp',
  };
  fs.writeFileSync(observation, JSON.stringify(receipt) + '\n');
  t.after(() => fs.rmSync(f.sandbox, { recursive: true }));

  // When: the receipt is parsed against a known current time.
  const result = parseObservation(observation, 'codebuddy', new Date('2026-07-30T12:00:00Z'));

  // Then: current evidence keeps its explicit observed result.
  assert.deepEqual(result, { status: 'observed', observation_receipt: receipt });
});

test('status keeps stale observations pending and reports route conflicts as remediation only', (t) => {
  // Given: a durable release and a historical user-supplied WorkBuddy observation receipt.
  const f = fixture();
  const observation = path.join(f.projectRoot, 'workbuddy-observation.json');
  const privateObservation = path.join(f.sandbox, '.workbuddy', 'plugins', 'state.json');
  fs.writeFileSync(observation, JSON.stringify({
    type: 'host-observation', host: 'workbuddy', observed_at: '2026-07-29T10:00:00Z', artifact: 'skill-and-mcp',
  }) + '\n');
  fs.mkdirSync(path.dirname(privateObservation), { recursive: true });
  fs.writeFileSync(privateObservation, fs.readFileSync(observation));
  t.after(() => fs.rmSync(f.sandbox, { recursive: true }));

  // When: full-plugin status receives the stale receipt, then both WorkBuddy routes are selected.
  const stale = json(command(args(f, ['workbuddy-full-plugin'], ['--observation-receipt', observation])));
  const conflictResult = command(args(f, ['workbuddy-full-plugin', 'manual-skills-mcp-fallback']));
  const conflict = json(conflictResult);
  const privateResult = command(args(f, ['workbuddy-full-plugin'], ['--observation-receipt', privateObservation]));
  const privateOutput = json(privateResult);

  // Then: stale evidence cannot claim an observed or ready host while a conflict exposes only host-UI remediation.
  assert.deepEqual(stale.host_readiness, { status: 'pending' });
  assert.equal(conflictResult.status, 1);
  assert.equal(conflict.status, 'blocked');
  assert.equal(conflict.host_handoff, undefined);
  assert.deepEqual(conflict.route_conflict.routes, ['manual-skills-mcp-fallback', 'workbuddy-full-plugin']);
  assert.match(conflict.route_conflict.next_action, /host UI/);
  assert.equal(privateResult.status, 1);
  assert.equal(privateOutput.error.code, 'OBSERVATION_RECEIPT_INVALID');
});
