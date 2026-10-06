import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMiniDom } from './fixtures/mini-dom.mjs';

// T18 interface under test: the Git detail pane and the metrics drill-down
// pane. Git facts come from the REAL T11 collectors over a REAL disposable git
// fixture (two worktrees, staged+unstaged on one file, untracked content, a
// real merge commit, and a branch rename applied between collections); the
// numbers come from the REAL T10 accounting functions (spec §8.1 fixtures).
// The view renders their recorded results — it never re-collects, never
// recomputes arithmetic, never renders unavailable data as zero or healthy.
const dom = createMiniDom();
globalThis.document = dom.document;

const { collectLocalGitFacts } = await import('../../project/git-observation/local.mjs');
const { collectRemoteFacts } = await import('../../project/git-observation/remote.mjs');
const { localObservationRecords } = await import('../../project/git-observation/records.mjs');
const { accountTime, normalizeUsage, usageWithSubsets } = await import('../../project/usage-accounting.mjs');
const { gitDetailModel, metricsDetailModel } = await import('../ui/git-metrics-model.mjs');
const { createGitMetricsView } = await import('../ui/git-metrics-view.mjs');

const evidenceDirectory = process.env.T18_EVIDENCE_DIR
  ?? '/Users/Admin/Desktop/lazyseries/.omo/evidence/lazyseries-1.4.0-project-platform/T18';
const SCOPE = ['docs/', 'src/'];
const PROJECT_SCOPE = { repository: 'fixture:t18-git', runtime: 'LazyBuddy' };
const WINDOW = { start: '2026-10-06T12:00:00Z', end: '2026-10-06T12:30:00Z' };
const AS_OF = '2026-10-06T12:30:00Z';

const git = (args, cwd) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
};

function put(root, path, content) {
  const target = join(root, path);
  mkdirSync(join(root, path.split('/').slice(0, -1).join('/')), { recursive: true });
  writeFileSync(target, content);
}

// The remote collector's process boundary, stubbed for the OBSERVED path only:
// the real parseRemoteUrl/mapPullRequest/coverage logic runs; no network and
// no authenticated gh exists inside a disposable fixture.
function fakeRemoteExec(file, args) {
  const argv = args.join(' ');
  if (argv.includes('remote') && argv.includes('get-url')) {
    return Promise.resolve({ code: 0, stdout: Buffer.from('https://github.com/elvinzhao10/LazyBuddy.git\n'), stderr: Buffer.alloc(0) });
  }
  if (file === 'gh' && argv.startsWith('pr list')) {
    return Promise.resolve({ code: 0, stdout: Buffer.from(`${JSON.stringify([{
      number: 47, title: '1.4.0 dashboard foundation', state: 'OPEN', isDraft: false,
      url: 'https://github.com/elvinzhao10/LazyBuddy/pull/47',
      headRefName: 'feat/dashboard-1.4.0', headRefOid: 'a1b2c3d4'.padEnd(40, 'a'),
      baseRefName: 'main', baseRefOid: '9f8e7d6c'.padEnd(40, 'b'),
    }])}\n`), stderr: Buffer.alloc(0) });
  }
  return Promise.resolve({ code: 1, stdout: Buffer.alloc(0), stderr: Buffer.from(`unexpected fixture command: ${file} ${argv}`) });
}

const observationIdsFor = local => {
  const ids = { git: null, worktrees: {} };
  for (const record of localObservationRecords(local)) {
    if (record.subject.kind === 'git' && record.subject.worktree === undefined) ids.git = record.id;
    if (record.subject.kind === 'worktree') ids.worktrees[record.subject.worktree] = record.id;
  }
  return ids;
};

const fixture = { root: null, linked: null };

test.before(async () => {
  fixture.root = mkdtempSync(join(realpathSync(tmpdir()), 't18-git-metrics-'));
  git(['init', '-q', '-b', 'main', fixture.root]);
  git(['config', 'user.email', 't18@test.local'], fixture.root);
  git(['config', 'user.name', 't18-test'], fixture.root);
  git(['config', 'commit.gpgsign', 'false'], fixture.root);
  put(fixture.root, 'README.md', '# Fixture\n');
  put(fixture.root, 'docs/requirements.md', '# Requirements\n\n## Offline\n\nWork without a network.\n');
  put(fixture.root, 'src/app.js', 'export const app = 1;\n');
  git(['add', '-A'], fixture.root);
  git(['commit', '-qm', 'base'], fixture.root);

  // A real merge commit: the commit list must record both parent OIDs.
  git(['checkout', '-q', '-b', 'merge-side'], fixture.root);
  put(fixture.root, 'src/extra.js', 'export const extra = 1;\n');
  git(['add', 'src/extra.js'], fixture.root);
  git(['commit', '-qm', 'side work'], fixture.root);
  git(['checkout', '-q', 'main'], fixture.root);
  git(['merge', '-q', '--no-ff', 'merge-side', '-m', 'merge: side work'], fixture.root);

  // A real linked worktree on its own branch (renamed later, mid-test).
  fixture.linked = `${fixture.root}-linked`;
  git(['worktree', 'add', '-q', fixture.linked, '-b', 'feature-old'], fixture.root);

  // Main worktree dirty state: staged+unstaged edits on ONE file, a staged
  // rename, an unstaged edit, untracked content — the union must count the
  // shared file once.
  put(fixture.root, 'src/app.js', 'export const app = 1;\n// staged edit\n');
  git(['add', 'src/app.js'], fixture.root);
  put(fixture.root, 'src/app.js', 'export const app = 1;\n// staged edit\n// unstaged edit\n');
  git(['mv', 'docs/requirements.md', 'docs/requirements-v2.md'], fixture.root);
  put(fixture.root, 'README.md', '# Fixture\n# unstaged main edit\n');
  put(fixture.root, 'notes/new.md', 'untracked note\n');

  // Linked worktree dirty state, including the same README.md path (advisory
  // concurrent-edit overlap, never an actual Git conflict).
  put(fixture.linked, 'README.md', '# Fixture\n# unstaged linked edit\n');
  put(fixture.linked, 'src/app.js', 'export const app = 1;\n// linked staged edit\n');
  git(['add', 'src/app.js'], fixture.linked);
  put(fixture.linked, 'linked-note.txt', 'linked untracked\n');
});

test.after(() => {
  const receipt = [];
  if (fixture.root && existsSync(fixture.linked)) {
    try { git(['worktree', 'remove', '--force', fixture.linked], fixture.root); receipt.push('worktree-removed'); }
    catch { rmSync(fixture.linked, { recursive: true, force: true }); receipt.push('worktree-rm-sync'); }
  }
  if (fixture.root && existsSync(fixture.root)) {
    rmSync(fixture.root, { recursive: true, force: true });
    receipt.push('root-removed');
  }
  assert.equal(existsSync(fixture.root), false);
  process.stdout.write(`cleanup receipt: ${receipt.join(',')}\n`);
});

test('git and metrics detail views render real T11 collections and T10 arithmetic exactly', async () => {
  // --- Real collections over the real fixture. ---
  const localBefore = await collectLocalGitFacts({ repositoryRoot: fixture.root, sourceScope: SCOPE });
  assert.equal(localBefore.status, 'observed');
  const remoteObserved = await collectRemoteFacts({ repositoryRoot: fixture.root, exec: fakeRemoteExec,
    gitBinary: 'git', ghBinary: 'gh' });
  assert.equal(remoteObserved.status, 'observed', remoteObserved.reason ?? '');
  const remoteUnavailable = await collectRemoteFacts({ repositoryRoot: fixture.root });
  assert.equal(remoteUnavailable.status, 'unavailable');
  assert.equal(remoteUnavailable.reason, 'NO_REMOTE');

  // --- Real T10 arithmetic: the four spec §8.1 fixtures. ---
  const timeResult = {
    ...accountTime({
      window_start: WINDOW.start, window_end: WINDOW.end,
      intervals: [
        { agent_id: 'agent:A', role: 'worker', started_at: '2026-10-06T12:00:00Z', ended_at: '2026-10-06T12:10:00Z' },
        { agent_id: 'agent:B', role: 'worker', started_at: '2026-10-06T12:05:00Z', ended_at: '2026-10-06T12:15:00Z' },
        { agent_id: 'agent:C', role: 'worker', started_at: '2026-10-06T12:20:00Z', ended_at: '2026-10-06T12:25:00Z' },
      ],
    }),
    source_record_ids: ['interval:agent:A:0', 'interval:agent:B:0', 'interval:agent:C:0'],
  };
  assert.equal(timeResult.elapsed_minutes, 30);
  assert.equal(timeResult.observed_execution_wall_minutes, 20);
  assert.equal(timeResult.recorded_agent_minutes, 25);
  assert.equal(timeResult.peak_concurrency, 2);

  const usageCoverage = normalizeUsage(Array.from({ length: 10 }, (_, index) => ({
    id: `d${index}`, request_id: `req:${index}`, kind: 'delta',
    observed_at: `2026-10-06T12:0${index}:00Z`, usage: index < 7 ? { total_tokens: index + 1 } : {},
  })));
  assert.equal(usageCoverage.coverage.requests_with_usage, 7);
  assert.equal(usageCoverage.coverage.distinct_request_ids, 10);
  assert.equal(usageCoverage.totals.total_tokens, 28);

  const usageCumulative = normalizeUsage([
    { id: 'r1-s1', request_id: 'req:1', kind: 'cumulative-snapshot', observed_at: '2026-10-06T12:00:00Z', usage: { total_tokens: 40 } },
    { id: 'r1-s2', request_id: 'req:1', kind: 'cumulative-snapshot', observed_at: '2026-10-06T12:02:00Z', usage: { total_tokens: 100 } },
    { id: 'r1-final', request_id: 'req:1', kind: 'final-value', observed_at: '2026-10-06T12:03:00Z', usage: { total_tokens: 100 } },
    { id: 'r2-d1', request_id: 'req:2', kind: 'delta', observed_at: '2026-10-06T12:04:00Z', usage: { total_tokens: 0 } },
  ]);
  assert.equal(usageCumulative.totals.total_tokens, 100);

  const subsetsResult = {
    ...usageWithSubsets({ input_total: 100, cached_input: 40, output_total: 50, reasoning_output: 20 }),
    source_record_ids: ['usage:provider-declaration:1'],
  };
  assert.equal(subsetsResult.total_tokens, 150);

  // --- Models and the view. ---
  const idsBefore = observationIdsFor(localBefore);
  const gitModel = gitDetailModel({ local: localBefore, remote: remoteObserved, observationIds: idsBefore });
  const metricsContext = { scope: PROJECT_SCOPE, filters: ['plan:search'], window: WINDOW,
    asOf: AS_OF, projectionRevision: 41 };
  const metricsCoverage = metricsDetailModel({ ...metricsContext,
    accounting: { time: timeResult, usage: usageCoverage }, git: gitModel });
  const view = createGitMetricsView({ git: gitModel, metrics: metricsCoverage });

  const gitPane = view.element.querySelector('[data-testid="git-pane"]');
  const metricsPane = view.element.querySelector('[data-testid="metrics-pane"]');
  assert.ok(gitPane, 'the Git pane renders');
  assert.ok(metricsPane, 'the metrics pane renders');
  assert.notEqual(gitPane, metricsPane, 'Git stages and time/token accounting are distinct panes');
  // Visual distinctness is structural: stage/dirty/PR subjects exist only in
  // the Git pane; metric rows exist only in the metrics pane.
  assert.equal(gitPane.querySelectorAll('[data-metric-id]').length, 0);
  assert.equal(metricsPane.querySelectorAll('[data-stage], [data-testid="git-uncommitted-snapshot"], [data-testid="git-dirty-binding"]').length, 0);
  const timeSection = metricsPane.querySelector('[data-section-id="metrics:time"]');
  assert.ok(timeSection.textContent.toLowerCase().includes('git stages never appear') || timeSection.textContent.includes('Git stages never appear in this section'));

  // --- Worktree selection: branch label vs commit identity, union counting. ---
  const cards = [...gitPane.querySelectorAll('.git-worktree')];
  assert.equal(cards.length, 2);
  const mainCard = cards.find(card => card.dataset.kind === 'main');
  const linkedCard = cards.find(card => card.dataset.kind === 'linked');
  const headOid = git(['rev-parse', 'HEAD'], fixture.root).trim();
  const branchLabel = mainCard.querySelector('[data-identity-kind="branch-label"]');
  const commitIdentity = mainCard.querySelector('[data-identity-kind="commit-identity"]');
  assert.equal(branchLabel.querySelector('code').textContent, 'main');
  assert.ok(branchLabel.textContent.includes('moving label'));
  assert.equal(commitIdentity.querySelector('code').textContent, headOid);
  assert.ok(commitIdentity.textContent.includes('immutable'));

  // Union counting: the staged+unstaged file counts once. The displayed counts
  // equal the collector's own per-class totals and the union total.
  const collectedMain = localBefore.worktrees.find(worktree => worktree.current);
  const shared = 'src/app.js';
  assert.ok(collectedMain.changed.staged.paths.some(entry => entry.path === shared));
  assert.ok(collectedMain.changed.unstaged.paths.some(entry => entry.path === shared),
    'the fixture must have one path staged AND unstaged');
  const classSum = collectedMain.changed.staged.total + collectedMain.changed.unstaged.total
    + collectedMain.changed.untracked.total + collectedMain.changed.unmerged.total;
  assert.ok(classSum > collectedMain.changed.union_total, 'sanity: the per-class sum exceeds the union');
  const mainCounts = mainCard.querySelector('[data-testid="git-union-counts"]');
  assert.equal(mainCounts.querySelector('[data-stage="staged"]').dataset.count, String(collectedMain.changed.staged.total));
  assert.equal(mainCounts.querySelector('[data-stage="unstaged"]').dataset.count, String(collectedMain.changed.unstaged.total));
  assert.equal(mainCounts.querySelector('[data-stage="untracked"]').dataset.count, String(collectedMain.changed.untracked.total));
  assert.equal(mainCounts.querySelector('[data-stage="unmerged"]').dataset.count, String(collectedMain.changed.unmerged.total));
  assert.equal(mainCounts.querySelector('[data-stage="union"]').dataset.count, String(collectedMain.changed.union_total));
  assert.equal(collectedMain.changed.union_total, 4);
  assert.equal(classSum, 5, '2 staged + 2 unstaged + 1 untracked, with src/app.js in two classes');
  assert.ok(mainCounts.textContent.includes('one changed path in the union'));
  const linkedCounts = linkedCard.querySelector('[data-testid="git-union-counts"]');
  assert.equal(linkedCounts.querySelector('[data-stage="union"]').dataset.count, '3');

  // Uncommitted changes are explicit uncommitted snapshots, never commits.
  assert.equal(gitPane.querySelectorAll('[data-testid="git-uncommitted-snapshot"][data-snapshot-kind="uncommitted-snapshot"]').length, 2);
  assert.ok(mainCard.querySelector('[data-testid="git-uncommitted-snapshot"]').textContent.includes('not commits'));
  const commitCards = [...gitPane.querySelectorAll('.git-commit')];
  assert.ok(commitCards.length >= 3);
  for (const card of commitCards) assert.match(card.dataset.commitOid, /^[0-9a-f]{40}$/);
  assert.equal(commitCards.length, localBefore.commits.observed.length);
  assert.ok(commitCards.every(card => !/uncommitted/i.test(card.textContent)), 'no fabricated uncommitted commit');

  // The merge commit lists BOTH parent OIDs, taken from real parent OIDs.
  const mergeCard = commitCards.find(card => card.dataset.commitOid === headOid);
  assert.equal(mergeCard.dataset.isMerge, 'true');
  assert.equal(mergeCard.dataset.parentCount, '2');
  const expectedParents = git(['rev-parse', 'HEAD^1', 'HEAD^2'], fixture.root).split('\n').map(value => value.trim()).filter(Boolean);
  assert.deepEqual([...mergeCard.querySelectorAll('.git-parent-oid')].map(node => node.dataset.parentOid), expectedParents);
  assert.ok(mergeCard.textContent.includes('observed by collector'), 'collector observation time stays separate from source timestamps');

  // The read-only dirty-content binding is surfaced with its digest.
  const binding = mainCard.querySelector('[data-testid="git-dirty-binding"]');
  assert.equal(binding.dataset.readOnly, 'true');
  assert.equal(binding.dataset.headOid, headOid);
  assert.match(binding.dataset.digest, /^[a-f0-9]{64}$/);
  assert.ok(binding.textContent.includes('same HEAD plus a changed relevant path stales affected proof'));
  assert.ok(binding.textContent.includes('branch rename does not'));

  // Advisory overlap is listed but never an actual Git conflict.
  const conflicts = gitPane.querySelector('[data-testid="git-conflicts"]');
  assert.equal(conflicts.querySelectorAll('[data-conflict-kind]').length, 4);
  assert.ok(conflicts.querySelector('[data-conflict-kind="concurrent-edit-overlap"]').textContent.includes('README.md'));
  assert.ok(conflicts.querySelector('[data-conflict-kind="concurrent-edit-overlap"]').textContent.includes('advisory'));
  assert.ok(conflicts.querySelector('[data-conflict-kind="actual-unmerged-index"]').textContent.includes('exact zero'));
  assert.ok(conflicts.querySelector('[data-conflict-kind="predicted-merge-conflict"]').textContent.includes('MERGE_SIMULATION_EXCLUDED'));

  // --- PR/CI subjects when observed: head/base/tested-subject separate. ---
  const prSection = gitPane.querySelector('[data-testid="git-pull-requests"]');
  assert.equal(prSection.dataset.remoteStatus, 'observed');
  const prCard = prSection.querySelector('[data-pr-number="47"]');
  const subjects = [...prCard.querySelectorAll('.git-pr-field')].map(node => node.dataset.subject);
  assert.deepEqual(subjects.sort(), ['base', 'checks', 'head', 'test-merge', 'tested-subject']);
  const headField = prCard.querySelector('[data-subject="head"]');
  const baseField = prCard.querySelector('[data-subject="base"]');
  assert.ok(headField.textContent.includes('feat/dashboard-1.4.0'));
  assert.ok(headField.textContent.includes('a1b2c3d4'.padEnd(40, 'a')));
  assert.ok(baseField.textContent.includes('main'));
  assert.notEqual(headField.textContent, baseField.textContent, 'PR head and base stay separate subjects');
  assert.ok(prCard.querySelector('[data-subject="tested-subject"]').textContent.includes('CI_TESTED_SUBJECT_NOT_OBSERVED'));
  assert.ok(prCard.querySelector('[data-subject="test-merge"]').textContent.includes('never the PR head'));
  assert.ok(prCard.querySelector('[data-subject="checks"]').textContent.includes('CHECK_RUNS_NOT_OBSERVED'));

  // --- The four §8.1 fixtures render the exact numbers. ---
  const rowText = id => metricsPane.querySelector(`[data-metric-id="${id}"]`).textContent;
  assert.equal(rowText('metric:time:elapsed'), 'Elapsed run time: 30 minutes');
  assert.equal(rowText('metric:time:wall'), 'Observed execution wall time: 20 minutes');
  assert.equal(rowText('metric:time:agent'), 'Recorded agent time: 25 minutes');
  assert.equal(rowText('metric:time:peak'), 'Peak concurrency: 2 agents');

  assert.ok(rowText('metric:usage:coverage').includes('Reported request coverage: 7 requests'));
  assert.equal(rowText('metric:usage:total_tokens'), 'Total tokens: 28 tokens');
  view.openMetric('metric:usage:coverage');
  const recordsPanel = view.element.querySelector('[data-testid="metrics-records"]');
  assert.ok(recordsPanel.textContent.includes('usage reported for 7 of 10 recorded requests'));
  assert.ok(recordsPanel.textContent.includes('the totals cover only the reporting requests'));

  // Every opened total shows the exact §8 fields: scope, filters, window,
  // definition, unit, basis, source records, coverage, as-of.
  view.openMetric('metric:time:elapsed');
  const fields = [...recordsPanel.querySelectorAll('.metric-field')].map(node => node.dataset.field);
  assert.deepEqual(fields, ['scope', 'filters', 'window', 'definition', 'unit', 'basis', 'source-records', 'coverage', 'as-of']);
  assert.ok(recordsPanel.textContent.includes('includes waiting'));
  assert.ok(recordsPanel.textContent.includes('interval:agent:A:0'));
  assert.ok(recordsPanel.textContent.includes(`${AS_OF} · projection revision 41`));

  const metricsSubsets = metricsDetailModel({ ...metricsContext,
    accounting: { time: timeResult, subsets: subsetsResult }, git: gitModel });
  const viewSubsets = createGitMetricsView({ git: gitModel, metrics: metricsSubsets });
  const subsetsPane = viewSubsets.element.querySelector('[data-testid="metrics-pane"]');
  assert.equal(subsetsPane.querySelector('[data-metric-id="metric:usage:subsets:input"]').textContent,
    'Input tokens (incl. declared subset): 100 tokens');
  assert.equal(subsetsPane.querySelector('[data-metric-id="metric:usage:subsets:total"]').textContent,
    'Total tokens (subsets never added again): 150 tokens');
  viewSubsets.openMetric('metric:usage:subsets:input');
  const subsetPanel = viewSubsets.element.querySelector('[data-testid="metrics-records"]');
  assert.ok(subsetPanel.textContent.includes('cached 40 is a subset of the 100 total'));
  assert.ok(subsetPanel.textContent.includes('never added again'));
  assert.ok(!subsetsPane.textContent.includes('210'), 'the subset total is 150, never 210');

  const metricsCumulative = metricsDetailModel({ ...metricsContext,
    accounting: { time: timeResult, usage: usageCumulative }, git: gitModel });
  const viewCumulative = createGitMetricsView({ git: gitModel, metrics: metricsCumulative });
  const cumulativePane = viewCumulative.element.querySelector('[data-testid="metrics-pane"]');
  assert.equal(cumulativePane.querySelector('[data-metric-id="metric:usage:total_tokens"]').textContent,
    'Total tokens: 100 tokens');
  viewCumulative.openMetric('metric:usage:total_tokens');
  // The contributing records are exactly T10's own attribution: the superseded
  // snapshot r1-s1 (40) is not a contributor to the final total of 100.
  const contributing = usageCumulative.requests.flatMap(request => request.source_record_ids);
  assert.deepEqual(contributing, ['r1-s2', 'r1-final', 'r2-d1']);
  for (const record of contributing) {
    assert.ok(viewCumulative.element.querySelector(`[data-testid="metrics-records"] [data-record-id="${record}"]`),
      `the cumulative total opens its contributing record ${record}`);
  }
  assert.equal(viewCumulative.element.querySelector('[data-testid="metrics-records"] [data-record-id="r1-s1"]'), null,
    'the superseded snapshot is not attributed to the displayed total');

  // --- Selection, open drill-down and keyboard interaction. ---
  const linkedId = linkedCard.dataset.worktreeId;
  view.selectWorktree(linkedId);
  view.openMetric('metric:usage:coverage');
  assert.ok(view.focusWorktree(linkedId));
  const focusedCard = dom.document.activeElement;
  focusedCard.dispatchEvent({ type: 'keydown', key: 'ArrowLeft' });
  assert.equal(dom.document.activeElement.dataset.worktreeId, mainCard.dataset.worktreeId,
    'ArrowLeft moves worktree focus');
  dom.document.activeElement.dispatchEvent({ type: 'keydown', key: 'ArrowRight' });
  assert.equal(dom.document.activeElement.dataset.worktreeId, linkedId, 'ArrowRight moves worktree focus');
  dom.document.activeElement.dispatchEvent({ type: 'keydown', key: 'Enter' });
  assert.equal(view.element.querySelector('.git-worktree[aria-pressed="true"]').dataset.worktreeId, linkedId,
    'Enter selects the focused worktree');

  assert.ok(view.focusMetric('metric:time:elapsed'));
  dom.document.activeElement.dispatchEvent({ type: 'keydown', key: 'ArrowDown' });
  assert.equal(dom.document.activeElement.dataset.metricId, 'metric:time:wall', 'ArrowDown moves metric focus');
  dom.document.activeElement.dispatchEvent({ type: 'keydown', key: 'Enter' });
  assert.equal(view.getStats().openMetricId, 'metric:time:wall', 'Enter opens the focused metric drill-down');

  // --- A branch rename between real collections: label moves, nothing else. ---
  const beforeLinked = localBefore.worktrees.find(worktree => worktree.root === realpathSync(fixture.linked));
  assert.equal(beforeLinked.branch, 'feature-old');
  git(['branch', '-m', 'feature-new'], fixture.linked);
  const localAfter = await collectLocalGitFacts({ repositoryRoot: fixture.root, sourceScope: SCOPE });
  const afterLinked = localAfter.worktrees.find(worktree => worktree.root === realpathSync(fixture.linked));
  assert.equal(afterLinked.branch, 'feature-new', 'the moving label is observed');
  assert.equal(afterLinked.head, beforeLinked.head, 'commit identity is unchanged');
  assert.equal(afterLinked.changed.union_total, beforeLinked.changed.union_total);
  assert.equal(afterLinked.binding.digest, beforeLinked.binding.digest, 'no content change, no binding change');

  const gitAfter = gitDetailModel({ local: localAfter, remote: remoteObserved, observationIds: observationIdsFor(localAfter) });
  const update = view.applyUpdate(gitAfter, metricsCoverage);
  assert.equal(update.selectedPreserved, true, 'worktree selection survives the polling update');
  assert.equal(update.openMetricPreserved, true, 'the open metric drill-down survives the polling update');
  assert.equal(view.element.querySelector('.git-worktree[aria-pressed="true"]').dataset.worktreeId, linkedId);
  const renamedCard = view.element.querySelector(`[data-worktree-id="${linkedId}"]`);
  assert.ok(renamedCard.textContent.includes('feature-new'), 'the renamed label renders');
  assert.equal(renamedCard.querySelector('[data-identity-kind="commit-identity"] code').textContent, beforeLinked.head);
  const renamedCounts = renamedCard.querySelector('[data-testid="git-union-counts"]');
  assert.equal(renamedCounts.querySelector('[data-stage="union"]').dataset.count, '3', 'no invented change from the rename');
  assert.equal(view.element.querySelectorAll('.git-commit').length, commitCards.length, 'the rename invents no commit');
  assert.ok(renamedCard.querySelector('[data-testid="git-dirty-binding"]').dataset.digest === beforeLinked.binding.digest);

  // --- Export the exact consumed fixture for the browser proof (same data path). ---
  mkdirSync(evidenceDirectory, { recursive: true });
  writeFileSync(join(evidenceDirectory, 'git-metrics-fixture.json'), `${JSON.stringify({
    writtenAt: new Date().toISOString(),
    meta: metricsContext,
    observationIds: { before: idsBefore, afterRename: observationIdsFor(localAfter) },
    collections: { before: localBefore, afterRename: localAfter },
    remotes: { observed: remoteObserved, unavailable: remoteUnavailable },
    accounting: { time: timeResult, usageCoverage, usageCumulative, subsets: subsetsResult },
  }, null, 2)}\n`);

  // Keep the provenance receipts for the verifier.
  fixture.exported = { commits: commitCards.length, worktrees: cards.length };
});

test('adversarial (misleading-success class): unavailable native data never renders as zero or healthy', async () => {
  // A real typed-unavailable remote collection (no remote configured).
  const local = await collectLocalGitFacts({ repositoryRoot: fixture.root, sourceScope: SCOPE });
  const remoteUnavailable = await collectRemoteFacts({ repositoryRoot: fixture.root });
  assert.equal(remoteUnavailable.status, 'unavailable');
  const gitModel = gitDetailModel({ local, remote: remoteUnavailable, observationIds: observationIdsFor(local) });
  const view = createGitMetricsView({ git: gitModel,
    metrics: metricsDetailModel({ scope: PROJECT_SCOPE, filters: [], window: WINDOW, asOf: AS_OF,
      projectionRevision: 41, accounting: {}, git: gitModel }) });
  const gitPane = view.element.querySelector('[data-testid="git-pane"]');
  const metricsPane = view.element.querySelector('[data-testid="metrics-pane"]');

  // gh-unavailable renders typed-unavailable — never "0 pull requests", never a healthy chip.
  const prSection = gitPane.querySelector('[data-testid="git-pull-requests"]');
  assert.equal(prSection.dataset.remoteStatus, 'unavailable');
  assert.ok(prSection.textContent.includes('NO_REMOTE'));
  assert.ok(!prSection.textContent.includes('0 pull requests'));
  assert.ok(!prSection.textContent.includes('0 PR'));
  assert.ok(prSection.querySelector('.status').dataset.state === 'unavailable');

  // Unknown usage values (real T10 null totals) render unavailable, never zero.
  const unknownUsage = normalizeUsage([
    { id: 'u1', request_id: 'req:unknown', kind: 'delta', observed_at: '2026-10-06T12:00:00Z', usage: { total_tokens: null } },
  ]);
  assert.equal(unknownUsage.totals.total_tokens, null);
  const viewUnknown = createGitMetricsView({ git: gitModel,
    metrics: metricsDetailModel({ scope: PROJECT_SCOPE, filters: [], window: WINDOW, asOf: AS_OF,
      projectionRevision: 41, accounting: { usage: unknownUsage }, git: gitModel }) });
  const unknownRow = viewUnknown.element.querySelector('[data-metric-id="metric:usage:total_tokens"]');
  assert.equal(unknownRow.dataset.unavailable, 'true');
  assert.equal(unknownRow.dataset.value, '');
  assert.ok(unknownRow.textContent.includes('unavailable'));
  assert.ok(!unknownRow.textContent.includes('0 tokens'), 'an unknown total never renders as zero');
  // An explicit reported zero stays a labeled reported zero, distinct from unknown.
  const reportedZeroUsage = normalizeUsage([
    { id: 'z1', request_id: 'req:zero', kind: 'delta', observed_at: '2026-10-06T12:01:00Z', usage: { total_tokens: 0 } },
  ]);
  assert.equal(reportedZeroUsage.totals.total_tokens, 0);
  const viewReportedZero = createGitMetricsView({ git: gitModel,
    metrics: metricsDetailModel({ scope: PROJECT_SCOPE, filters: [], window: WINDOW, asOf: AS_OF,
      projectionRevision: 41, accounting: { usage: reportedZeroUsage }, git: gitModel }) });
  const reportedZeroRow = viewReportedZero.element.querySelector('[data-metric-id="metric:usage:total_tokens"]');
  assert.equal(reportedZeroRow.dataset.zeroReported, 'true');
  assert.ok(reportedZeroRow.textContent.includes('0 tokens'));

  // A reported zero renders as a labeled reported zero, distinct from unknown.
  const timeZero = accountTime({ window_start: '2026-10-06T12:00:00Z', window_end: '2026-10-06T12:01:00Z', intervals: [] });
  const viewZero = createGitMetricsView({ git: gitModel,
    metrics: metricsDetailModel({ scope: PROJECT_SCOPE, filters: [], window: WINDOW, asOf: AS_OF,
      projectionRevision: 41, accounting: { time: timeZero }, git: gitModel }) });
  const zeroWall = viewZero.element.querySelector('[data-metric-id="metric:time:wall"]');
  assert.equal(zeroWall.dataset.zeroReported, 'true');
  assert.equal(zeroWall.dataset.unavailable === 'true', false);
  assert.ok(zeroWall.textContent.includes('0 minutes'));
  viewZero.openMetric('metric:time:wall');
  assert.ok(viewZero.element.querySelector('[data-testid="metrics-records"]').textContent.includes('no intervals recorded'));

  // A non-repository root collects typed unavailable through the real collector.
  const notARepo = mkdtempSync(join(realpathSync(tmpdir()), 't18-not-a-repo-'));
  try {
    const unavailableFacts = await collectLocalGitFacts({ repositoryRoot: notARepo, sourceScope: SCOPE });
    assert.equal(unavailableFacts.status, 'unavailable');
    assert.equal(unavailableFacts.reason, 'NOT_A_REPOSITORY');
    const gitUnavailable = gitDetailModel({ local: unavailableFacts });
    const viewUnavailable = createGitMetricsView({ git: gitUnavailable,
      metrics: metricsDetailModel({ scope: PROJECT_SCOPE, filters: [], window: WINDOW, asOf: AS_OF,
        projectionRevision: 41, accounting: {}, git: gitUnavailable }) });
    assert.ok(viewUnavailable.element.querySelector('[data-testid="git-facts-unavailable"]'));
    const changedRow = viewUnavailable.element.querySelector('[data-metric-id="metric:git:changed-paths"]');
    assert.equal(changedRow.dataset.unavailable, 'true', 'an unavailable collector is not a zero-changed-paths project');
    assert.ok(!changedRow.textContent.includes('0 paths'));
  } finally { rmSync(notARepo, { recursive: true, force: true }); }

  // No unavailable surface ever carries a verified/healthy chip.
  for (const chip of view.element.querySelectorAll('.status')) {
    if (chip.textContent.includes('unavailable')) assert.equal(chip.dataset.state, 'unavailable');
  }
  assert.ok(!metricsPane.textContent.includes('verified'), 'the metrics pane never labels unprojected data healthy');

  // Malformed model inputs fail closed at the boundary, never half-rendered.
  assert.throws(() => gitDetailModel({}), error => error.message === 'LOCAL_RESULT_REQUIRED');
  assert.throws(() => metricsDetailModel({ asOf: AS_OF }), error => error.message === 'SCOPE_AND_AS_OF_REQUIRED');
});
