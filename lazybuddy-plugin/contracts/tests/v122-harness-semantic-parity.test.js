'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const pluginRoot = path.resolve(__dirname, '..', '..');
const hook = path.join(pluginRoot, 'scripts', 'hooks', 'user-prompt-submit.sh');
const completion = path.join(pluginRoot, 'contracts', 'validate-lazyseries-record.js');

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', ...options });
}

function createProject(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lazybuddy-v122-public-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const args of [
    ['init', '-q'],
    ['config', 'user.email', 'parity@example.invalid'],
    ['config', 'user.name', 'Parity Fixture'],
  ]) {
    const result = run('/usr/bin/git', ['-C', root, ...args]);
    assert.equal(result.status, 0, result.stderr);
  }
  fs.writeFileSync(path.join(root, '.gitignore'), '.lazybuddy/\n');
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'clean\n');
  const staged = run('/usr/bin/git', ['-C', root, 'add', '.gitignore', 'tracked.txt']);
  assert.equal(staged.status, 0, staged.stderr);
  const saved = run('/usr/bin/git', ['-C', root, 'commit', '-qm', 'fixture']);
  assert.equal(saved.status, 0, saved.stderr);
  return root;
}

function adaptive(root, prompt, adaptiveContext) {
  const input = JSON.stringify({
    event: 'user_prompt_submit', cwd: root, session_id: 'public-adapter-test', prompt,
    adaptive_context: adaptiveContext,
  });
  const result = run('bash', [hook], {
    cwd: root, env: { ...process.env, CODEBUDDY_PLUGIN_ROOT: pluginRoot, CWD: root }, input,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('v1.2.2 public adaptive adapter selects behavior without fixture projection', (t) => {
  // Given: a real clean Git project and ordinary simple and cross-file requests.
  const root = createProject(t);
  // When: both requests cross the shipped UserPromptSubmit adapter.
  const simple = adaptive(root, 'Rename the local heading.', { scope: 'localized', file_count: 1 });
  const complex = adaptive(root, 'Implement the cache correction across parser and renderer.', {
    scope: 'cross-file', file_count: 4,
  });
  // Then: the public decisions select the smallest sufficient existing workflows.
  assert.equal(simple.decision.mode, 'direct');
  assert.deepEqual(simple.selection.workflowSurfaces, []);
  assert.equal(complex.decision.mode, 'assisted');
  assert.deepEqual(complex.selection.workflowSurfaces, ['lazy-start-work']);
});

test('v1.2.2 public completion adapter rejects stale identity', () => {
  // Given: the canonical completion fixture and its real artifact tree.
  const root = path.join(pluginRoot, 'contracts', 'fixtures', 'completion-evidence-v1');
  const common = ['completion', '--project-root', root, '--repo-head', 'a'.repeat(40),
    '--package-version', '1.2.0', '--criterion-id', 'criterion-contracts'];
  // When: the shipped completion adapter assesses current and stale authority.
  const current = run(process.execPath, [completion, ...common, path.join(root, 'valid.json')]);
  const stale = run(process.execPath, [completion, ...common, path.join(root, 'wrong-head.json')]);
  // Then: current evidence is ready while a mismatched revision fails closed.
  assert.equal(current.status, 0, current.stderr);
  assert.equal(current.stdout, 'PASS: completion record valid\n');
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /repo_head/);
});
