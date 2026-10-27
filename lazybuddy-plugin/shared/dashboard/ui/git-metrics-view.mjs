// T18 Git and metrics detail redesign — a master-detail composition over the
// recorded T11 git-observation results and T10 accounting outputs, built from
// the T12 component library (segmentedControl, dataTable, metric coverage
// chips, compact CSS bars, createDockPanel) for the T12b shell. Structure:
//   Git pane      segmented Worktrees|Commits master list + detail column;
//                 the worktree detail is the dirty-snapshot visualization
//                 (per-stage status chips per changed path); the commits
//                 master is a data table with real parent OIDs and
//                 dirty-snapshot chips on commits carrying uncommitted work.
//   Metrics pane  designed data tables (tabular numerals) + compact bar
//                 visualization per same-unit group; unavailable totals stay
//                 hollow and explicit, never zero-as-healthy.
// Every displayed total opens its contributing records and its exact §8
// fields in the dock (Escape closes it; focus returns to the invoker).
// Honesty invariants (spec §8/§8.1/§9): branch labels stay moving labels
// distinct from immutable commit identity; uncommitted changes render as an
// explicit uncommitted snapshot, never a fabricated commit; staged/unstaged/
// untracked/unmerged union counting shows next to the per-class counts; PR
// head, base, tested subject, test-merge SHA and checks stay separate
// subjects; unknown stays typed-unavailable — nothing renders as zero or
// healthy unless it was reported as such. Git stages and time/token
// accounting never share a section. Read-only projection: no commands, no
// collector runs, no scheduler authority.
import {
  button, element, statusChip, segmentedControl, dataTable, createDockPanel,
} from './components.mjs';
import { formatMinutes } from './git-metrics-model.mjs';

const UNION_NOTE = 'staged+unstaged changes to one path count as one changed path in the union';
const GIT_MODES = Object.freeze(['worktrees', 'commits']);

function captureChip(capture) {
  if (capture == null) return null;
  if (capture.stable === true) return statusChip({ state: 'neutral', label: 'capture stable' });
  if (capture.stable === false) return statusChip({ state: 'attention', label: 'capture unstable — cannot establish a clean verified result' });
  return statusChip({ state: 'unavailable', label: 'capture stability unknown' });
}

function countsRow(counts, note = true) {
  const row = element('div', 'cluster gm-counts');
  row.dataset.testid = 'git-union-counts';
  const entries = [['staged', counts.staged], ['unstaged', counts.unstaged], ['untracked', counts.untracked],
    ['unmerged', counts.unmerged]];
  for (const [name, count] of entries) {
    const item = element('span', 'cluster gm-count');
    item.dataset.stage = name;
    item.dataset.count = String(count);
    item.dataset.numeric = 'true';
    item.append(element('span', 'meta', `${name} ${count}`));
    row.append(item);
  }
  const union = element('span', 'cluster gm-count gm-count-union');
  union.dataset.stage = 'union';
  union.dataset.count = String(counts.union);
  union.dataset.numeric = 'true';
  union.append(element('strong', '', `union changed paths ${counts.union}`));
  row.append(union);
  if (counts.truncated) row.append(statusChip({ state: 'attention', label: 'path lists truncated — counts exact' }));
  if (note) row.append(element('span', 'meta', UNION_NOTE));
  return row;
}

// Dirty-snapshot visualization: one status chip per changed path carrying its
// stage class. Unmerged is the only failed state (a real Git conflict); the
// other stages are factual labels, not health claims.
function stageChip(stage) {
  const state = stage === 'unmerged' ? 'failed' : stage === 'staged' ? 'active' : 'neutral';
  return statusChip({ state, label: stage });
}

function worktreeListItem(worktree, state) {
  const control = button('', () => state.onSelectWorktree(worktree.id));
  control.className = `git-worktree${worktree.current ? ' git-worktree-current' : ''}`;
  control.dataset.worktreeId = worktree.id;
  control.dataset.kind = worktree.kind;
  control.dataset.current = String(worktree.current);
  control.setAttribute('aria-pressed', String(state.selectedWorktreeId === worktree.id));
  control.setAttribute('aria-label', `${worktree.kind} worktree ${worktree.root}`);
  const head = element('span', 'cluster gm-worktree-head');
  const kindChip = statusChip({ state: worktree.current ? 'active' : 'neutral',
    label: `${worktree.kind}${worktree.current ? ' · current' : ''}` });
  kindChip.dataset.testid = 'git-worktree-kind';
  head.append(kindChip);
  // Branch label (moving) and commit identity (immutable) render as separate
  // fields with distinct labels — never conflated.
  if (worktree.branch != null) {
    const label = element('span', 'cluster gm-identity');
    label.dataset.identityKind = 'branch-label';
    label.append(element('span', 'meta', 'branch (moving label)'), element('code', '', worktree.branch));
    head.append(label);
  }
  if (worktree.detached) head.append(statusChip({ state: 'attention', label: 'detached HEAD — no branch label' }));
  if (worktree.bare) head.append(statusChip({ state: 'neutral', label: 'bare worktree' }));
  const identity = element('span', 'cluster gm-identity');
  identity.dataset.identityKind = 'commit-identity';
  identity.append(element('span', 'meta', 'HEAD (commit identity, immutable)'),
    element('code', '', worktree.headShort || worktree.head || 'none'));
  identity.dataset.headOid = worktree.head ?? '';
  head.append(identity);
  control.append(head);
  const facts = element('span', 'meta gm-worktree-facts');
  facts.append(element('code', '', worktree.root));
  control.append(facts);
  if (worktree.status !== 'observed') {
    const unavailable = element('span', 'cluster');
    unavailable.dataset.testid = 'git-worktree-unavailable';
    unavailable.append(statusChip({ state: 'unavailable', label: `worktree facts unavailable: ${worktree.unavailableReason}` }));
    control.append(unavailable);
    return control;
  }
  const counts = worktree.uncommitted.counts;
  const summary = element('span', 'cluster gm-worktree-counts');
  const unionBadge = element('span', 'cluster gm-count-union');
  unionBadge.dataset.stage = 'union';
  unionBadge.dataset.count = String(counts?.union ?? 'unknown');
  if (counts == null) summary.append(statusChip({ state: 'unavailable', label: 'changed-path counts unavailable' }));
  else {
    unionBadge.append(counts.union > 0
      ? statusChip({ state: 'attention', label: `${counts.union} uncommitted changed paths` })
      : statusChip({ state: 'neutral', label: 'no changed paths (exact zero)' }));
    summary.append(unionBadge, element('span', 'meta', `staged ${counts.staged} · unstaged ${counts.unstaged} · untracked ${counts.untracked} · unmerged ${counts.unmerged}`));
  }
  control.append(summary);
  if (worktree.upstream != null) {
    control.append(element('span', 'meta', `upstream ${worktree.upstream}`
      + `${worktree.ahead != null ? ` · ahead ${worktree.ahead}` : ''}${worktree.behind != null ? ` · behind ${worktree.behind}` : ''}`));
  }
  return control;
}

function worktreeDetail(worktree) {
  const detail = element('div', 'stack gm-detail-panel');
  detail.dataset.testid = 'git-worktree-detail';
  detail.dataset.worktreeId = worktree.id;
  detail.dataset.detailKind = 'worktree';
  const title = element('h4', '', 'Worktree detail');
  title.dataset.testid = 'git-worktrees-heading';
  detail.append(title, element('code', 'gm-detail-root', worktree.root));
  if (worktree.status !== 'observed') {
    const unavailable = element('span', 'cluster');
    unavailable.dataset.testid = 'git-worktree-unavailable';
    unavailable.append(statusChip({ state: 'unavailable', label: `worktree facts unavailable: ${worktree.unavailableReason}` }));
    detail.append(unavailable);
    return detail;
  }
  // Uncommitted changes: an explicit uncommitted snapshot, never a commit.
  const snapshot = element('div', 'stack gm-snapshot');
  snapshot.dataset.testid = 'git-uncommitted-snapshot';
  snapshot.dataset.snapshotKind = worktree.uncommitted.snapshotKind;
  const snapshotHead = element('span', 'cluster');
  snapshotHead.append(statusChip({ state: worktree.uncommitted.counts?.union > 0 ? 'attention' : 'neutral',
    label: worktree.uncommitted.counts?.union > 0 ? 'uncommitted changes' : 'no changed paths (exact zero)' }));
  if (worktree.recordId) snapshotHead.append(element('span', 'meta', `observation record ${worktree.recordId}`));
  snapshot.append(snapshotHead);
  snapshot.append(countsRow(worktree.uncommitted.counts));
  const pathList = element('ul', 'gm-path-list');
  pathList.dataset.testid = 'git-changed-paths';
  const classList = [['staged', worktree.uncommitted.staged, entry => entry.rename_from ? `${entry.path} (renamed from ${entry.rename_from})` : entry.path],
    ['unstaged', worktree.uncommitted.unstaged, entry => entry.path],
    ['untracked', worktree.uncommitted.untracked, entry => entry],
    ['unmerged', worktree.uncommitted.unmerged, entry => `${entry.path} (${entry.xy})`]];
  for (const [stage, entries, labelOf] of classList) {
    for (const entry of entries) {
      const item = element('li', 'gm-path');
      item.dataset.stage = stage;
      item.dataset.path = labelOf(entry);
      item.append(stageChip(stage), element('code', '', labelOf(entry)));
      pathList.append(item);
    }
  }
  snapshot.append(pathList);
  snapshot.append(element('span', 'meta', worktree.uncommitted.note));
  if (worktree.uncommitted.binaryPaths.length) {
    const binary = element('span', 'cluster');
    binary.append(statusChip({ state: 'unavailable', label: 'binary diff line counts unavailable' }),
      element('span', 'meta', worktree.uncommitted.binaryPaths.join(', ')));
    snapshot.append(binary);
  }
  detail.append(snapshot);
  // Read-only dirty-content binding: the content-revision binding that lets
  // same-HEAD edits stale proof. Surfaced, never editable here.
  if (worktree.binding) {
    const binding = element('div', 'stack gm-binding');
    binding.dataset.testid = 'git-dirty-binding';
    binding.dataset.readOnly = 'true';
    binding.dataset.headOid = worktree.binding.headOid ?? '';
    binding.dataset.digest = worktree.binding.digest;
    const bindingHead = element('span', 'cluster');
    bindingHead.append(statusChip({ state: 'neutral', label: 'dirty-content binding · read-only' }),
      element('span', 'meta', `digest ${worktree.binding.digestShort}…`));
    binding.append(bindingHead);
    const relevant = element('ul', 'gm-path-list');
    for (const entry of worktree.binding.relevantChangedPaths) {
      const item = element('li', 'gm-path');
      item.dataset.path = entry.path;
      item.append(element('span', 'meta', `relevant (${entry.classes.join('+')}): `), element('code', '', entry.path));
      relevant.append(item);
    }
    binding.append(relevant);
    binding.append(element('span', 'meta',
      `scope ${worktree.binding.sourceScope.join(', ')} · unrelated changed paths ${worktree.binding.unrelatedChangedPathCount} · ${worktree.binding.staleRule}`));
    detail.append(binding);
  }
  return detail;
}

// Commits carrying uncommitted work on top (their worktree HEAD has a dirty
// snapshot) get an explicit attention chip: the snapshot is NOT a commit.
function dirtyChipForCommit(commit, worktrees) {
  const carrier = worktrees.find(worktree => worktree.status === 'observed'
    && worktree.head === commit.oid && worktree.uncommitted.counts?.union > 0);
  if (!carrier) return null;
  const chip = statusChip({ state: 'attention',
    label: `+${carrier.uncommitted.counts.union} uncommitted paths — snapshot on top of this commit, not a commit` });
  chip.dataset.testid = 'commit-dirty-chip';
  chip.dataset.snapshotKind = 'uncommitted-snapshot';
  return chip;
}

function commitTable(git, state) {
  const wrap = element('section', 'stack gm-commits');
  wrap.dataset.testid = 'git-commits';
  wrap.append(element('h4', '', 'Commits (real parent OIDs)'));
  if (git.commits.status !== 'observed') {
    const unavailable = element('span', 'cluster');
    unavailable.dataset.testid = 'git-commits-unavailable';
    unavailable.append(statusChip({ state: 'unavailable', label: `commit history unavailable: ${git.commits.reason}` }));
    wrap.append(unavailable);
    return wrap;
  }
  const columns = [
    { key: 'commit', label: 'Commit' },
    { key: 'subject', label: 'Subject' },
    { key: 'parents', label: 'Parents' },
    { key: 'observed', label: 'Authored / committed', numeric: true },
  ];
  const rows = git.commits.list.map(commit => {
    const open = button(commit.oidShort || commit.oid, () => state.onSelectCommit(commit.oid));
    open.className = 'git-commit-open';
    open.dataset.commitOid = commit.oid;
    open.setAttribute('aria-pressed', String(state.selectedCommitOid === commit.oid));
    open.setAttribute('aria-label', `commit ${commit.oidShort} ${commit.subject} — open commit detail`);
    const subjectCell = element('span', 'stack gm-commit-subject');
    subjectCell.append(element('span', '', commit.subject));
    const dirtyChip = dirtyChipForCommit(commit, git.worktrees);
    if (dirtyChip) subjectCell.append(dirtyChip);
    const parentsCell = element('span', 'cluster gm-parents');
    if (!commit.parentOids.length) parentsCell.append(element('span', 'meta', 'none (root commit)'));
    if (commit.isMerge) {
      const badge = statusChip({ state: 'active', label: `merge · ${commit.parentCount} parents` });
      badge.dataset.testid = 'git-merge-badge';
      parentsCell.append(badge);
    }
    for (const parent of commit.parentOids) {
      const parentCode = element('code', 'git-parent-oid', parent.slice(0, 10));
      parentCode.dataset.parentOid = parent;
      parentsCell.append(parentCode);
    }
    // Source timestamps stay separate from the collector observation time.
    const observedCell = element('span', 'gm-commit-times');
    observedCell.dataset.numeric = 'true';
    observedCell.append(element('span', 'meta', `authored ${commit.authorAt}`), element('span', 'meta', `committed ${commit.committerAt}`));
    return { commit: open, subject: subjectCell, parents: parentsCell, observed: observedCell };
  });
  const table = dataTable({ columns, rows, testid: 'git-commit-table',
    caption: 'Commit history as observed — each row opens its detail; collector observation time is separate from the source timestamps.' });
  // Row-level identity for selection and keyboard traversal.
  const rowNodes = [...table.querySelectorAll('tbody tr')];
  for (let index = 0; index < rowNodes.length; index += 1) {
    const commit = git.commits.list[index];
    rowNodes[index].dataset.commitOid = commit.oid;
    rowNodes[index].dataset.parentCount = String(commit.parentCount);
    rowNodes[index].dataset.isMerge = String(commit.isMerge);
    if (state.selectedCommitOid === commit.oid) rowNodes[index].dataset.selected = 'true';
  }
  wrap.append(table);
  const coverageLine = element('p', 'meta');
  coverageLine.dataset.testid = 'git-commits-coverage';
  const coverageText = git.commits.coverage
    ? `${git.commits.coverage.reported} of ${git.commits.coverage.total ?? 'unknown'} commits listed`
    : `${git.commits.list.length} commits listed`;
  coverageLine.append(document.createTextNode(`coverage: ${coverageText} · source timestamps are the commit's own; the collector observation time is separate`));
  wrap.append(coverageLine);
  return wrap;
}

function commitDetail(commit) {
  const detail = element('div', 'stack gm-detail-panel');
  detail.dataset.testid = 'git-commit-detail';
  detail.dataset.detailKind = 'commit';
  if (commit == null) {
    detail.append(emptyDetailPrompt('Select a commit row to open its immutable identity, real parent OIDs and timestamps.'));
    return detail;
  }
  detail.dataset.commitOid = commit.oid;
  detail.append(element('h4', '', 'Commit detail'));
  const oidLine = element('code', '', commit.oid);
  oidLine.dataset.testid = 'git-commit-oid';
  detail.append(oidLine, element('span', '', commit.subject));
  const parents = element('span', 'cluster gm-parents');
  parents.dataset.testid = 'commit-parents';
  parents.append(element('span', 'meta', 'parents:'));
  if (!commit.parentOids.length) parents.append(element('span', 'meta', 'none (root commit)'));
  for (const parent of commit.parentOids) {
    const parentCode = element('code', 'git-parent-oid', parent);
    parentCode.dataset.parentOid = parent;
    parents.append(parentCode);
  }
  detail.append(parents);
  detail.append(element('span', 'meta', `authored ${commit.authorAt} · committed ${commit.committerAt}`));
  detail.append(element('span', 'meta', `observed by collector ${commit.observedAt} — observation time is not a commit timestamp`));
  return detail;
}

function emptyDetailPrompt(text) {
  const prompt = element('div', 'stack gm-detail-empty');
  prompt.dataset.testid = 'git-detail-empty';
  prompt.append(element('span', 'meta', text));
  return prompt;
}

function prFieldRow(label, kind, ref, oid) {
  const line = element('span', 'cluster gm-pr-field');
  line.dataset.subject = kind;
  line.append(element('span', 'meta', label));
  if (ref != null || oid != null) {
    line.append(element('code', '', `${ref ?? 'ref unreported'} @ ${oid ?? 'oid unreported'}`));
  } else {
    const chip = statusChip({ state: 'unavailable', label: 'not observed' });
    chip.dataset.testid = 'git-pr-subject-unavailable';
    line.append(chip);
  }
  return line;
}

function prCard(pr) {
  const card = element('div', 'stack gm-pr');
  card.dataset.prNumber = String(pr.number);
  const head = element('span', 'cluster');
  head.append(element('strong', '', `#${pr.number}`), element('span', '', pr.title ?? 'title unreported'));
  if (pr.state != null) head.append(statusChip({ state: pr.state === 'OPEN' ? 'active' : 'neutral', label: String(pr.state).toLowerCase() }));
  if (pr.isDraft) head.append(statusChip({ state: 'neutral', label: 'draft' }));
  card.append(head);
  // Head, base and the tested subject stay separate fields (spec §9): a
  // test-merge SHA never becomes the PR head.
  card.append(prFieldRow('head', 'head', pr.head.ref, pr.head.oid),
    prFieldRow('base', 'base', pr.base.ref, pr.base.oid));
  const tested = element('span', 'cluster gm-pr-field');
  tested.dataset.subject = 'tested-subject';
  tested.append(element('span', 'meta', 'tested subject / SHA'),
    statusChip({ state: 'unavailable', label: `${pr.testedSubject.status} · ${pr.testedSubject.reason}` }));
  card.append(tested);
  const merge = element('span', 'cluster gm-pr-field');
  merge.dataset.subject = 'test-merge';
  merge.append(element('span', 'meta', 'test-merge SHA'),
    statusChip({ state: 'unavailable', label: `${pr.testMerge.status} · a test-merge SHA is never the PR head` }));
  card.append(merge);
  const checks = element('span', 'cluster gm-pr-field');
  checks.dataset.subject = 'checks';
  checks.append(element('span', 'meta', 'checks / workflow runs'),
    statusChip({ state: 'unavailable', label: `${pr.checks.status} · ${pr.checks.reason}` }));
  card.append(checks);
  card.append(element('span', 'meta', `observed ${pr.observedAt}`));
  return card;
}

function renderPullRequests(pullRequests) {
  const section = element('section', 'stack gm-pr-section');
  section.dataset.testid = 'git-pull-requests';
  section.dataset.remoteStatus = pullRequests.status;
  section.append(element('h4', '', 'Pull requests and CI'));
  if (pullRequests.status !== 'observed') {
    // Typed-unavailable, never "zero pull requests" and never healthy.
    const unavailable = element('span', 'cluster');
    unavailable.dataset.testid = 'git-pr-unavailable';
    unavailable.append(statusChip({ state: 'unavailable', label: `remote PR/CI observation unavailable: ${pullRequests.reason}` }));
    section.append(unavailable, element('span', 'meta', pullRequests.note));
    return section;
  }
  section.append(element('span', 'meta',
    `remote ${pullRequests.remote.host}/${pullRequests.remote.owner}/${pullRequests.remote.repo} · ${pullRequests.note}`));
  for (const pr of pullRequests.list) section.append(prCard(pr));
  if (pullRequests.coverage) {
    const chip = statusChip({ state: 'neutral', label: `coverage ${pullRequests.coverage.reported} of ${pullRequests.coverage.total ?? 'unknown'} listed` });
    chip.dataset.testid = 'coverage-chip';
    section.append(chip);
  }
  return section;
}

function renderConflicts(conflicts) {
  const section = element('section', 'stack gm-conflicts');
  section.dataset.testid = 'git-conflicts';
  section.append(element('h4', '', 'Issue classes (kept distinct)'));
  const row = (label, chip, detail) => {
    const line = element('span', 'cluster gm-conflict');
    line.append(chip, element('span', 'meta', detail));
    line.dataset.conflictKind = label;
    return line;
  };
  const actual = conflicts.actualUnmergedIndex;
  section.append(row('actual-unmerged-index',
    actual.paths.length ? statusChip({ state: 'failed', label: `actual unmerged index · ${actual.paths.length} path(s)` })
      : statusChip({ state: 'neutral', label: 'no unmerged index paths (exact zero)' }),
    'the only class that is a real Git conflict right now'));
  section.append(row('predicted-merge-conflict',
    statusChip({ state: 'unavailable', label: `predicted merge conflict · ${conflicts.predictedMergeConflict.reason}` }),
    'merge simulation is excluded in this release; path overlap alone can never become a red Git conflict'));
  section.append(row('concurrent-edit-overlap',
    statusChip({ state: conflicts.concurrentEditOverlap.overlaps.length ? 'attention' : 'neutral',
      label: `concurrent edit overlap · ${conflicts.concurrentEditOverlap.overlaps.length} path(s) · advisory · ${conflicts.concurrentEditOverlap.classification}` }),
    conflicts.concurrentEditOverlap.overlaps.length
      ? `shared dirty paths: ${conflicts.concurrentEditOverlap.overlaps.map(overlap => overlap.path).join(', ')}`
      : 'no shared dirty paths across worktrees'));
  section.append(row('semantic-plan-conflict',
    statusChip({ state: 'unavailable', label: `semantic plan conflict · owned by ${conflicts.semanticPlanConflict.ownedBy}` }),
    'assessed against baseline records by project reconciliation, not Git state'));
  return section;
}

function renderGitPane(git, state) {
  const pane = element('section', 'panel stack git-pane');
  pane.dataset.testid = 'git-pane';
  pane.append(element('h3', '', 'Git — worktrees, commits, uncommitted snapshots, PR/CI'));
  if (git.status !== 'observed') {
    const unavailable = element('span', 'cluster');
    unavailable.dataset.testid = 'git-facts-unavailable';
    unavailable.append(statusChip({ state: 'unavailable', label: `local Git facts unavailable: ${git.unavailableReason}` }));
    pane.append(unavailable, element('span', 'meta', 'Nothing is inferred from an unavailable collector; no zeros are displayed for it.'));
    return pane;
  }
  const context = element('p', 'meta');
  context.dataset.testid = 'git-context';
  context.append(document.createTextNode(`observed ${git.observedAt} by ${git.collector} · repository ${git.repository?.root ?? 'unknown'} · HEAD `));
  context.append(element('code', '', git.head ?? 'none'));
  const stability = captureChip(git.capture);
  if (stability) context.append(document.createTextNode(' · '), stability);
  pane.append(context);

  const modeSwitch = segmentedControl({
    label: 'Git view — worktrees or commits',
    options: [{ value: 'worktrees', label: 'Worktrees' }, { value: 'commits', label: 'Commits' }],
    current: state.gitMode,
    onChange: mode => state.onGitMode(mode),
  });
  modeSwitch.element.dataset.testid = 'git-mode-switch';
  pane.append(modeSwitch.element);

  const masterDetail = element('div', 'gm-master-detail');
  masterDetail.dataset.testid = 'git-master-detail';
  const master = element('div', 'stack gm-master');
  if (state.gitMode === 'worktrees') {
    const list = element('ul', 'git-worktree-list');
    list.dataset.testid = 'git-worktrees';
    list.dataset.nativeList = 'true';
    list.setAttribute('aria-label', 'Worktree selection — branch labels are moving labels; commit identity is immutable');
    for (const worktree of git.worktrees) {
      const item = element('li', '');
      item.append(worktreeListItem(worktree, state));
      list.append(item);
    }
    const heading = element('h4', 'gm-master-heading', 'Worktrees');
    heading.dataset.testid = 'git-worktrees-heading';
    master.append(heading, list,
      element('p', 'meta', 'Uncommitted changes render as an explicit uncommitted snapshot — never as a fabricated commit. Select a worktree to open its snapshot and the read-only dirty-content binding.'));
  } else {
    master.append(commitTable(git, state));
  }
  const detail = element('div', 'gm-git-detail');
  detail.dataset.testid = 'git-detail';
  if (state.gitMode === 'worktrees') {
    const selected = git.worktrees.find(worktree => worktree.id === state.selectedWorktreeId)
      ?? git.worktrees.find(worktree => worktree.current) ?? git.worktrees[0];
    detail.append(selected ? worktreeDetail(selected)
      : emptyDetailPrompt('No worktree observed for this repository.'));
  } else {
    detail.append(commitDetail(git.commits.status === 'observed'
      ? git.commits.list.find(commit => commit.oid === state.selectedCommitOid) ?? null
      : null));
    if (git.commits.status !== 'observed') {
      const unavailable = element('span', 'cluster');
      unavailable.append(statusChip({ state: 'unavailable', label: `commit history unavailable: ${git.commits.reason}` }));
      detail.append(unavailable);
    }
  }
  masterDetail.append(master, detail);
  pane.append(masterDetail);
  pane.append(renderPullRequests(git.pullRequests));
  pane.append(renderConflicts(git.conflicts));
  return pane;
}

/* -- Metrics pane: designed tables + compact bars ------------------------- */

function metricValueText(metric) {
  if (metric.unavailable) return '—';
  if (metric.area === 'time' && metric.unit === 'minutes') return formatMinutes(metric.value);
  return String(metric.value);
}

function coverageCell(metric) {
  const wrap = element('span', 'cluster gm-coverage');
  if (metric.unavailable) {
    const chip = statusChip({ state: 'unavailable', label: metric.coverageNote ?? 'not projected — not zero' });
    chip.dataset.testid = 'coverage-chip';
    chip.dataset.unavailable = 'true';
    wrap.append(chip);
    return wrap;
  }
  if (metric.zeroReported) {
    const chip = statusChip({ state: 'neutral', label: metric.zeroNote ?? 'reported zero' });
    chip.dataset.testid = 'coverage-chip';
    chip.dataset.zeroReported = 'true';
    wrap.append(chip);
  }
  if (metric.coverage) {
    const chip = statusChip({ state: 'neutral', label: `${metric.coverage.reported} of ${metric.coverage.total} reported` });
    chip.dataset.testid = 'coverage-chip';
    wrap.append(chip);
  }
  if (metric.coverageNote && !metric.coverage) wrap.append(element('span', 'meta', metric.coverageNote));
  return wrap;
}

function metricTable(section, state) {
  const wrap = element('section', 'stack gm-metrics-section');
  wrap.dataset.sectionId = section.id;
  wrap.dataset.kind = section.kind;
  wrap.append(element('h4', '', section.title), element('p', 'meta', section.note));
  const columns = [
    { key: 'metric', label: 'Metric' },
    { key: 'value', label: 'Value', numeric: true },
    { key: 'unit', label: 'Unit' },
    { key: 'coverage', label: 'Coverage' },
  ];
  const rows = section.metrics.map(metric => {
    const open = button(metric.label, () => state.onOpenMetric(metric.id, open));
    open.className = 'metric-row';
    open.dataset.metricId = metric.id;
    open.dataset.area = metric.area;
    open.dataset.value = metric.unavailable ? '' : String(metric.value);
    open.dataset.unit = metric.unit ?? '';
    if (metric.unavailable) open.dataset.unavailable = 'true';
    if (metric.zeroReported) open.dataset.zeroReported = 'true';
    open.setAttribute('aria-pressed', String(state.openMetricId === metric.id));
    open.setAttribute('aria-label', `${metric.label} — open contributing records and definition`);
    const valueCell = element('span', 'gm-metric-value');
    valueCell.dataset.numeric = 'true';
    valueCell.dataset.unavailable = String(Boolean(metric.unavailable));
    valueCell.dataset.zeroReported = String(Boolean(metric.zeroReported));
    valueCell.textContent = metricValueText(metric);
    return { metric: open, value: valueCell, unit: metric.unit ?? '—', coverage: coverageCell(metric) };
  });
  wrap.append(dataTable({ columns, rows, testid: 'metric-rows',
    caption: `${section.title} — every row opens its contributing records and exact scope, filters, window, definition, unit, basis and as-of in the dock.` }));
  return wrap;
}

// Compact bar visualization, pure CSS from tokens. Only same-unit metrics
// share a scale (minutes never scale against agents or tokens); widths are
// percentages of the largest REPORTED value in the group — an unavailable
// metric renders a hollow dashed track and never a zero-length bar.
function metricBars(section) {
  if (section.kind !== 'time' && section.kind !== 'usage') return null;
  const groups = new Map();
  for (const metric of section.metrics) {
    const unit = metric.unit ?? '';
    if (!unit) continue;
    if (!groups.has(unit)) groups.set(unit, []);
    groups.get(unit).push(metric);
  }
  const chart = element('div', 'stack gm-bars');
  chart.dataset.testid = 'metric-bars';
  chart.dataset.sectionId = section.id;
  for (const [unit, metrics] of groups) {
    // A group renders when it compares metrics OR when any member is
    // unavailable — an unavailable total always gets its explicit hollow row.
    if (metrics.length < 2 && !metrics.some(metric => metric.unavailable)) continue;
    const reported = metrics.filter(metric => !metric.unavailable);
    const max = reported.reduce((peak, metric) => Math.max(peak, Number(metric.value) || 0), 0);
    const group = element('div', 'stack gm-bar-group');
    group.dataset.unit = unit;
    group.dataset.scale = String(max);
    group.setAttribute('role', 'img');
    group.setAttribute('aria-label', `${metrics[0].label} scale (${unit}): bar lengths are relative to the largest reported value${max > 0 ? ` (${max} ${unit})` : ''}; unavailable totals render no bar`);
    for (const metric of metrics) {
      const row = element('div', 'gm-bar-row');
      row.dataset.metricId = metric.id;
      row.dataset.unavailable = String(Boolean(metric.unavailable));
      row.dataset.numeric = 'true';
      row.append(element('span', 'gm-bar-label meta', metric.label));
      const track = element('span', 'gm-bar-track');
      if (metric.unavailable) {
        track.dataset.unavailable = 'true';
      } else {
        // Reported values only: width is the share of the largest reported
        // value (minimum visible width so a reported zero stays visible and
        // labeled — an honest zero, never an invisible one).
        const share = max <= 0 ? 2 : Math.max(((Number(metric.value) || 0) / max) * 100, 2);
        const fill = element('span', 'gm-bar-fill');
        fill.dataset.state = metric.zeroReported || Number(metric.value) === 0 ? 'zero' : 'reported';
        fill.setAttribute('style', `inline-size: ${Math.round(share * 10) / 10}%`);
        fill.dataset.value = String(metric.value);
        track.append(fill);
      }
      row.append(track,
        element('span', 'gm-bar-value', metric.unavailable ? 'unavailable' : `${metricValueText(metric)} ${unit}`));
      group.append(row);
    }
    chart.append(group);
  }
  return chart.children.length ? chart : null;
}

function renderMetricsPane(metrics, state) {
  const pane = element('section', 'panel stack metrics-pane');
  pane.dataset.testid = 'metrics-pane';
  pane.append(element('h3', '', 'Metrics — time and token accounting'));
  const header = element('p', 'meta');
  header.dataset.testid = 'metrics-context';
  header.append(document.createTextNode(
    `scope ${metrics.scope.repository ?? metrics.scope} · runtime ${metrics.scope.runtime ?? 'unknown'}`
    + `${metrics.filters.length ? ` · filters ${metrics.filters.join(', ')}` : ' · no filters'}`
    + `${metrics.window ? ` · window ${metrics.window.start} → ${metrics.window.end}` : ' · no window declared'}`
    + ` · as-of ${metrics.asOf}`));
  pane.append(header);
  for (const section of metrics.sections) {
    pane.append(metricTable(section, state));
    const bars = metricBars(section);
    if (bars) pane.append(bars);
  }
  pane.append(element('p', 'meta',
    'Unavailable means not projected or not reported — never zero and never healthy. An exact zero renders as zero only when it was reported or computed from reported records.'));
  return pane;
}

/* -- Dock drill-down ------------------------------------------------------- */

function fillRecords(body, metrics, openMetricId) {
  body.replaceChildren(element('h3', '', 'Metric drill-down'));
  const metric = openMetricId == null ? null
    : metrics.sections.flatMap(section => section.metrics).find(entry => entry.id === openMetricId);
  if (!metric) {
    body.append(element('p', 'meta', 'Select any displayed total to open its contributing records and its exact scope, filters, window, definition, unit, basis, coverage and as-of fields.'));
    return;
  }
  body.append(element('code', '', metric.id));
  const fields = [
    ['Scope', `${metric.scope.repository ?? metric.scope} · runtime ${metric.scope.runtime ?? 'unknown'}`],
    ['Filters', metric.filters.length ? metric.filters.join(', ') : 'none declared'],
    ['Window', metric.window ? `${metric.window.start} → ${metric.window.end}` : 'no window declared'],
    ['Definition', metric.definition],
    ['Unit', metric.unit ?? 'none'],
    ['Basis', metric.basis],
    ['Source records', metric.records.length ? '' : 'no contributing records supplied'],
    ['Coverage', metric.coverage ? `${metric.coverage.reported} of ${metric.coverage.total}` : (metric.coverageNote ?? 'complete within its basis')],
    ['As-of', `${metric.asOf} · projection revision ${metric.projectionRevision ?? 'unreported'}`],
  ];
  for (const [label, text] of fields) {
    const row = element('div', 'cluster metric-field');
    row.dataset.field = label.toLowerCase().replace(/\s+/g, '-');
    row.append(element('span', 'meta', `${label}:`), element('span', '', text));
    body.append(row);
  }
  if (metric.records.length) {
    const list = element('ul', 'metric-record-list');
    list.dataset.testid = 'metric-contributing-records';
    for (const record of metric.records) {
      const item = element('li', 'metric-record');
      item.dataset.recordId = record;
      item.append(element('code', '', record));
      list.append(item);
    }
    body.append(list);
  }
  if (metric.unavailable) body.append(statusChip({ state: 'unavailable', label: 'unavailable — not projected or not reported' }));
  if (metric.zeroReported) body.append(statusChip({ state: 'neutral', label: metric.zeroNote ?? 'reported zero' }));
  if (metric.coverageNote && metric.coverage) body.append(element('p', 'meta', metric.coverageNote));
  body.append(element('p', 'meta', 'Read-only projection; the shared command route owns any change.'));
}

// One readable sentence first (TY-6/CO-2): what is happening in Git and in
// the accounting, with unavailable clauses stated as unavailable.
function leadSentence(git, metrics) {
  const clauses = [];
  if (git.status !== 'observed') {
    clauses.push(`local Git facts unavailable (${git.unavailableReason}) — no count stands in for them`);
  } else {
    const observed = git.worktrees.filter(worktree => worktree.status === 'observed');
    const union = observed.reduce((sum, worktree) => sum + (worktree.uncommitted.counts?.union ?? 0), 0);
    clauses.push(`${git.worktrees.length} worktrees observed`);
    clauses.push(union === 0 ? 'no uncommitted changed paths (exact zero)' : `${union} uncommitted changed paths`);
    clauses.push(git.commits.status === 'observed' ? `${git.commits.list.length} commits listed`
      : `commit history unavailable (${git.commits.reason})`);
    clauses.push(git.pullRequests.status === 'observed' ? `remote PR/CI observed (${git.pullRequests.list.length} PR${git.pullRequests.list.length === 1 ? '' : 's'})`
      : 'remote PR/CI observation unavailable');
  }
  const metricById = id => metrics.sections.flatMap(section => section.metrics).find(metric => metric.id === id);
  const wall = metricById('metric:time:wall');
  const elapsed = metricById('metric:time:elapsed');
  if (wall == null || elapsed == null) clauses.push('time accounting not projected');
  else if (wall.unavailable || elapsed.unavailable) clauses.push('time accounting unavailable');
  else clauses.push(`execution covered ${formatMinutes(wall.value)} of ${formatMinutes(elapsed.value)} elapsed minutes`);
  const coverage = metricById('metric:usage:coverage');
  if (coverage == null) clauses.push('usage accounting not projected');
  else if (coverage.unavailable) clauses.push('usage coverage unavailable');
  else if (coverage.coverage) clauses.push(`usage reported for ${coverage.coverage.reported} of ${coverage.coverage.total} recorded requests`);
  else clauses.push(`usage coverage: ${coverage.value} requests reported`);
  return `${clauses.join(' · ')}.`;
}

export function createGitMetricsView({ git: initialGit, metrics: initialMetrics, callbacks = {} }) {
  let currentGit = structuredClone(initialGit);
  let currentMetrics = structuredClone(initialMetrics);
  let selectedWorktreeId = currentGit.worktrees.find(worktree => worktree.current)?.id
    ?? currentGit.worktrees[0]?.id ?? null;
  let selectedCommitOid = null;
  let openMetricId = null;
  let gitMode = 'worktrees';
  let viewRevision = 0;
  let lastUpdate = null;

  const root = element('section', 'git-metrics-view stack');
  root.dataset.testid = 'git-metrics-view';
  const status = element('p', 'meta git-metrics-status', 'Git and metrics detail ready.');
  status.dataset.testid = 'git-metrics-status';
  status.setAttribute('role', 'status');
  const recordsBody = element('div', 'stack');
  recordsBody.dataset.testid = 'metrics-records';
  const dock = createDockPanel({ title: 'Metric drill-down', content: recordsBody,
    footer: element('p', 'meta', 'Escape closes the dock; focus returns to the total that opened it.') });
  dock.element.dataset.testid = 'metrics-dock';
  let dockTrigger = null;

  function render() {
    const state = { selectedWorktreeId, selectedCommitOid, openMetricId, gitMode,
      onSelectWorktree: selectWorktree, onSelectCommit: selectCommit, onOpenMetric: openMetric,
      onGitMode: setGitMode };
    const head = element('header', 'stack git-metrics-head');
    const lead = element('p', 'gm-lead', leadSentence(currentGit, currentMetrics));
    lead.dataset.testid = 'git-metrics-lead';
    head.append(element('h2', '', 'Git and metrics detail'), lead,
      element('p', 'meta', 'Where the work lives in Git and what resources were used. Git stages and time/token accounting render as distinct sections; every total opens its contributing records in the dock.'));
    // Refocus by identity after the re-render. dataset on a node without the
    // attribute reads as '' (not null), so '' must collapse to null here —
    // otherwise an unrelated node would be focused.
    const focused = document.activeElement?.parentNode ? document.activeElement : null;
    const focusedMetricId = focused?.dataset?.metricId || null;
    const focusedWorktreeId = focused?.dataset?.worktreeId || null;
    fillRecords(recordsBody, currentMetrics, openMetricId);
    root.replaceChildren(head, status, renderGitPane(currentGit, state), renderMetricsPane(currentMetrics, state));
    root.append(dock.element);
    root.dataset.viewRevision = String(viewRevision);
    if (focusedMetricId != null) root.querySelector(`[data-metric-id="${focusedMetricId}"]`)?.focus();
    else if (focusedWorktreeId != null) root.querySelector(`[data-worktree-id="${focusedWorktreeId}"]`)?.focus();
    status.textContent = `${currentGit.worktrees.length} worktrees · ${currentGit.commits.list.length} commits listed · `
      + `${currentMetrics.sections.flatMap(section => section.metrics).length} metrics · view revision ${viewRevision}`;
  }

  function selectWorktree(worktreeId) {
    selectedWorktreeId = worktreeId;
    render();
    callbacks.onSelectWorktree?.({ worktreeId });
  }

  function selectCommit(oid) {
    selectedCommitOid = oid;
    render();
    callbacks.onSelectCommit?.({ oid });
  }

  function setGitMode(mode) {
    if (!GIT_MODES.includes(mode)) return gitMode;
    if (gitMode === mode) return gitMode;
    gitMode = mode;
    render();
    callbacks.onGitMode?.({ mode });
    return gitMode;
  }

  function openMetric(metricId, invoker = null) {
    openMetricId = metricId;
    if (invoker == null && (document.activeElement?.dataset?.metricId || null) === metricId) invoker = document.activeElement;
    // Sync the pressed state in place (no full re-render): the invoking total
    // stays connected so the dock's Escape focus-return lands back on it.
    for (const row of root.querySelectorAll('.metric-row')) {
      row.setAttribute('aria-pressed', String(row.dataset.metricId === metricId));
    }
    fillRecords(recordsBody, currentMetrics, openMetricId);
    dockTrigger = invoker ?? dockTrigger;
    dock.open(dockTrigger);
    callbacks.onMetricOpened?.({ metricId });
  }

  /** Simulated polling tick: re-render from the next collected models while
   *  preserving the git mode, worktree/commit selection and the open metric
   *  drill-down (and the dock's open state). */
  function applyUpdate(nextGit, nextMetrics) {
    const preserved = { selectedWorktreeId, selectedCommitOid, openMetricId, gitMode };
    currentGit = structuredClone(nextGit);
    currentMetrics = structuredClone(nextMetrics);
    if (selectedWorktreeId && !currentGit.worktrees.some(worktree => worktree.id === selectedWorktreeId)) selectedWorktreeId = null;
    if (selectedCommitOid && !currentGit.commits.list.some(commit => commit.oid === selectedCommitOid)) selectedCommitOid = null;
    if (openMetricId && !currentMetrics.sections.some(section => section.metrics.some(metric => metric.id === openMetricId))) openMetricId = null;
    viewRevision += 1;
    render();
    if (openMetricId == null) dock.close('update');
    else fillRecords(recordsBody, currentMetrics, openMetricId);
    lastUpdate = { ...preserved,
      selectedPreserved: preserved.selectedWorktreeId == null || preserved.selectedWorktreeId === selectedWorktreeId,
      commitPreserved: preserved.selectedCommitOid == null || preserved.selectedCommitOid === selectedCommitOid,
      openMetricPreserved: preserved.openMetricId == null || preserved.openMetricId === openMetricId,
      gitModePreserved: preserved.gitMode === gitMode,
      viewRevision };
    callbacks.onUpdate?.(structuredClone(lastUpdate));
    return structuredClone(lastUpdate);
  }

  function focusWorktree(worktreeId) {
    const target = root.querySelector(`[data-worktree-id="${worktreeId}"]`);
    if (target) target.focus();
    return Boolean(target);
  }

  function focusMetric(metricId) {
    const target = root.querySelector(`[data-metric-id="${metricId}"]`);
    if (target) target.focus();
    return Boolean(target);
  }

  root.addEventListener('keydown', event => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
    const key = event.key;
    if (event.target.classList?.contains('metric-row')) {
      const rows = [...root.querySelectorAll('.metric-row')];
      const index = rows.indexOf(event.target);
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        event.preventDefault();
        const next = rows[index + (key === 'ArrowDown' ? 1 : -1)];
        if (next) next.focus();
      } else if (key === 'Enter' || key === ' ') {
        event.preventDefault();
        openMetric(event.target.dataset.metricId, event.target);
      } else if (key === 'Home' || key === 'End') {
        event.preventDefault();
        (key === 'Home' ? rows[0] : rows[rows.length - 1])?.focus();
      }
      return;
    }
    if (event.target.classList?.contains('git-worktree')) {
      const cards = [...root.querySelectorAll('.git-worktree')];
      const index = cards.indexOf(event.target);
      if (key === 'ArrowRight' || key === 'ArrowLeft') {
        event.preventDefault();
        const next = cards[(index + (key === 'ArrowRight' ? 1 : cards.length - 1)) % cards.length];
        next.focus();
      } else if (key === 'Enter' || key === ' ') {
        event.preventDefault();
        selectWorktree(event.target.dataset.worktreeId);
      }
      return;
    }
    if (event.target.classList?.contains('git-commit-open') && (key === 'Enter' || key === ' ')) {
      event.preventDefault();
      selectCommit(event.target.dataset.commitOid);
    }
  });

  render();

  return {
    element: root,
    selectWorktree,
    selectCommit,
    setGitMode,
    openMetric,
    focusWorktree,
    focusMetric,
    applyUpdate,
    closeRecords: () => dock.close('api'),
    isRecordsOpen: () => dock.isOpen(),
    getStats() {
      return { viewRevision, selectedWorktreeId, selectedCommitOid, openMetricId, gitMode, lastUpdate,
        dockOpen: dock.isOpen(),
        worktreeIds: currentGit.worktrees.map(worktree => worktree.id),
        metricIds: currentMetrics.sections.flatMap(section => section.metrics.map(metric => metric.id)) };
    },
    getGit() { return structuredClone(currentGit); },
    getMetrics() { return structuredClone(currentMetrics); },
  };
}
