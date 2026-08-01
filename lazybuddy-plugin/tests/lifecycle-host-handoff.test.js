'use strict';

const assert = require('node:assert/strict');
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
  fs.mkdirSync(path.join(packageRoot, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(packageRoot, '.codebuddy-plugin'), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, '.codebuddy-plugin'), { recursive: true });
  fs.cpSync(path.join(PLUGIN_ROOT, 'scripts', 'lifecycle'), path.join(packageRoot, 'scripts', 'lifecycle'), { recursive: true });
  fs.copyFileSync(CLI, path.join(packageRoot, 'scripts', 'lazybuddy-lifecycle.js'));
  fs.writeFileSync(path.join(packageRoot, '.codebuddy-plugin', 'plugin.json'), '{"name":"lazybuddy","version":"1.0.3"}\n');
  fs.writeFileSync(path.join(sourceRoot, '.codebuddy-plugin', 'marketplace.json'), '{"name":"lazybuddy","plugins":[{"name":"lazybuddy","source":"./lazybuddy-plugin","version":"1.0.3"}]}\n');
  for (const name of SERVERS) {
    const server = path.join(packageRoot, 'mcp', name, 'server.sh');
    fs.mkdirSync(path.dirname(server), { recursive: true });
    fs.writeFileSync(server, '#!/usr/bin/env bash\n');
    fs.chmodSync(server, 0o755);
  }
  fs.mkdirSync(projectRoot);
  const paths = prepareProductRoot({ installRoot, product: 'LazyBuddy' });
  const commitSha = 'a'.repeat(40);
  const staged = stageRelease(paths, { sourceRoot, version: '1.0.3', commitSha });
  const promoted = promoteRelease(paths, {
    ...staged,
    commitSha,
    entrypoint: 'lazybuddy-plugin/scripts/lazybuddy-lifecycle.js',
    manifestRelativePath: 'lazybuddy-plugin/.codebuddy-plugin/plugin.json',
    origin: ORIGIN,
    runtimePath: process.execPath,
    version: '1.0.3',
  });
  return { installRoot, paths, projectRoot, promoted, sandbox, sourceRoot };
}

function args(f, routes, extra = []) {
  return ['status', '--install-root', f.installRoot, '--project', f.projectRoot, '--json', ...routes.flatMap((route) => ['--route', route]), ...extra];
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
  assert.equal(full.host_handoff.expected_artifacts.plugin, 'already-host-installed');
  assert.equal(full.host_handoff.host_mutation, 'none');
  assert.equal(full.host_readiness.status, 'pending');
  assert.deepEqual(fallback.host_handoff.manual_mcp.connectors.map((item) => item.name), SERVERS);
  assert.deepEqual(fallback.host_handoff.degraded.excludes, ['commands', 'agents', 'hooks']);
  for (const output of [codebuddy, full, fallback]) assert.equal(JSON.stringify(output).includes('.workbuddy'), false);
  assert.equal(fs.readFileSync(privateFile, 'utf8'), '{"caller":"owned"}\n');
});

test('parseObservation preserves a current matching observation at an injected time', (t) => {
  // Given: one matching observation from the current UTC day.
  const f = fixture();
  const observation = path.join(f.projectRoot, 'current-workbuddy-observation.json');
  const receipt = {
    type: 'host-observation', host: 'workbuddy', observed_at: '2026-07-30T10:00:00Z', artifact: 'skill-and-mcp',
  };
  fs.writeFileSync(observation, JSON.stringify(receipt) + '\n');
  t.after(() => fs.rmSync(f.sandbox, { recursive: true }));

  // When: the receipt is parsed against a known current time.
  const result = parseObservation(observation, 'workbuddy', new Date('2026-07-30T12:00:00Z'));

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
