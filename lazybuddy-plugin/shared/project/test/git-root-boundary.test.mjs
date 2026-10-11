import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectLocalGitFacts } from '../git-observation/local.mjs';

test('a nested project root is explicitly unavailable instead of inheriting its parent worktree identity', async t => {
  const root = mkdtempSync(join(tmpdir(), 'git-root-boundary-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: root });
  const nested = join(root, 'apps', 'nested'); mkdirSync(nested, { recursive: true });
  const result = await collectLocalGitFacts({ repositoryRoot: nested, sourceScope: ['src/'] });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'PROJECT_ROOT_NOT_WORKTREE');
  assert.equal(result.repository.root, realpathSync(nested));
  assert.equal(Object.hasOwn(result, 'worktrees'), false);
});
