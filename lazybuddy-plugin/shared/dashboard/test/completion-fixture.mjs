import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
export function completionFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-completion-'));
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const write = (file, value) => {
    const absolute = path.join(root, file); fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, typeof value === 'string' ? value : JSON.stringify(value));
  };
  const git = args => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 10000 });
    if (result.status !== 0) throw new Error(result.stderr); return result.stdout.trim();
  };
  try {
    git(['init', '-q']); git(['config', 'user.name', 'Projection fixture']); git(['config', 'user.email', 'projection@example.invalid']);
    write('.gitignore', '.lazybuddy/\n'); git(['add', '.gitignore']); git(['commit', '-qm', 'Fixture']);
    const head = git(['rev-parse', 'HEAD']); const plan = '# Plan\n- [x] [c1] Produce artifact\n';
    const review = { verdict: 'approved', verifier: { identity: 'reviewer:1' } };
    write('.lazybuddy/plan.md', plan); write('.lazybuddy/artifact.txt', 'observable\n'); write('.lazybuddy/review.json', review);
    const receipt = { schema_version: 'lazyseries.completion-evidence.v1', run_id: 'run-1', task_id: 'task-1', criterion_id: 'c1',
      repo_head: head, package_version: '1.3.5', command: 'fixture-observation', exit_code: 0,
      started_at: '2026-10-04T10:00:00Z', finished_at: '2026-10-04T10:00:01Z',
      artifact: { path: '.lazybuddy/artifact.txt', sha256: hash('observable\n') },
      executor: { identity: 'executor:1' }, verifier: { identity: 'reviewer:1' }, review: { verdict: 'approved', source_sha256: hash(JSON.stringify(review)) } };
    write('.lazybuddy/receipt.json', receipt);
    const authority = { schema_version: 'lazyseries.completion-authority.v1', run_id: 'run-1', repo_head: head, package_version: '1.3.5',
      plan: { id: 'plan-1', path: '.lazybuddy/plan.md', sha256: hash(plan) },
      criteria: [{ task_id: 'task-1', criterion_id: 'c1', applicable: true, status: 'complete', evidence_path: '.lazybuddy/receipt.json', review_path: '.lazybuddy/review.json' }] };
    write('.lazybuddy/authority.json', authority);
    return { root, head, plan_digest: hash(plan), write, receipt,
      options: { authorityPath: '.lazybuddy/authority.json', packageVersion: '1.3.5' }, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
  } catch (error) { fs.rmSync(root, { recursive: true, force: true }); throw error; }
}
