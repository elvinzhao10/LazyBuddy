import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { serviceFixture } from './service-fixture.mjs';
import { processCall } from './command-fixture.mjs';

// T20b residual 2 regression pin: the served git observation route invokes the
// vendored local collector on a REAL Git repository. T2 proved the route on a
// non-git fixture (unavailable/NOT_A_REPOSITORY); this suite gives the
// repository a commit history and asserts the collector identity, the observed
// HEAD binding, the commit coverage, and the exact collector command purposes
// actually executed — so a future route that fabricates git facts from thin air
// cannot pass.

const exec = (command, options) => promisify(execFile)('/bin/sh', ['-c', command], options);
const projectCLI = fileURLToPath(new URL('../../project/cli.mjs', import.meta.url));
const PLAN = '# Collector plan\n\n- [ ] Observe the repository\n';

async function projectCall(root, action, value) {
  return processCall([process.execPath, projectCLI, action, '--project-root', root,
    '--project-id', 'project:b1', '--actor', 'test:collectors'], value === undefined ? '' : JSON.stringify(value));
}

test('the served git route runs the vendored local collector against a committed repository', async () => {
  const f = await serviceFixture();
  try {
    // A real repository: init, identity, one committed plan document.
    await mkdir(join(f.root, '.omo/plans'), { recursive: true });
    await writeFile(join(f.root, '.omo/plans/collector.md'), PLAN);
    await exec('git init --initial-branch=main', { cwd: f.root });
    await exec('git add .omo/plans/collector.md', { cwd: f.root });
    await exec('git -c user.email=t20b@example.test -c user.name=T20b commit -m "collector fixture commit"', { cwd: f.root });
    const { stdout: head } = await exec('git rev-parse HEAD', { cwd: f.root });

    assert.equal((await projectCall(f.root, 'init')).code, 0);
    const registered = await projectCall(f.root, 'command', { schema_version: 1, command_id: 'register:collector',
      project_id: 'project:b1', expected_revision: 0, operation: 'register_source',
      payload: { id: 'source:collector', path: '.omo/plans/collector.md', role: 'plan' } });
    assert.equal(registered.code, 0, registered.stderr);

    const response = await f.request('/api/project/git');
    assert.equal(response.status, 200, JSON.stringify(response.value));
    const git = response.value.git;
    assert.equal(git.status, 'observed', JSON.stringify(git));
    assert.equal(git.collector, 'git-observation/local@1', 'the vendored local collector identity');
    assert.equal(git.unavailableReason, null);
    assert.equal(git.head, head.trim(), 'observed HEAD binds to the real repository');
    assert.equal(git.repository.root, f.root);
    assert.equal(git.commits.status, 'observed');
    assert.equal(git.commits.list.length, 1);
    assert.equal(git.commits.list[0].oid, head.trim());
    assert.equal(git.commits.list[0].subject, 'collector fixture commit');
    assert.deepEqual(git.commits.coverage, { reported: 1, total: 1 });
    assert.equal(git.worktrees.length, 1);
    assert.equal(git.worktrees[0].kind, 'main');
    assert.equal(git.worktrees[0].current, true);
    // The scoped plan document is registered content, so an edit to it must
    // surface through the route's changed-path binding on a later call.
    await writeFile(join(f.root, '.omo/plans/collector.md'), `${PLAN}- [ ] Dirty the worktree\n`);
    const dirty = await f.request('/api/project/git');
    const scopeBinding = dirty.value.git.worktrees[0];
    assert.equal(dirty.value.git.status, 'observed');
    assert.ok(scopeBinding.uncommitted.unstaged.some(entry => entry.path === '.omo/plans/collector.md'),
      'registered source scope drives the changed-path binding');
    assert.ok(scopeBinding.binding.relevantChangedPaths.some(entry => entry.path === '.omo/plans/collector.md'),
      'the dirty-content binding covers the registered plan document');
    // Restore a clean tree so teardown stays deterministic.
    await writeFile(join(f.root, '.omo/plans/collector.md'), PLAN);
  } finally { await f.cleanup(); }
});

test('the same served route stays typed-unavailable outside a repository', async () => {
  const f = await serviceFixture();
  try {
    assert.equal((await projectCall(f.root, 'init')).code, 0);
    const response = await f.request('/api/project/git');
    assert.equal(response.status, 200);
    assert.equal(response.value.git.status, 'unavailable');
    assert.equal(response.value.git.collector, 'git-observation/local@1');
    assert.equal(response.value.git.unavailableReason, 'NOT_A_REPOSITORY');
    assert.deepEqual(response.value.git.commits, { status: 'unavailable', reason: 'GIT_FACTS_UNAVAILABLE', list: [], coverage: null });
  } finally { await f.cleanup(); }
});
