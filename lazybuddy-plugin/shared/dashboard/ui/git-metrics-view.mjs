// T18 Git and metrics detail view — two VISUALLY DISTINCT panes over the T18
// models: the Git pane (worktree/commit selection, uncommitted snapshots,
// read-only dirty bindings, PR/CI subjects) and the metrics pane (spec §8
// drill-down where every total opens its contributing records and its exact
// scope/filters/window/definition/unit/basis/records/coverage/as-of fields).
// Git stages and time/token accounting never share a section. Unavailable
// native data renders typed-unavailable — never zero, never healthy. Read-only
// projection: no commands, no collector runs, no scheduler authority.
import { button, element, statusChip } from './components.mjs';
import { formatMinutes } from './git-metrics-model.mjs';

const UNION_NOTE = 'staged+unstaged changes to one path count as one changed path in the union';

function captureChip(capture) {
  if (capture == null) return null;
  if (capture.stable === true) return statusChip({ state: 'neutral', label: 'capture stable' });
  if (capture.stable === false) return statusChip({ state: 'attention', label: 'capture unstable — cannot establish a clean verified result' });
  return statusChip({ state: 'unavailable', label: 'capture stability unknown' });
}

function countsRow(counts, note = true) {
  const row = element('div', 'cluster git-counts');
  row.dataset.testid = 'git-union-counts';
  const entries = [['staged', counts.staged], ['unstaged', counts.unstaged], ['untracked', counts.untracked],
    ['unmerged', counts.unmerged]];
  for (const [name, count] of entries) {
    const item = element('span', 'cluster git-count');
    item.dataset.stage = name;
    item.dataset.count = String(count);
    item.append(element('span', 'meta', `${name} ${count}`));
    row.append(item);
  }
  const union = element('span', 'cluster git-count git-count-union');
  union.dataset.stage = 'union';
  union.dataset.count = String(counts.union);
  union.append(element('strong', '', `union changed paths ${counts.union}`));
  row.append(union);
  if (counts.truncated) row.append(statusChip({ state: 'attention', label: 'path lists truncated — counts exact' }));
  if (note) row.append(element('span', 'meta', UNION_NOTE));
  return row;
}

function worktreeCard(worktree, state) {
  const card = button('', () => state.onSelectWorktree(worktree.id));
  card.className = `git-worktree${worktree.current ? ' git-worktree-current' : ''}`;
  card.dataset.worktreeId = worktree.id;
  card.dataset.kind = worktree.kind;
  card.dataset.current = String(worktree.current);
  card.setAttribute('aria-pressed', String(state.selectedWorktreeId === worktree.id));
  card.setAttribute('aria-label', `${worktree.kind} worktree ${worktree.root}`);
  const head = element('span', 'cluster git-worktree-head');
  const kindChip = statusChip({ state: worktree.current ? 'active' : 'neutral',
    label: `${worktree.kind}${worktree.current ? ' · current' : ''}` });
  head.append(kindChip);
  // Branch label (moving) and commit identity (immutable) render as separate
  // fields with distinct labels — never conflated.
  if (worktree.branch != null) {
    const label = element('span', 'cluster git-identity');
    label.append(element('span', 'meta', 'branch (moving label)'), element('code', '', worktree.branch));
    label.dataset.identityKind = 'branch-label';
    head.append(label);
  }
  if (worktree.detached) head.append(statusChip({ state: 'attention', label: 'detached HEAD — no branch label' }));
  if (worktree.bare) head.append(statusChip({ state: 'neutral', label: 'bare worktree' }));
  const identity = element('span', 'cluster git-identity');
  identity.dataset.identityKind = 'commit-identity';
  identity.append(element('span', 'meta', 'HEAD (commit identity, immutable)'),
    element('code', '', worktree.head ?? 'none'));
  head.append(identity);
  if (worktree.upstream != null) {
    head.append(element('span', 'meta', `upstream ${worktree.upstream}`
      + `${worktree.ahead != null ? ` · ahead ${worktree.ahead}` : ''}${worktree.behind != null ? ` · behind ${worktree.behind}` : ''}`));
  }
  card.append(head);
  card.append(element('span', 'meta git-worktree-root', worktree.root));

  if (worktree.status !== 'observed') {
    const unavailable = element('span', 'cluster');
    unavailable.dataset.testid = 'git-worktree-unavailable';
    unavailable.append(statusChip({ state: 'unavailable', label: `worktree facts unavailable: ${worktree.unavailableReason}` }));
    card.append(unavailable);
    return card;
  }

  // Uncommitted changes: an explicit uncommitted snapshot, never a commit.
  const snapshot = element('span', 'stack git-snapshot');
  snapshot.dataset.testid = 'git-uncommitted-snapshot';
  snapshot.dataset.snapshotKind = worktree.uncommitted.snapshotKind;
  const snapshotHead = element('span', 'cluster');
  snapshotHead.append(statusChip({ state: worktree.uncommitted.counts?.union > 0 ? 'attention' : 'neutral',
    label: worktree.uncommitted.counts?.union > 0 ? 'uncommitted changes' : 'no changed paths (exact zero)' }));
  if (worktree.recordId) snapshotHead.append(element('span', 'meta', `observation record ${worktree.recordId}`));
  snapshot.append(snapshotHead);
  snapshot.append(countsRow(worktree.uncommitted.counts));
  const pathList = element('ul', 'git-path-list');
  const classList = [['staged', worktree.uncommitted.staged, entry => entry.rename_from ? `${entry.path} (renamed from ${entry.rename_from})` : entry.path],
    ['unstaged', worktree.uncommitted.unstaged, entry => entry.path],
    ['untracked', worktree.uncommitted.untracked, entry => entry],
    ['unmerged', worktree.uncommitted.unmerged, entry => `${entry.path} (${entry.xy})`]];
  for (const [name, entries, labelOf] of classList) {
    for (const entry of entries) {
      const item = element('li', 'git-path');
      item.dataset.stage = name;
      item.dataset.path = labelOf(entry);
      item.append(element('span', 'meta', `${name}: `), element('code', '', labelOf(entry)));
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
  card.append(snapshot);

  // Read-only dirty-content binding: the content-revision binding that lets
  // same-HEAD edits stale proof. Surfaced, never editable here.
  if (worktree.binding) {
    const binding = element('span', 'stack git-binding');
    binding.dataset.testid = 'git-dirty-binding';
    binding.dataset.readOnly = 'true';
    binding.dataset.headOid = worktree.binding.headOid ?? '';
    binding.dataset.digest = worktree.binding.digest;
    const bindingHead = element('span', 'cluster');
    bindingHead.append(statusChip({ state: 'neutral', label: 'dirty-content binding · read-only' }),
      element('span', 'meta', `digest ${worktree.binding.digestShort}…`));
    binding.append(bindingHead);
    const relevant = element('ul', 'git-path-list');
    for (const entry of worktree.binding.relevantChangedPaths) {
      const item = element('li', 'git-path');
      item.dataset.path = entry.path;
      item.append(element('span', 'meta', `relevant (${entry.classes.join('+')}): `), element('code', '', entry.path));
      relevant.append(item);
    }
    binding.append(relevant);
    binding.append(element('span', 'meta',
      `scope ${worktree.binding.sourceScope.join(', ')} · unrelated changed paths ${worktree.binding.unrelatedChangedPathCount} · ${worktree.binding.staleRule}`));
    card.append(binding);
  }
  return card;
}

function commitCard(commit, state) {
  const card = button('', () => state.onSelectCommit(commit.oid));
  card.className = 'git-commit';
  card.dataset.commitOid = commit.oid;
  card.dataset.parentCount = String(commit.parentCount);
  card.dataset.isMerge = String(commit.isMerge);
  card.setAttribute('aria-pressed', String(state.selectedCommitOid === commit.oid));
  card.setAttribute('aria-label', `commit ${commit.oidShort} ${commit.subject}`);
  const head = element('span', 'cluster');
  head.append(element('code', '', commit.oidShort), element('span', '', commit.subject));
  if (commit.isMerge) {
    const badge = statusChip({ state: 'active', label: `merge · ${commit.parentCount} parents` });
    badge.dataset.testid = 'git-merge-badge';
    head.append(badge);
  }
  card.append(head);
  const parents = element('span', 'cluster git-parents');
  parents.append(element('span', 'meta', 'parents:'));
  if (!commit.parentOids.length) parents.append(element('span', 'meta', 'none (root commit)'));
  for (const parent of commit.parentOids) {
    const parentCode = element('code', 'git-parent-oid', parent);
    parentCode.dataset.parentOid = parent;
    parents.append(parentCode);
  }
  card.append(parents);
  // Source timestamps stay separate from the collector observation time.
  card.append(element('span', 'meta', `authored ${commit.authorAt} · committed ${commit.committerAt} · observed by collector ${commit.observedAt}`));
  return card;
}

function prCard(pr) {
  const card = element('div', 'stack git-pr');
  card.dataset.prNumber = String(pr.number);
  const head = element('span', 'cluster');
  head.append(element('strong', '', `#${pr.number}`), element('span', '', pr.title ?? 'title unreported'));
  if (pr.state != null) head.append(statusChip({ state: pr.state === 'OPEN' ? 'active' : 'neutral', label: String(pr.state).toLowerCase() }));
  if (pr.isDraft) head.append(statusChip({ state: 'neutral', label: 'draft' }));
  card.append(head);
  const row = (label, ref, oid, kind) => {
    const line = element('span', 'cluster git-pr-field');
    line.dataset.subject = kind;
    line.append(element('span', 'meta', label));
    if (ref != null || oid != null) {
      line.append(element('code', '', `${ref ?? 'ref unreported'} @ ${oid ?? 'oid unreported'}`));
    } else {
      line.append(statusChip({ state: 'unavailable', label: 'not observed' }));
    }
    return line;
  };
  // Head, base and the tested subject stay separate fields (spec §9).
  card.append(row('head', pr.head.ref, pr.head.oid, 'head'), row('base', pr.base.ref, pr.base.oid, 'base'));
  const tested = element('span', 'cluster git-pr-field');
  tested.dataset.subject = 'tested-subject';
  tested.append(element('span', 'meta', 'tested subject / SHA'));
  tested.append(statusChip({ state: 'unavailable', label: `${pr.testedSubject.status} · ${pr.testedSubject.reason}` }));
  card.append(tested);
  const merge = element('span', 'cluster git-pr-field');
  merge.dataset.subject = 'test-merge';
  merge.append(element('span', 'meta', 'test-merge SHA'));
  merge.append(statusChip({ state: 'unavailable', label: `${pr.testMerge.status} · a test-merge SHA is never the PR head` }));
  card.append(merge);
  const checks = element('span', 'cluster git-pr-field');
  checks.dataset.subject = 'checks';
  checks.append(element('span', 'meta', 'checks / workflow runs'));
  checks.append(statusChip({ state: 'unavailable', label: `${pr.checks.status} · ${pr.checks.reason}` }));
  card.append(checks);
  card.append(element('span', 'meta', `observed ${pr.observedAt}`));
  return card;
}

function renderPullRequests(pullRequests) {
  const section = element('section', 'stack git-pr-section');
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
    section.append(element('span', 'meta', `coverage: ${pullRequests.coverage.reported} of ${pullRequests.coverage.total ?? 'unknown'} listed`));
  }
  return section;
}

function renderConflicts(conflicts) {
  const section = element('section', 'stack git-conflicts');
  section.dataset.testid = 'git-conflicts';
  section.append(element('h4', '', 'Issue classes (kept distinct)'));
  const row = (label, chip, detail) => {
    const line = element('span', 'cluster git-conflict');
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

  const worktreeRow = element('div', 'git-worktree-row');
  worktreeRow.dataset.testid = 'git-worktrees';
  worktreeRow.setAttribute('role', 'toolbar');
  worktreeRow.setAttribute('aria-label', 'Worktree selection — branch labels are moving labels; commit identity is immutable');
  for (const worktree of git.worktrees) worktreeRow.append(worktreeCard(worktree, state));
  const worktreeHeading = element('h4', '', 'Worktrees and uncommitted snapshots');
  worktreeHeading.dataset.testid = 'git-worktrees-heading';
  pane.append(worktreeHeading, worktreeRow,
    element('p', 'meta', 'Uncommitted changes render as an explicit uncommitted snapshot — never as a fabricated commit. Each snapshot carries the read-only dirty-content binding that stales affected proof on same-HEAD relevant edits.'));

  const commitsWrap = element('section', 'stack git-commits');
  commitsWrap.dataset.testid = 'git-commits';
  commitsWrap.append(element('h4', '', 'Commits (real parent OIDs)'));
  if (git.commits.status !== 'observed') {
    const unavailable = element('span', 'cluster');
    unavailable.append(statusChip({ state: 'unavailable', label: `commit history unavailable: ${git.commits.reason}` }));
    commitsWrap.append(unavailable);
  } else {
    const list = element('ol', 'git-commit-list');
    for (const commit of git.commits.list) list.append(commitCard(commit, state));
    commitsWrap.append(list);
    commitsWrap.append(element('p', 'meta',
      `coverage: ${git.commits.coverage.reported} of ${git.commits.coverage.total ?? 'unknown'} commits listed · source timestamps above are the commit's own; the collector observation time is separate`));
  }
  pane.append(commitsWrap);
  pane.append(renderPullRequests(git.pullRequests));
  pane.append(renderConflicts(git.conflicts));
  return pane;
}

function metricValueText(metric) {
  if (metric.unavailable) return 'unavailable';
  if (metric.area === 'time' && metric.unit === 'minutes') return `${formatMinutes(metric.value)} ${metric.unit}`;
  return `${metric.value} ${metric.unit ?? ''}`.trim();
}

function metricRow(metric, state) {
  const control = button(`${metric.label}: ${metricValueText(metric)}`, () => state.onOpenMetric(metric.id));
  control.className = 'metric-row';
  control.dataset.metricId = metric.id;
  control.dataset.area = metric.area;
  control.dataset.value = metric.unavailable ? '' : String(metric.value);
  control.dataset.unit = metric.unit ?? '';
  if (metric.unavailable) control.dataset.unavailable = 'true';
  if (metric.zeroReported) control.dataset.zeroReported = 'true';
  control.setAttribute('aria-pressed', String(state.openMetricId === metric.id));
  control.setAttribute('aria-label', `${metric.label} — open contributing records and definition`);
  return control;
}

function renderMetricsPane(metrics, state) {
  const pane = element('section', 'panel stack metrics-pane');
  pane.dataset.testid = 'metrics-pane';
  pane.append(element('h3', '', 'Metrics — time and token accounting (spec §8 drill-down)'));
  const header = element('p', 'meta');
  header.dataset.testid = 'metrics-context';
  header.append(document.createTextNode(
    `scope ${metrics.scope.repository ?? metrics.scope} · runtime ${metrics.scope.runtime ?? 'unknown'}`
    + `${metrics.filters.length ? ` · filters ${metrics.filters.join(', ')}` : ' · no filters'}`
    + `${metrics.window ? ` · window ${metrics.window.start} → ${metrics.window.end}` : ' · no window declared'}`
    + ` · as-of ${metrics.asOf}`));
  pane.append(header);
  for (const section of metrics.sections) {
    const wrap = element('section', 'stack metrics-section');
    wrap.dataset.sectionId = section.id;
    wrap.dataset.kind = section.kind;
    wrap.append(element('h4', '', section.title), element('p', 'meta', section.note));
    const rows = element('div', 'stack metric-rows');
    rows.dataset.testid = 'metric-rows';
    for (const metric of section.metrics) rows.append(metricRow(metric, state));
    pane.append(wrap, rows);
  }
  pane.append(element('p', 'meta',
    'Unavailable means not projected or not reported — never zero and never healthy. An exact zero renders as zero only when it was reported or computed from reported records.'));
  return pane;
}

function recordsPanelElement() {
  const panel = element('aside', 'panel stack metrics-records');
  panel.dataset.testid = 'metrics-records';
  panel.tabIndex = 0;
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'Metric drill-down and contributing records');
  return panel;
}

function fillRecords(panel, metrics, openMetricId) {
  panel.replaceChildren(element('h3', '', 'Metric drill-down'));
  const metric = openMetricId == null ? null
    : metrics.sections.flatMap(section => section.metrics).find(entry => entry.id === openMetricId);
  if (!metric) {
    panel.append(element('p', 'meta', 'Select any displayed total to open its contributing records and its exact scope, filters, window, definition, unit, basis, coverage and as-of fields.'));
    return;
  }
  panel.append(element('code', '', metric.id));
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
    panel.append(row);
  }
  if (metric.records.length) {
    const list = element('ul', 'metric-record-list');
    for (const record of metric.records) {
      const item = element('li', 'metric-record');
      item.dataset.recordId = record;
      item.append(element('code', '', record));
      list.append(item);
    }
    panel.append(list);
  }
  if (metric.unavailable) panel.append(statusChip({ state: 'unavailable', label: 'unavailable — not projected or not reported' }));
  if (metric.zeroReported) panel.append(statusChip({ state: 'neutral', label: metric.zeroNote ?? 'reported zero' }));
  if (metric.coverageNote && metric.coverage) panel.append(element('p', 'meta', metric.coverageNote));
  panel.append(element('p', 'meta', 'Read-only projection; the shared command route owns any change.'));
}

export function createGitMetricsView({ git: initialGit, metrics: initialMetrics, callbacks = {} }) {
  let currentGit = structuredClone(initialGit);
  let currentMetrics = structuredClone(initialMetrics);
  let selectedWorktreeId = null;
  let selectedCommitOid = null;
  let openMetricId = null;
  let viewRevision = 0;
  let lastUpdate = null;

  const root = element('section', 'git-metrics-view stack');
  root.dataset.testid = 'git-metrics-view';
  const status = element('p', 'meta git-metrics-status', 'Git and metrics detail ready.');
  status.dataset.testid = 'git-metrics-status';
  status.setAttribute('role', 'status');
  const records = recordsPanelElement();

  function render() {
    const state = { selectedWorktreeId, selectedCommitOid, openMetricId,
      onSelectWorktree: selectWorktree, onSelectCommit: selectCommit, onOpenMetric: openMetric };
    const head = element('header', 'stack git-metrics-head');
    head.append(element('h2', '', 'Git and metrics detail'),
      element('p', 'meta', 'Where the work lives in Git (spec §9) and what resources were used (spec §8). Git stages and time/token accounting render as distinct panes; every total opens its contributing records.'));
    const focused = document.activeElement?.parentNode ? document.activeElement : null;
    const focusedMetricId = focused?.dataset?.metricId ?? null;
    const focusedWorktreeId = focused?.dataset?.worktreeId ?? null;
    fillRecords(records, currentMetrics, openMetricId);
    root.replaceChildren(head, status, renderGitPane(currentGit, state), renderMetricsPane(currentMetrics, state), records);
    root.dataset.viewRevision = String(viewRevision);
    if (focusedMetricId != null) root.querySelector(`[data-metric-id="${focusedMetricId}"]`)?.focus();
    else if (focusedWorktreeId != null) root.querySelector(`[data-worktree-id="${focusedWorktreeId}"]`)?.focus();
    status.textContent = `${currentGit.worktrees.length} worktrees · ${currentGit.commits.list.length} commits listed · `
      + `${currentMetrics.sections.flatMap(section => section.metrics).length} metrics · view revision ${viewRevision}`;
  }

  function selectWorktree(worktreeId) {
    selectedWorktreeId = worktreeId;
    for (const card of root.querySelectorAll('.git-worktree')) {
      card.setAttribute('aria-pressed', String(card.dataset.worktreeId === worktreeId));
    }
    callbacks.onSelectWorktree?.({ worktreeId });
  }

  function selectCommit(oid) {
    selectedCommitOid = oid;
    for (const card of root.querySelectorAll('.git-commit')) {
      card.setAttribute('aria-pressed', String(card.dataset.commitOid === oid));
    }
    callbacks.onSelectCommit?.({ oid });
  }

  function openMetric(metricId) {
    openMetricId = metricId;
    for (const row of root.querySelectorAll('.metric-row')) {
      row.setAttribute('aria-pressed', String(row.dataset.metricId === metricId));
    }
    fillRecords(records, currentMetrics, openMetricId);
    callbacks.onMetricOpened?.({ metricId });
  }

  /** Simulated polling tick: re-render from the next collected models while
   *  preserving worktree/commit selection and the open metric drill-down. */
  function applyUpdate(nextGit, nextMetrics) {
    const preserved = { selectedWorktreeId, selectedCommitOid, openMetricId };
    currentGit = structuredClone(nextGit);
    currentMetrics = structuredClone(nextMetrics);
    if (selectedWorktreeId && !currentGit.worktrees.some(worktree => worktree.id === selectedWorktreeId)) selectedWorktreeId = null;
    if (selectedCommitOid && !currentGit.commits.list.some(commit => commit.oid === selectedCommitOid)) selectedCommitOid = null;
    if (openMetricId && !currentMetrics.sections.some(section => section.metrics.some(metric => metric.id === openMetricId))) openMetricId = null;
    viewRevision += 1;
    render();
    lastUpdate = { ...preserved,
      selectedPreserved: preserved.selectedWorktreeId == null || preserved.selectedWorktreeId === selectedWorktreeId,
      commitPreserved: preserved.selectedCommitOid == null || preserved.selectedCommitOid === selectedCommitOid,
      openMetricPreserved: preserved.openMetricId == null || preserved.openMetricId === openMetricId,
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
        openMetric(event.target.dataset.metricId);
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
    if (event.target.classList?.contains('git-commit') && (key === 'Enter' || key === ' ')) {
      event.preventDefault();
      selectCommit(event.target.dataset.commitOid);
    }
  });

  render();

  return {
    element: root,
    selectWorktree,
    selectCommit,
    openMetric,
    focusWorktree,
    focusMetric,
    applyUpdate,
    getStats() {
      return { viewRevision, selectedWorktreeId, selectedCommitOid, openMetricId, lastUpdate,
        worktreeIds: currentGit.worktrees.map(worktree => worktree.id),
        metricIds: currentMetrics.sections.flatMap(section => section.metrics.map(metric => metric.id)) };
    },
    getGit() { return structuredClone(currentGit); },
    getMetrics() { return structuredClone(currentMetrics); },
  };
}
