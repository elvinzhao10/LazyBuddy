import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMiniDom } from './fixtures/mini-dom.mjs';

// T18 interface under test: the REDESIGNED Git detail pane (segmented
// worktrees/commits master-detail, commit table with real parent OIDs and
// dirty-snapshot chips, dirty-snapshot visualization with per-stage status
// chips) and the metrics pane (designed data tables with tabular numerals,
// coverage chips and compact same-unit bar visualization) with the
// contributing-records drill-down in the T12 dock. Git facts come from the
// REAL T11 collectors over a REAL disposable git fixture (two worktrees,
// staged+unstaged on one file, untracked content, a real merge commit, and a
// branch rename applied between collections); the numbers come from the REAL
// T10 accounting functions (spec §8.1 fixtures). The view renders their
// recorded results — it never re-collects, never recomputes arithmetic, and
// never renders unavailable data as zero or healthy.
const dom = createMiniDom();
globalThis.document = dom.document;

const { collectLocalGitFacts } = await import('../../project/git-observation/local.mjs');
const { collectRemoteFacts } = await import('../../project/git-observation/remote.mjs');
const { localObservationRecords } = await import('../../project/git-observation/records.mjs');
const { accountTime, normalizeUsage, usageWithSubsets } = await import('../../project/usage-accounting.mjs');
const { gitDetailModel, metricsDetailModel } = await import('../ui/git-metrics-model.mjs');
const { createGitMetricsView } = await import('../ui/git-metrics-view.mjs');
const { installFocusSystem } = await import('../ui/components.mjs');

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

  // A real merge commit: the commit table must record both parent OIDs.
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

// The live Git pane of the view (re-queried after every mutation that
// re-renders, so assertions never read a detached subtree).
const paneOf = view => view.element.querySelector('[data-testid="git-pane"]');

// Tag walk (the mini-dom selector engine matches classes/attributes, not
// bare lowercase tag names).
const byTag = (scope, tag) => {
  const found = [];
  const visit = node => {
    for (const child of node.children) {
      if (child.tagName === tag.toUpperCase()) found.push(child);
      visit(child);
    }
  };
  visit(scope);
  return found;
};

// The metric table row for one metric id: { row, button, cells }.
function metricRowOf(scope, metricId) {
  for (const row of scope.querySelectorAll('[data-testid="metric-rows"] .metric-row')) {
    if (row.dataset.metricId === metricId) {
      return { row: row.parentNode.parentNode, button: row, cells: [...row.parentNode.parentNode.children] };
    }
  }
  return null;
}

function commitRowOf(scope, oid) {
  return scope.querySelector(`[data-testid="git-commit-table"] [data-parent-count][data-commit-oid="${oid}"]`) ?? null;
}

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
  // the Git pane; metric rows and bars exist only in the metrics pane.
  assert.equal(gitPane.querySelectorAll('[data-metric-id]').length, 0);
  assert.equal(metricsPane.querySelectorAll('[data-stage], [data-testid="git-uncommitted-snapshot"], [data-testid="git-dirty-binding"]').length, 0);
  const timeSection = metricsPane.querySelector('[data-section-id="metrics:time"]');
  assert.ok(timeSection.textContent.toLowerCase().includes('git stages never appear') || timeSection.textContent.includes('Git stages never appear in this section'));

  // --- Hierarchy (audit S1): one h2 in the view content, ordered h2 → h3 → h4.
  // The dock owns its own labelled region heading (a dialog-level h2), so the
  // page walks its headings outside the dock. ---
  assert.equal(byTag(view.element, 'h1').length, 0, 'the page owns the h1, not the view');
  const dockPanel = view.element.querySelector('[data-testid="metrics-dock"]');
  const headings = ['h2', 'h3', 'h4'].flatMap(tag => byTag(view.element, tag))
    .filter(node => !dockPanel.contains(node));
  assert.equal(headings.filter(node => node.tagName === 'H2').length, 1, 'the view renders exactly one h2');
  assert.equal(byTag(dockPanel, 'h2').length, 1, 'the dock owns exactly its own region heading');
  const levels = headings.map(node => Number(node.tagName.slice(1)));
  assert.deepEqual(levels, [...levels].sort((left, right) => left - right), 'heading levels proceed in order with no skip');
  assert.ok(levels.includes(3) && levels.includes(4), 'the panes carry h3 sections and h4 subsections');

  // --- The lead sentence is one readable human sentence (audit CO-2). ---
  const lead = view.element.querySelector('[data-testid="git-metrics-lead"]').textContent;
  assert.ok(lead.includes('2 worktrees observed'), lead);
  assert.ok(lead.includes('7 uncommitted changed paths'), lead);
  assert.ok(lead.includes('execution covered 20 of 30 elapsed minutes'), lead);
  assert.ok(lead.includes('usage reported for 7 of 10 recorded requests'), lead);

  // --- Master-detail: segmented control over worktrees and commits. ---
  const modeSwitch = gitPane.querySelector('[data-testid="git-mode-switch"]');
  assert.ok(modeSwitch, 'the segmented git-view control renders');
  assert.equal(modeSwitch.getAttribute('data-native-segmented'), 'true');
  assert.deepEqual([...modeSwitch.querySelectorAll('button')].map(node => node.dataset.segment), ['worktrees', 'commits']);
  assert.equal(modeSwitch.querySelector('[data-segment="worktrees"]').getAttribute('aria-pressed'), 'true');
  assert.ok(gitPane.querySelector('[data-testid="git-worktrees"]'), 'worktrees master renders by default');
  assert.equal(gitPane.querySelector('[data-testid="git-commit-table"]'), null, 'the commit table is not rendered in worktrees mode');
  view.setGitMode('commits');
  assert.equal(view.getStats().gitMode, 'commits');
  assert.ok(paneOf(view).querySelector('[data-testid="git-commit-table"]'), 'the commit table master renders in commits mode');
  assert.equal(paneOf(view).querySelector('[data-testid="git-worktrees"]'), null, 'the worktree list is not rendered in commits mode');
  view.setGitMode('worktrees');

  // --- Worktree selection: branch label vs commit identity, union counting. ---
  const cards = [...paneOf(view).querySelectorAll('.git-worktree')];
  assert.equal(cards.length, 2);
  const mainCard = cards.find(card => card.dataset.kind === 'main');
  const linkedCard = cards.find(card => card.dataset.kind === 'linked');
  const headOid = git(['rev-parse', 'HEAD'], fixture.root).trim();
  const branchLabel = mainCard.querySelector('[data-identity-kind="branch-label"]');
  const commitIdentity = mainCard.querySelector('[data-identity-kind="commit-identity"]');
  assert.equal(branchLabel.querySelector('code').textContent, 'main');
  assert.ok(branchLabel.textContent.includes('moving label'));
  assert.equal(commitIdentity.dataset.headOid, headOid);
  assert.ok(commitIdentity.textContent.includes('immutable'));

  // The current worktree is preselected; its detail is the master-detail pane.
  assert.equal(view.getStats().selectedWorktreeId, mainCard.dataset.worktreeId, 'the current worktree starts selected');
  let detail = paneOf(view).querySelector('[data-testid="git-detail"]');
  assert.equal(detail.dataset.testid, 'git-detail');
  const mainDetail = detail.querySelector('[data-testid="git-worktree-detail"]');
  assert.equal(mainDetail.dataset.worktreeId, mainCard.dataset.worktreeId);

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
  const mainCounts = mainDetail.querySelector('[data-testid="git-union-counts"]');
  assert.equal(mainCounts.querySelector('[data-stage="staged"]').dataset.count, String(collectedMain.changed.staged.total));
  assert.equal(mainCounts.querySelector('[data-stage="unstaged"]').dataset.count, String(collectedMain.changed.unstaged.total));
  assert.equal(mainCounts.querySelector('[data-stage="untracked"]').dataset.count, String(collectedMain.changed.untracked.total));
  assert.equal(mainCounts.querySelector('[data-stage="unmerged"]').dataset.count, String(collectedMain.changed.unmerged.total));
  assert.equal(mainCounts.querySelector('[data-stage="union"]').dataset.count, String(collectedMain.changed.union_total));
  assert.equal(collectedMain.changed.union_total, 4);
  assert.equal(classSum, 5, '2 staged + 2 unstaged + 1 untracked, with src/app.js in two classes');
  assert.ok(mainCounts.textContent.includes('one changed path in the union'));

  // Dirty-snapshot visualization: every changed path carries a stage status
  // chip; the unmerged-only-failed rule never paints other stages red.
  const paths = [...mainDetail.querySelectorAll('[data-testid="git-changed-paths"] .gm-path')];
  assert.ok(paths.length >= 5, 'each changed path renders as a row');
  for (const path of paths) {
    assert.ok(['staged', 'unstaged', 'untracked', 'unmerged'].includes(path.dataset.stage));
    assert.equal(path.querySelectorAll('.status').length, 1, 'one stage chip per path');
    assert.equal(path.querySelector('.status').dataset.state, path.dataset.stage === 'unmerged' ? 'failed' : path.dataset.stage === 'staged' ? 'active' : 'neutral');
  }
  const stagedPath = paths.find(node => node.dataset.stage === 'staged');
  assert.ok(stagedPath.textContent.includes('docs/requirements-v2.md (renamed from docs/requirements.md)'), 'renames render their from-path');

  // Selecting the linked worktree swaps the detail (master-detail).
  view.selectWorktree(linkedCard.dataset.worktreeId);
  detail = view.element.querySelector('[data-testid="git-pane"] [data-testid="git-detail"]');
  const linkedCounts = detail.querySelector('[data-testid="git-union-counts"]');
  assert.equal(linkedCounts.querySelector('[data-stage="union"]').dataset.count, '3');
  assert.equal(view.element.querySelector('.git-worktree[aria-pressed="true"]').dataset.worktreeId, linkedCard.dataset.worktreeId);
  view.selectWorktree(mainCard.dataset.worktreeId);

  // Uncommitted changes are explicit uncommitted snapshots, never commits.
  assert.equal(view.element.querySelectorAll('[data-testid="git-uncommitted-snapshot"][data-snapshot-kind="uncommitted-snapshot"]').length, 1,
    'exactly the selected worktree renders its snapshot detail');

  // --- The commit table: real parent OIDs, merge badge, dirty chips. ---
  view.setGitMode('commits');
  const commitRows = [...paneOf(view).querySelectorAll('[data-testid="git-commit-table"] [data-parent-count]')];
  assert.ok(commitRows.length >= 3);
  for (const row of commitRows) assert.match(row.dataset.commitOid, /^[0-9a-f]{40}$/);
  assert.equal(commitRows.length, localBefore.commits.observed.length);
  assert.ok(commitRows.every(row => !/uncommitted/i.test([...row.children][1].children[0].children[0].textContent)),
    'no fabricated uncommitted commit in the subject column (the dirty chip is annotation, not subject)');
  const mergeRow = commitRowOf(paneOf(view), headOid);
  assert.equal(mergeRow.dataset.isMerge, 'true');
  assert.equal(mergeRow.dataset.parentCount, '2');
  const expectedParents = git(['rev-parse', 'HEAD^1', 'HEAD^2'], fixture.root).split('\n').map(value => value.trim()).filter(Boolean);
  assert.deepEqual([...mergeRow.querySelectorAll('.git-parent-oid')].map(node => node.dataset.parentOid), expectedParents);
  assert.ok(mergeRow.querySelector('[data-testid="git-merge-badge"]').textContent.includes('2 parents'));
  // Dirty-snapshot chip: the HEAD commit of the dirty main worktree carries
  // an explicit attention chip — a snapshot on top, never a commit itself.
  const dirtyChip = mergeRow.querySelector('[data-testid="commit-dirty-chip"]');
  assert.ok(dirtyChip, 'the merge row (current HEAD) carries the dirty-snapshot chip');
  assert.equal(dirtyChip.dataset.snapshotKind, 'uncommitted-snapshot');
  assert.ok(dirtyChip.textContent.includes('4 uncommitted paths'), dirtyChip.textContent);
  assert.ok(dirtyChip.textContent.includes('not a commit'));
  const cleanRow = commitRows.find(row => row.dataset.commitOid !== headOid);
  assert.equal(cleanRow.querySelector('[data-testid="commit-dirty-chip"]'), null, 'commits without uncommitted work carry no dirty chip');
  // Commit detail (master-detail): source timestamps stay separate from the
  // collector observation time.
  view.selectCommit(headOid);
  const commitDetail = paneOf(view).querySelector('[data-testid="git-commit-detail"]');
  assert.equal(commitDetail.dataset.commitOid, headOid);
  assert.deepEqual([...commitDetail.querySelectorAll('.git-parent-oid')].map(node => node.dataset.parentOid), expectedParents);
  assert.ok(commitDetail.textContent.includes('observed by collector'), 'collector observation time stays separate from source timestamps');
  assert.ok(commitDetail.textContent.includes('observation time is not a commit timestamp'));

  // The read-only dirty-content binding is surfaced with its digest.
  view.setGitMode('worktrees');
  const binding = view.element.querySelector('[data-testid="git-pane"] [data-testid="git-dirty-binding"]');
  assert.equal(binding.dataset.readOnly, 'true');
  assert.equal(binding.dataset.headOid, headOid);
  assert.match(binding.dataset.digest, /^[a-f0-9]{64}$/);
  assert.ok(binding.textContent.includes('same HEAD plus a changed relevant path stales affected proof'));
  assert.ok(binding.textContent.includes('branch rename does not'));

  // Advisory overlap is listed but never an actual Git conflict.
  const conflicts = view.element.querySelector('[data-testid="git-pane"] [data-testid="git-conflicts"]');
  assert.equal(conflicts.querySelectorAll('[data-conflict-kind]').length, 4);
  assert.ok(conflicts.querySelector('[data-conflict-kind="concurrent-edit-overlap"]').textContent.includes('README.md'));
  assert.ok(conflicts.querySelector('[data-conflict-kind="concurrent-edit-overlap"]').textContent.includes('advisory'));
  assert.ok(conflicts.querySelector('[data-conflict-kind="actual-unmerged-index"]').textContent.includes('exact zero'));
  assert.ok(conflicts.querySelector('[data-conflict-kind="predicted-merge-conflict"]').textContent.includes('MERGE_SIMULATION_EXCLUDED'));

  // --- PR/CI subjects when observed: head/base/tested-subject separate. ---
  const prSection = view.element.querySelector('[data-testid="git-pane"] [data-testid="git-pull-requests"]');
  assert.equal(prSection.dataset.remoteStatus, 'observed');
  const prCard = prSection.querySelector('[data-pr-number="47"]');
  const subjects = [...prCard.querySelectorAll('.gm-pr-field')].map(node => node.dataset.subject);
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
  assert.ok(prSection.querySelector('[data-testid="coverage-chip"]').textContent.includes('1 of'), 'PR coverage chip renders');

  // --- The four §8.1 fixtures render the exact numbers in designed tables. ---
  const elapsed = metricRowOf(metricsPane, 'metric:time:elapsed');
  const wall = metricRowOf(metricsPane, 'metric:time:wall');
  const agent = metricRowOf(metricsPane, 'metric:time:agent');
  const peak = metricRowOf(metricsPane, 'metric:time:peak');
  assert.ok(elapsed && wall && agent && peak, 'every time metric renders a table row');
  assert.equal(elapsed.button.textContent, 'Elapsed run time');
  assert.equal(elapsed.cells[1].textContent, '30');
  assert.equal(elapsed.cells[2].textContent, 'minutes');
  assert.equal(wall.cells[1].textContent, '20');
  assert.equal(agent.cells[1].textContent, '25');
  assert.equal(peak.cells[1].textContent, '2');
  assert.equal(peak.cells[2].textContent, 'agents');
  // Tabular numerals ride the numeric column contract of the T12 dataTable.
  for (const entry of [elapsed, wall, agent, peak]) {
    assert.equal(entry.cells[1].dataset.numeric, 'true', 'value cells are numeric columns');
  }

  const coverage = metricRowOf(metricsPane, 'metric:usage:coverage');
  assert.ok(coverage, 'the coverage metric renders a table row');
  assert.ok(coverage.button.textContent.includes('Reported request coverage'));
  assert.equal(coverage.cells[1].textContent, '7');
  const coverageChips = coverage.cells[3].querySelectorAll('[data-testid="coverage-chip"]');
  assert.equal(coverageChips.length, 1);
  assert.equal(coverageChips[0].textContent, '7 of 10 reported');
  assert.equal(metricRowOf(metricsPane, 'metric:usage:total_tokens').cells[1].textContent, '28');

  // --- Compact bar visualization: same-unit scales only, reported values only. ---
  const bars = metricsPane.querySelector('[data-testid="metric-bars"]');
  assert.ok(bars, 'the bar chart renders');
  const minutesGroup = bars.querySelector('[data-unit="minutes"]');
  assert.ok(minutesGroup, 'minutes metrics share one scale');
  assert.equal(minutesGroup.dataset.scale, '30', 'the scale is the largest reported value');
  const elapsedBar = minutesGroup.querySelector('[data-metric-id="metric:time:elapsed"] .gm-bar-fill');
  assert.ok(elapsedBar.getAttribute('style').includes('inline-size: 100%'), 'the largest value fills the track');
  const wallBar = minutesGroup.querySelector('[data-metric-id="metric:time:wall"] .gm-bar-fill');
  assert.ok(wallBar.getAttribute('style').includes('inline-size: 66'), 'wall time is 2/3 of elapsed');
  assert.ok(!bars.querySelector('[data-unit="tokens"] [data-metric-id="metric:time:wall"]'),
    'minutes never scale against tokens');
  const agentsGroup = bars.querySelector('[data-unit="agents"]');
  assert.ok(agentsGroup, 'agent counts share their own scale, separate from minutes');

  // --- Contributing-records drill-down opens IN THE DOCK. ---
  assert.equal(view.isRecordsOpen(), false, 'the dock starts closed');
  const dock = view.element.querySelector('[data-testid="metrics-dock"]');
  assert.equal(dock.hidden, true, 'the dock element is hidden before a total opens it');
  view.openMetric('metric:usage:coverage');
  assert.equal(view.isRecordsOpen(), true, 'opening a total opens the dock');
  assert.equal(dock.hidden, false);
  const recordsPanel = dock.querySelector('[data-testid="metrics-records"]');
  assert.ok(recordsPanel.textContent.includes('usage reported for 7 of 10 recorded requests'));
  assert.ok(recordsPanel.textContent.includes('the totals cover only the reporting requests'));

  // Regression (T18-R1, verifier F1): the totals drill-down lists exactly the
  // requests that reported the field — a recorded request with no usage stays
  // in the coverage denominator, never in the totals' contributing records.
  view.openMetric('metric:usage:total_tokens');
  const totalsRecords = [...recordsPanel.querySelectorAll('[data-record-id]')].map(node => node.dataset.recordId);
  const reporting = usageCoverage.requests.filter(request => request.usage.total_tokens !== undefined);
  assert.deepEqual(totalsRecords,
    [...reporting.map(request => request.request_id), ...reporting.flatMap(request => request.source_record_ids)],
    'the dock lists only the reporting requests and their source records, in model order');
  assert.deepEqual(totalsRecords, ['req:0', 'req:1', 'req:2', 'req:3', 'req:4', 'req:5', 'req:6',
    'd0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6']);
  for (const id of ['req:7', 'req:8', 'req:9', 'd7', 'd8', 'd9']) {
    assert.equal(recordsPanel.querySelector(`[data-record-id="${id}"]`), null,
      `non-reporting ${id} never lists as a contributing record of the totals`);
  }

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
  assert.equal(metricRowOf(subsetsPane, 'metric:usage:subsets:input').cells[1].textContent, '100');
  assert.equal(metricRowOf(subsetsPane, 'metric:usage:subsets:total').cells[1].textContent, '150');
  viewSubsets.openMetric('metric:usage:subsets:input');
  const subsetPanel = viewSubsets.element.querySelector('[data-testid="metrics-dock"] [data-testid="metrics-records"]');
  assert.ok(subsetPanel.textContent.includes('cached 40 is a subset of the 100 total'));
  assert.ok(subsetPanel.textContent.includes('never added again'));
  assert.ok(!subsetsPane.textContent.includes('210'), 'the subset total is 150, never 210');

  const metricsCumulative = metricsDetailModel({ ...metricsContext,
    accounting: { time: timeResult, usage: usageCumulative }, git: gitModel });
  const viewCumulative = createGitMetricsView({ git: gitModel, metrics: metricsCumulative });
  const cumulativePane = viewCumulative.element.querySelector('[data-testid="metrics-pane"]');
  assert.equal(metricRowOf(cumulativePane, 'metric:usage:total_tokens').cells[1].textContent, '100');
  viewCumulative.openMetric('metric:usage:total_tokens');
  // The contributing records are exactly T10's own attribution: the superseded
  // snapshot r1-s1 (40) is not a contributor to the final total of 100.
  const contributing = usageCumulative.requests.flatMap(request => request.source_record_ids);
  assert.deepEqual(contributing, ['r1-s2', 'r1-final', 'r2-d1']);
  for (const record of contributing) {
    assert.ok(viewCumulative.element.querySelector(`[data-testid="metrics-dock"] [data-record-id="${record}"]`),
      `the cumulative total opens its contributing record ${record}`);
  }
  assert.equal(viewCumulative.element.querySelector('[data-testid="metrics-dock"] [data-record-id="r1-s1"]'), null,
    'the superseded snapshot is not attributed to the displayed total');

  // --- Selection, open drill-down and keyboard interaction. ---
  view.setGitMode('worktrees');
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
  assert.equal(update.gitModePreserved, true, 'the git mode survives the polling update');
  assert.equal(view.element.querySelector('.git-worktree[aria-pressed="true"]').dataset.worktreeId, linkedId);
  const renamedCard = view.element.querySelector(`[data-worktree-id="${linkedId}"]`);
  assert.ok(renamedCard.textContent.includes('feature-new'), 'the renamed label renders');
  assert.equal(renamedCard.querySelector('[data-identity-kind="commit-identity"]').dataset.headOid, beforeLinked.head);
  view.selectWorktree(linkedId);
  const renamedCounts = view.element.querySelector('[data-testid="git-detail"] [data-testid="git-union-counts"]');
  assert.equal(renamedCounts.querySelector('[data-stage="union"]').dataset.count, '3', 'no invented change from the rename');
  view.setGitMode('commits');
  assert.equal(view.element.querySelectorAll('[data-testid="git-commit-table"] [data-parent-count]').length, commitRows.length, 'the rename invents no commit');
  view.setGitMode('worktrees');
  view.selectWorktree(linkedId);
  assert.equal(view.element.querySelector('[data-testid="git-detail"] [data-testid="git-dirty-binding"]').dataset.digest, beforeLinked.binding.digest);

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
  fixture.exported = { commits: commitRows.length, worktrees: cards.length };
});

test('the dock closes on Escape and returns focus to the total that opened it (audit IK-3)', async () => {
  const local = await collectLocalGitFacts({ repositoryRoot: fixture.root, sourceScope: SCOPE });
  const gitModel = gitDetailModel({ local, observationIds: observationIdsFor(local) });
  const view = createGitMetricsView({ git: gitModel,
    metrics: metricsDetailModel({ scope: PROJECT_SCOPE, filters: [], window: WINDOW, asOf: AS_OF,
      projectionRevision: 41, accounting: { time: accountTime({ window_start: WINDOW.start, window_end: WINDOW.end, intervals: [] }) }, git: gitModel }) });
  const detach = installFocusSystem({ root: dom.document });
  try {
    // The view lives in the document, as on a real page — the dock's
    // focus-return lands on the connected invoking control.
    dom.document.body.append(view.element);
    const metric = view.element.querySelector('[data-metric-id="metric:time:elapsed"]');
    metric.focus();
    metric.click();
    assert.equal(view.isRecordsOpen(), true, 'clicking a total opens the dock');
    const dock = view.element.querySelector('[data-testid="metrics-dock"]');
    assert.equal(dock.hidden, false);
    assert.equal(dock.contains(dom.document.activeElement), true, 'focus moved into the dock');
    dom.document.dispatchEvent({ type: 'keydown', key: 'Escape', bubbles: true });
    assert.equal(view.isRecordsOpen(), false, 'Escape closes the dock through the T11 overlay stack');
    assert.equal(dock.hidden, true);
    assert.equal(dom.document.activeElement, metric, 'focus returns to the invoking total');
  } finally {
    view.element.remove();
    detach.detach();
  }
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
  assert.equal(prSection.querySelector('[data-testid="coverage-chip"]'), null,
    'no coverage chip is fabricated for an unavailable remote');

  // Unknown usage values (real T10 null totals) render unavailable, never zero.
  const unknownUsage = normalizeUsage([
    { id: 'u1', request_id: 'req:unknown', kind: 'delta', observed_at: '2026-10-06T12:00:00Z', usage: { total_tokens: null } },
  ]);
  assert.equal(unknownUsage.totals.total_tokens, null);
  const viewUnknown = createGitMetricsView({ git: gitModel,
    metrics: metricsDetailModel({ scope: PROJECT_SCOPE, filters: [], window: WINDOW, asOf: AS_OF,
      projectionRevision: 41, accounting: { usage: unknownUsage }, git: gitModel }) });
  const unknownPane = viewUnknown.element.querySelector('[data-testid="metrics-pane"]');
  const unknownRow = metricRowOf(unknownPane, 'metric:usage:total_tokens');
  assert.equal(unknownRow.button.dataset.unavailable, 'true');
  assert.equal(unknownRow.button.dataset.value, '');
  assert.equal(unknownRow.cells[1].textContent, '—', 'the unavailable value is a dash, never a 0');
  assert.ok(unknownRow.cells[3].querySelector('[data-testid="coverage-chip"][data-unavailable="true"]'),
    'the unavailable coverage chip renders');
  assert.ok(!unknownRow.row.textContent.includes('0 tokens'), 'an unknown total never renders as zero');
  // The bar visualization refuses to draw an unavailable total as a bar.
  const unknownBar = unknownPane.querySelector('[data-testid="metric-bars"] [data-metric-id="metric:usage:total_tokens"]');
  assert.ok(unknownBar, 'the unavailable total still renders a bar row (explicit)');
  assert.equal(unknownBar.dataset.unavailable, 'true');
  assert.equal(unknownBar.querySelector('.gm-bar-fill'), null, 'no fill is fabricated for an unavailable total');
  assert.equal(unknownBar.querySelector('.gm-bar-track').dataset.unavailable, 'true', 'the track is hollow and dashed');
  assert.ok(unknownBar.textContent.includes('unavailable'));

  // An explicit reported zero stays a labeled reported zero, distinct from unknown.
  const reportedZeroUsage = normalizeUsage([
    { id: 'z1', request_id: 'req:zero', kind: 'delta', observed_at: '2026-10-06T12:01:00Z', usage: { input_tokens: 0, total_tokens: 0 } },
  ]);
  assert.equal(reportedZeroUsage.totals.total_tokens, 0);
  const viewReportedZero = createGitMetricsView({ git: gitModel,
    metrics: metricsDetailModel({ scope: PROJECT_SCOPE, filters: [], window: WINDOW, asOf: AS_OF,
      projectionRevision: 41, accounting: { usage: reportedZeroUsage }, git: gitModel }) });
  const reportedZeroPane = viewReportedZero.element.querySelector('[data-testid="metrics-pane"]');
  const reportedZeroRow = metricRowOf(reportedZeroPane, 'metric:usage:total_tokens');
  assert.equal(reportedZeroRow.button.dataset.zeroReported, 'true');
  assert.equal(reportedZeroRow.cells[1].textContent, '0');
  assert.ok(reportedZeroRow.cells[3].querySelector('[data-testid="coverage-chip"][data-zero-reported="true"]'),
    'a reported zero carries its labeled chip');
  const zeroBarFill = reportedZeroPane.querySelector('[data-testid="metric-bars"] [data-metric-id="metric:usage:total_tokens"] .gm-bar-fill');
  assert.ok(zeroBarFill, 'a reported zero may render a bar');
  assert.ok(zeroBarFill.getAttribute('style').includes('inline-size: 2%'), 'at the honest minimum width, not zero-invisible');
  assert.equal(zeroBarFill.dataset.state, 'zero');

  // A reported zero renders as a labeled reported zero, distinct from unknown.
  const timeZero = accountTime({ window_start: '2026-10-06T12:00:00Z', window_end: '2026-10-06T12:01:00Z', intervals: [] });
  const viewZero = createGitMetricsView({ git: gitModel,
    metrics: metricsDetailModel({ scope: PROJECT_SCOPE, filters: [], window: WINDOW, asOf: AS_OF,
      projectionRevision: 41, accounting: { time: timeZero }, git: gitModel }) });
  const zeroPane = viewZero.element.querySelector('[data-testid="metrics-pane"]');
  const zeroWall = metricRowOf(zeroPane, 'metric:time:wall');
  assert.equal(zeroWall.button.dataset.zeroReported, 'true');
  assert.equal(zeroWall.button.dataset.unavailable === 'true', false);
  assert.equal(zeroWall.cells[1].textContent, '0');
  viewZero.openMetric('metric:time:wall');
  assert.ok(viewZero.element.querySelector('[data-testid="metrics-dock"] [data-testid="metrics-records"]').textContent.includes('no intervals recorded'));

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
    const changedRow = metricRowOf(viewUnavailable.element, 'metric:git:changed-paths');
    assert.equal(changedRow.button.dataset.unavailable, 'true', 'an unavailable collector is not a zero-changed-paths project');
    assert.ok(!changedRow.row.textContent.includes('0 paths'));
    // The lead sentence states unavailability instead of a healthy summary.
    assert.ok(viewUnavailable.element.querySelector('[data-testid="git-metrics-lead"]').textContent.includes('unavailable'));
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

test('adversarial (stale_state class): selections and the dock reset cleanly when the next model drops them', async () => {
  const local = await collectLocalGitFacts({ repositoryRoot: fixture.root, sourceScope: SCOPE });
  const gitModel = gitDetailModel({ local, observationIds: observationIdsFor(local) });
  const withUsage = metricsDetailModel({ scope: PROJECT_SCOPE, filters: [], window: WINDOW, asOf: AS_OF,
    projectionRevision: 41, accounting: { time: accountTime({ window_start: WINDOW.start, window_end: WINDOW.end, intervals: [] }) }, git: gitModel });
  const view = createGitMetricsView({ git: gitModel, metrics: withUsage });
  const linked = gitModel.worktrees.find(worktree => worktree.kind === 'linked');
  view.selectWorktree(linked.id);
  view.openMetric('metric:time:elapsed');
  assert.equal(view.isRecordsOpen(), true);

  // First stale shape: the next collection has NO linked worktree and NO time
  // accounting result. The worktree selection must drop; the elapsed metric
  // still exists (as a typed-unavailable projection), so its drill-down stays
  // open and honest about the drop — it never renders the stale value.
  const shrunkGit = structuredClone(gitModel);
  shrunkGit.worktrees = shrunkGit.worktrees.filter(worktree => worktree.kind !== 'linked');
  const unprojectedMetrics = metricsDetailModel({ scope: PROJECT_SCOPE, filters: [], window: WINDOW, asOf: AS_OF,
    projectionRevision: 42, accounting: {}, git: shrunkGit });
  const update = view.applyUpdate(shrunkGit, unprojectedMetrics);
  assert.equal(update.selectedPreserved, false, 'the dropped worktree selection is reported');
  assert.equal(view.getStats().selectedWorktreeId, null, 'the dropped worktree selection resets');
  assert.equal(view.getStats().openMetricId, 'metric:time:elapsed', 'the metric id survives — it is projected as unavailable');
  assert.equal(view.isRecordsOpen(), true, 'the dock stays open on the now-unavailable metric');
  const staleElapsed = metricRowOf(view.element, 'metric:time:elapsed');
  assert.ok(staleElapsed, 'the metric still renders');
  assert.equal(staleElapsed.button.dataset.unavailable, 'true', 'the dropped accounting renders unavailable, not stale-zero');
  assert.equal(staleElapsed.button.dataset.value, '', 'no stale value lingers in the dataset');
  assert.equal(staleElapsed.cells[1].textContent, '—');
  const dockRecords = view.element.querySelector('[data-testid="metrics-dock"] [data-testid="metrics-records"]');
  assert.ok(dockRecords.textContent.includes('unavailable — not projected'), 'the open drill-down states the drop');
  assert.equal(view.element.querySelector('.git-worktree[aria-pressed="true"]'), null, 'no stale pressed card remains');
  // The view still renders coherently for the surviving worktree.
  assert.equal(view.element.querySelectorAll('.git-worktree').length, 1);
  assert.ok(view.element.querySelector('[data-testid="git-detail"] [data-testid="git-worktree-detail"]'));

  // Second stale shape: a projection revision that drops the whole time
  // section. The open drill-down's metric no longer exists at all — the
  // selection resets and the dock closes.
  const sectionlessMetrics = structuredClone(withUsage);
  sectionlessMetrics.sections = sectionlessMetrics.sections.filter(section => section.id !== 'metrics:time');
  view.applyUpdate(structuredClone(gitModel), sectionlessMetrics);
  assert.equal(view.getStats().openMetricId, null, 'the dropped metric drill-down resets');
  assert.equal(view.isRecordsOpen(), false, 'the dock closes when its metric disappears');
});
