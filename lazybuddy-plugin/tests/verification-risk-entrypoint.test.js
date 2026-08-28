'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const pluginRoot = path.resolve(__dirname, '..');
const tooling = path.join(pluginRoot, 'scripts', 'lazybuddy-tooling.sh');
const python = [process.env.LAZYBUDDY_TEST_PYTHON, process.env.LAZYBUDDY_PYTHON,
  'python3', 'python3.12', 'python3.11', 'python3.10'].filter(Boolean).find((candidate) => {
  const result = spawnSync(candidate, ['-c', 'import sys; raise SystemExit(sys.version_info < (3, 10))']);
  return result.status === 0;
});
assert.ok(python, 'Python 3.10+ is required for bounded verification integration tests');
const gates = [
  'targeted-tests', 'dependency-tests', 'contract-tests', 'paired-full-suites',
  'independent-review', 'security-review', 'real-surface', 'final-assertions',
];
const base = {
  taskCategory: 'quick', changedPaths: ['src/format-label.js'], riskFlags: [],
  capabilityFresh: true, evidenceFresh: true, dirtyTree: false, priorOutcomes: [],
};

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lazybuddy-risk-entry-'));
  const target = path.join(root, 'target');
  const reports = path.join(root, 'reports');
  fs.mkdirSync(target);
  fs.mkdirSync(reports);
  const log = path.join(reports, 'invocations.jsonl');
  const behavior = path.join(target, 'behavior.json');
  const executor = path.join(target, 'gate.js');
  fs.writeFileSync(executor, `'use strict';\nconst fs=require('node:fs');\nconst [gate,log,behavior]=process.argv.slice(2);\nfs.appendFileSync(log, JSON.stringify({gate,pid:process.pid})+'\\n');\nconst value=JSON.parse(fs.readFileSync(behavior,'utf8'))[gate]||'passed';\nprocess.exit(value==='passed'?0:23);\n`);
  fs.writeFileSync(behavior, '{}\n');
  const config = Object.fromEntries(gates.map((gate) => [gate, [process.execPath, executor, gate, log, behavior]]));
  const configPath = path.join(target, 'gates.json');
  fs.writeFileSync(configPath, `${JSON.stringify(config)}\n`);
  fs.writeFileSync(path.join(target, 'tracked.txt'), 'clean\n');
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: target }).status, 0);
  assert.equal(spawnSync('git', ['add', '.'], { cwd: target }).status, 0);
  assert.equal(spawnSync('git', ['-c', 'user.name=Risk Test', '-c', 'user.email=risk@test.invalid', 'commit', '-qm', 'fixture'], { cwd: target }).status, 0);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { behavior, configPath, log, reports, root, target };
}

function invoke(fx, input, name, env = {}) {
  const inputPath = path.join(fx.reports, `${name}-input.json`);
  const report = path.join(fx.reports, `${name}-report.json`);
  fs.writeFileSync(inputPath, `${JSON.stringify(input)}\n`);
  const result = spawnSync('bash', [tooling, 'verification-risk', '--target', fx.target,
    '--input', inputPath, '--gate-config', fx.configPath, '--report', report,
    '--timeout', '5'], { cwd: pluginRoot, encoding: 'utf8',
    env: { ...process.env, LAZYBUDDY_PYTHON: python, ...env } });
  return { result, report: fs.existsSync(report) ? JSON.parse(fs.readFileSync(report, 'utf8')) : null };
}

function invoked(report) {
  return report.gateResults.map(({ gateId }) => gateId);
}

test('Given direct affected and release risk, when shipped verification runs, then exact gates execute and report observed outcomes', (t) => {
  const scenarios = [
    ['direct', base, ['targeted-tests', 'final-assertions'], 1],
    ['affected', { ...base, taskCategory: 'deep', riskFlags: ['dependency'] },
      ['targeted-tests', 'dependency-tests', 'contract-tests', 'final-assertions'], 1],
    ['release', { ...base, riskFlags: ['release'] },
      ['targeted-tests', 'dependency-tests', 'contract-tests', 'paired-full-suites',
        'paired-full-suites', 'independent-review', 'security-review', 'real-surface', 'final-assertions'], 2],
  ];
  for (const [name, input, expected, actors] of scenarios) {
    const fx = fixture(t);
    const run = invoke(fx, input, name);
    assert.equal(run.result.status, 0, JSON.stringify(run.report));
    assert.deepEqual(invoked(run.report), expected, name);
    assert.equal(run.report.actorCount, actors, name);
    assert.equal(run.report.allPassed, true, name);
    assert.ok(run.report.gateResults.every(({ outcome }) => outcome === 'passed'), name);
    assert.equal(run.report.actualCost.fullSuiteInvocations, name === 'release' ? 2 : 0, name);
    assert.equal(fs.readFileSync(fx.log, 'utf8').trim().split('\n').length, expected.length, name);
  }
});

test('Given fail-closed inputs, when shipped verification runs, then comprehensive gates actually execute', (t) => {
  const cases = [
    ['failure', { priorOutcomes: [{ gateId: 'targeted', outcome: 'failed', assertionId: 'a' }] }, 'prior-gate-failure'],
    ['flakes', { priorOutcomes: [{ gateId: 'targeted', outcome: 'flaky', assertionId: 'same' }, { gateId: 'targeted', outcome: 'flaky', assertionId: 'same' }] }, 'repeated-flake'],
    ['unidentified-flake', { priorOutcomes: [{ gateId: 'targeted', outcome: 'flaky' }] }, 'flake-without-assertion-id'],
    ['stale-capability', { capabilityFresh: false }, 'stale-capability'],
    ['stale-evidence', { evidenceFresh: false }, 'stale-evidence'],
    ['public-schema', { changedPaths: ['schemas/public.schema.json'] }, 'public-contract-change'],
    ['version', { changedPaths: ['package.json'] }, 'version-change'],
    ['lifecycle', { changedPaths: ['scripts/lifecycle/update.js'] }, 'lifecycle-change'],
    ['security', { changedPaths: ['scripts/security-policy.js'] }, 'security-change'],
    ['host', { changedPaths: ['scripts/hosts/codebuddy-adapter.js'] }, 'host-adapter-change'],
    ['shared-state', { changedPaths: ['scripts/state/lease.js'] }, 'shared-state-change'],
    ['cross-repo', { riskFlags: ['cross-repo'] }, 'cross-repo'],
    ['concurrency', { riskFlags: ['concurrency'] }, 'concurrency'],
    ['release', { riskFlags: ['release'] }, 'release'],
    ['malformed', { riskFlags: ['bogus'] }, 'invalid-risk-flag'],
    ['misleading-cost', { reportedCostSuccess: true }, 'misleading-cost-success'],
  ];
  for (const [name, override, reason] of cases) {
    const fx = fixture(t);
    const run = invoke(fx, { ...base, ...override }, name);
    assert.equal(run.result.status, 0, `${name}: ${JSON.stringify(run.report)}`);
    assert.equal(run.report.level, 'comprehensive', name);
    assert.ok(run.report.reasonCodes.includes(reason), name);
    assert.equal(invoked(run.report).length, 9, name);
    assert.ok(invoked(run.report).includes('security-review'), name);
    assert.ok(invoked(run.report).includes('real-surface'), name);
  }
});

test('Given a dirty Git target, when shipped verification runs, then actual repository state forces comprehensive execution', (t) => {
  const fx = fixture(t);
  fs.appendFileSync(path.join(fx.target, 'tracked.txt'), 'dirty\n');
  const run = invoke(fx, base, 'dirty');
  assert.equal(run.result.status, 0, JSON.stringify(run.report));
  assert.equal(run.report.level, 'comprehensive');
  assert.ok(run.report.reasonCodes.includes('dirty-tree'));
  assert.equal(invoked(run.report).length, 9);
});

test('Given a dirty Git target and a PATH-spoofed clean probe, when shipped verification runs, then comprehensive gates execute', (t) => {
  const fx = fixture(t);
  fs.appendFileSync(path.join(fx.target, 'tracked.txt'), 'dirty\n');
  const fakeBin = path.join(fx.root, 'fake-bin');
  fs.mkdirSync(fakeBin);
  fs.writeFileSync(path.join(fakeBin, 'git'), '#!/bin/sh\nexit 0\n');
  fs.chmodSync(path.join(fakeBin, 'git'), 0o755);
  const run = invoke(fx, base, 'dirty-spoofed-git', {
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ''}`,
  });
  assert.equal(run.result.status, 0, JSON.stringify(run.report));
  assert.equal(run.report.level, 'comprehensive');
  assert.ok(run.report.reasonCodes.includes('dirty-tree'));
  assert.equal(invoked(run.report).length, 9);
});

test('Given no trusted Git executable, when shipped verification runs, then it fails closed comprehensive', (t) => {
  const fx = fixture(t);
  const preload = path.join(fx.root, 'hide-trusted-git.js');
  fs.writeFileSync(preload, `'use strict';\nconst fs=require('node:fs');\nconst original=fs.statSync;\nconst trusted=new Set(['/usr/bin/git','/bin/git','/opt/homebrew/bin/git','/usr/local/bin/git']);\nfs.statSync=(candidate,...args)=>{if(trusted.has(candidate)){const error=new Error('missing trusted git');error.code='ENOENT';throw error;}return original(candidate,...args);};\n`);
  const run = invoke(fx, base, 'missing-trusted-git', { NODE_OPTIONS: `--require=${preload}` });
  assert.equal(run.result.status, 0, JSON.stringify(run.report));
  assert.equal(run.report.level, 'comprehensive');
  assert.ok(run.report.reasonCodes.includes('dirty-tree'));
  assert.equal(invoked(run.report).length, 9);
});

test('Given a targeted runtime failure, when shipped verification runs, then it escalates through actual comprehensive gates and fails', (t) => {
  const fx = fixture(t);
  fs.writeFileSync(fx.behavior, '{"targeted-tests":"failed"}\n');
  spawnSync('git', ['add', 'behavior.json'], { cwd: fx.target });
  spawnSync('git', ['-c', 'user.name=Risk Test', '-c', 'user.email=risk@test.invalid', 'commit', '-qm', 'failure fixture'], { cwd: fx.target });
  const run = invoke(fx, base, 'runtime-failure');
  assert.equal(run.result.status, 1, run.result.stderr);
  assert.equal(run.report.level, 'comprehensive');
  assert.ok(run.report.reasonCodes.includes('runtime-gate-failure'));
  assert.equal(run.report.gateResults[0].outcome, 'failed');
  assert.equal(invoked(run.report).length, 9);
  assert.equal(run.report.allPassed, false);
});

test('Given malformed CLI flags, when shipped verification is invoked, then it rejects without executing gates', (t) => {
  const fx = fixture(t);
  const result = spawnSync('bash', [tooling, 'verification-risk', '--target', fx.target, '--wat'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unsupported verification-risk option/);
  assert.equal(fs.existsSync(fx.log), false);
});

test('Given a hung gate command, when shipped verification runs, then the bounded timeout is reported and comprehensive gates continue', (t) => {
  const fx = fixture(t);
  const config = JSON.parse(fs.readFileSync(fx.configPath, 'utf8'));
  config['targeted-tests'] = [process.execPath, '-e', 'setInterval(() => {}, 1000)'];
  fs.writeFileSync(fx.configPath, `${JSON.stringify(config)}\n`);
  spawnSync('git', ['add', 'gates.json'], { cwd: fx.target });
  spawnSync('git', ['-c', 'user.name=Risk Test', '-c', 'user.email=risk@test.invalid', 'commit', '-qm', 'timeout fixture'], { cwd: fx.target });
  const started = Date.now();
  const inputPath = path.join(fx.reports, 'timeout-input.json');
  const reportPath = path.join(fx.reports, 'timeout-report.json');
  fs.writeFileSync(inputPath, `${JSON.stringify(base)}\n`);
  const result = spawnSync('bash', [tooling, 'verification-risk', '--target', fx.target,
    '--input', inputPath, '--gate-config', fx.configPath, '--report', reportPath, '--timeout', '1'], {
    encoding: 'utf8', env: { ...process.env, LAZYBUDDY_PYTHON: python },
  });
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.equal(result.status, 1);
  assert.ok(Date.now() - started < 10000);
  assert.equal(report.gateResults[0].reason, 'deadline_exceeded');
  assert.equal(report.level, 'comprehensive');
  assert.equal(report.gateResults.length, 9);
});
