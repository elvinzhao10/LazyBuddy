// T18 Git and metrics detail view models — pure, browser-safe presentation
// models. They consume the recorded RESULTS of the T11 git-observation
// collectors and the T10 usage-accounting functions as plain JSON; no
// collector subprocess and no accounting arithmetic is reimplemented or
// forked here. Honesty invariants (spec §8/§8.1/§9): branch labels are moving
// labels distinct from immutable commit identity; uncommitted changes are an
// explicit uncommitted snapshot, never a fabricated commit; staged/unstaged/
// untracked/unmerged union counting is displayed next to the per-class counts;
// unknown is null and unavailable stays typed — nothing renders as zero or
// healthy unless it was reported as such.
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

// Presentation-only stable key for long worktree roots (not a proof digest;
// proof digests come from the T11 collector bindings).
function stableKey(value) {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) hash = ((hash * 33) + value.charCodeAt(index)) >>> 0;
  return hash.toString(16).padStart(8, '0');
}

function shortOid(oid) {
  return typeof oid === 'string' && OID.test(oid) ? oid.slice(0, 10) : '';
}

function changedCounts(changed) {
  if (!changed) return null;
  const listed = changed.staged.paths.length + changed.unstaged.paths.length
    + changed.untracked.paths.length + changed.unmerged.paths.length;
  const truncated = changed.staged.truncated || changed.unstaged.truncated
    || changed.untracked.truncated || changed.unmerged.truncated;
  return {
    staged: changed.staged.total ?? changed.staged.paths.length,
    unstaged: changed.unstaged.total ?? changed.unstaged.paths.length,
    untracked: changed.untracked.total ?? changed.untracked.paths.length,
    unmerged: changed.unmerged.total ?? changed.unmerged.paths.length,
    union: changed.union_total,
    unionRule: 'staged+unstaged changes to one path count as one changed path in the union',
    truncated,
    coverage: truncated ? { reported: listed, total: changed.union_total } : null,
  };
}

function worktreeModel(worktree, observationIds) {
  const recordId = observationIds?.worktrees?.[worktree.root] ?? null;
  return {
    id: `worktree:${stableKey(worktree.root)}`,
    recordId,
    root: worktree.root,
    kind: worktree.kind,
    current: Boolean(worktree.current),
    status: worktree.status,
    unavailableReason: worktree.status === 'observed' ? null : worktree.reason,
    // Branch name and commit identity stay DISTINCT fields: the label moves,
    // the OID does not.
    branch: worktree.status === 'observed' && !worktree.detached && !worktree.bare ? worktree.branch : null,
    branchKind: 'moving-label',
    head: worktree.head,
    headShort: shortOid(worktree.head),
    commitKind: 'commit-identity-immutable',
    detached: Boolean(worktree.detached),
    bare: Boolean(worktree.bare),
    upstream: worktree.upstream ?? null,
    ahead: worktree.ahead ?? null,
    behind: worktree.behind ?? null,
    uncommitted: worktree.status === 'observed'
      ? {
        // An explicit uncommitted snapshot — never a commit object.
        snapshotKind: 'uncommitted-snapshot',
        note: 'Working-tree facts at observation time; these paths are not commits and never appear in the commit list.',
        staged: worktree.changed.staged.paths,
        unstaged: worktree.changed.unstaged.paths,
        untracked: worktree.changed.untracked.paths,
        unmerged: worktree.changed.unmerged.paths,
        counts: changedCounts(worktree.changed),
        binaryPaths: worktree.binary_paths ?? [],
      }
      : { snapshotKind: 'unavailable', note: `Worktree status unavailable: ${worktree.reason}` },
    // Read-only dirty-content snapshot binding (spec §9): same HEAD plus a
    // relevant edit changes the digest and stales affected proof; a branch
    // rename changes nothing here because labels are not part of the binding.
    binding: worktree.binding ? {
      readOnly: true,
      headOid: worktree.binding.head_oid,
      digest: worktree.binding.digest,
      digestShort: worktree.binding.digest.slice(0, 16),
      sourceScope: worktree.binding.source_scope,
      relevantChangedPaths: worktree.binding.relevant_changed_paths,
      unrelatedChangedPathCount: worktree.binding.unrelated_changed_path_count,
      staleRule: 'same HEAD plus a changed relevant path stales affected proof; a branch rename does not',
    } : null,
  };
}

// Maps one T11 local collector result (plain JSON) onto the Git detail view
// model. `observationIds` optionally supplies the real observation record ids
// produced by the T11 bridge (localObservationRecords) so displayed totals can
// open their contributing records.
export function gitDetailModel({ local, remote = null, observationIds = null }) {
  if (local == null) throw new Error('LOCAL_RESULT_REQUIRED');
  const observed = local.status === 'observed';
  const model = {
    viewId: 'git-detail',
    collector: local.collector,
    status: local.status,
    unavailableReason: observed ? null : local.reason,
    repository: observed ? local.repository : null,
    head: observed ? local.head : null,
    // When the collector observed these facts — kept separate from every
    // commit's own source timestamps.
    observedAt: local.observed_at,
    capture: observed ? local.capture : null,
    coverage: observed ? local.coverage : null,
    limits: observed ? local.limits : null,
    worktrees: observed ? local.worktrees.map(worktree => worktreeModel(worktree, observationIds)) : [],
    commits: { status: 'unavailable', reason: 'GIT_FACTS_UNAVAILABLE', list: [], coverage: null },
    conflicts: null,
    recordId: observationIds?.git ?? null,
  };
  if (!observed) return model;
  model.commits = {
    status: local.commits.status,
    reason: local.commits.reason ?? null,
    list: local.commits.observed.map(commit => ({
      oid: commit.oid,
      oidShort: shortOid(commit.oid),
      parentOids: [...commit.parent_oids],
      parentCount: commit.parent_oids.length,
      isMerge: commit.parent_oids.length >= 2,
      subject: commit.subject,
      authorAt: commit.author_at,
      committerAt: commit.committer_at,
      observedAt: local.observed_at,
    })),
    coverage: local.commits.coverage,
  };
  model.conflicts = {
    actualUnmergedIndex: {
      status: local.conflicts.actual_unmerged_index.status,
      paths: local.conflicts.actual_unmerged_index.paths,
      label: 'actual unmerged index state',
    },
    predictedMergeConflict: {
      status: local.conflicts.predicted_merge_conflict.status,
      reason: local.conflicts.predicted_merge_conflict.reason,
      label: 'predicted merge conflict',
    },
    concurrentEditOverlap: {
      status: local.conflicts.concurrent_edit_overlap.status,
      advisory: local.conflicts.concurrent_edit_overlap.advisory ?? false,
      classification: local.conflicts.concurrent_edit_overlap.classification ?? null,
      overlaps: local.conflicts.concurrent_edit_overlap.overlaps,
      label: 'concurrent edit overlap',
    },
    semanticPlanConflict: {
      status: local.conflicts.semantic_plan_conflict.status,
      reason: local.conflicts.semantic_plan_conflict.reason,
      ownedBy: local.conflicts.semantic_plan_conflict.owned_by ?? null,
      label: 'semantic plan conflict',
    },
  };
  model.pullRequests = remoteModel(remote);
  return model;
}

function remoteModel(remote) {
  if (remote == null) {
    return { status: 'unavailable', reason: 'REMOTE_COLLECTOR_NOT_RUN', remote: null, list: [], coverage: null,
      note: 'No remote observation was attempted; nothing is inferred.' };
  }
  if (remote.status !== 'observed') {
    return { status: 'unavailable', reason: remote.reason, remote: null, list: [], coverage: null,
      note: 'Remote PR/CI facts stay typed unavailable — this is not zero pull requests and not a healthy state.' };
  }
  return {
    status: 'observed',
    reason: null,
    remote: remote.remote,
    list: remote.pull_requests.map(pr => ({
      number: pr.number,
      title: pr.title,
      state: pr.state,
      isDraft: pr.is_draft,
      url: pr.url,
      // Head, base and the tested subject stay SEPARATE fields: a test-merge
      // SHA never becomes the PR head (spec §9).
      head: { ref: pr.head.ref, oid: pr.head.oid },
      base: { ref: pr.base.ref, oid: pr.base.oid },
      testedSubject: pr.tested_subject,
      testMerge: pr.test_merge,
      checks: pr.checks,
      observedAt: remote.observed_at,
    })),
    coverage: remote.coverage ?? null,
    limits: remote.limits ?? null,
    note: 'PR head/base come from observed gh fields; CI tested-subject and test-merge SHAs are not observed by this collector.',
  };
}

const formatMinutes = value => (Number.isInteger(value) ? String(value) : value.toFixed(2));

function stamped(metric, context) {
  return { ...metric, scope: context.scope, filters: context.filters, window: context.window,
    asOf: context.asOf, projectionRevision: context.projectionRevision };
}

function unavailableMetric({ id, area, label, note }) {
  return { id, area, label, value: null, unavailable: true, zeroReported: false,
    coverageNote: note ?? 'Not projected — unknown stays unknown; it never renders as zero or healthy.', records: [] };
}

// A metric value from a T10 result. `null` totals (unknown) render unavailable;
// an explicit computed/reported zero stays zero and is labeled as reported.
function valueMetric({ id, area, label, value, unit, definition, basis, records = [], coverage = null, coverageNote = null, zeroNote = 'reported zero — zero requires an explicit reported zero' }) {
  const unknown = value === null || value === undefined;
  return { id, area, label,
    value: unknown ? null : value,
    unavailable: unknown,
    zeroReported: !unknown && value === 0,
    zeroNote: !unknown && value === 0 ? zeroNote : null,
    unit, definition, basis, records, coverage, coverageNote };
}

function timeMetrics(time, context) {
  if (time == null) {
    return ['elapsed', 'wall', 'agent', 'peak'].map(name => unavailableMetric({
      id: `metric:time:${name}`,
      area: 'time',
      label: { elapsed: 'Elapsed run time', wall: 'Observed execution wall time',
        agent: 'Recorded agent time', peak: 'Peak concurrency' }[name],
      note: 'Time accounting not projected (no T10 result supplied).',
    }));
  }
  const records = time.source_record_ids ?? [];
  const recordsNote = records.length ? null : 'contributing interval records not supplied';
  const metrics = [
    valueMetric({ id: 'metric:time:elapsed', area: 'time', label: 'Elapsed run time',
      value: time.elapsed_minutes, unit: 'minutes',
      definition: 'window end minus start (or as-of minus start); includes waiting',
      basis: `T10 accountTime · ${time.basis?.definition ?? 'window arithmetic'}`, records, coverageNote: recordsNote }),
    valueMetric({ id: 'metric:time:wall', area: 'time', label: 'Observed execution wall time',
      value: time.observed_execution_wall_minutes, unit: 'minutes',
      definition: 'union of observed execution intervals; parallel agents add once',
      basis: `T10 accountTime · union of intervals`, records, coverageNote: recordsNote,
      zeroNote: 'zero-length union of observed execution intervals (no intervals recorded)' }),
    valueMetric({ id: 'metric:time:agent', area: 'time', label: 'Recorded agent time',
      value: time.recorded_agent_minutes, unit: 'minutes',
      definition: 'sum over distinct agents of each agent interval union; parallel agents add to agent time but not wall time',
      basis: 'T10 accountTime · per-agent unions summed', records, coverageNote: recordsNote,
      zeroNote: 'zero-length per-agent unions (no intervals recorded)' }),
    valueMetric({ id: 'metric:time:peak', area: 'time', label: 'Peak concurrency',
      value: time.peak_concurrency, unit: 'agents',
      definition: 'maximum number of simultaneously open observed intervals in the window',
      basis: 'T10 accountTime · sweep-line depth', records, coverageNote: recordsNote,
      zeroNote: 'no overlapping or open intervals in the window' }),
    valueMetric({ id: 'metric:time:distinct-agents', area: 'time', label: 'Distinct agents',
      value: time.distinct_agents, unit: 'agents',
      definition: 'distinct agent identities with at least one recorded interval',
      basis: 'T10 accountTime · interval identities', records, coverageNote: recordsNote }),
  ];
  if (time.recorded_session_minutes != null) {
    metrics.push(valueMetric({ id: 'metric:time:session', area: 'time',
      label: `Recorded session duration (${time.session_duration_label ?? 'recorded-session-duration'})`,
      value: time.recorded_session_minutes, unit: 'minutes',
      definition: 'sum of recorded session-boundary durations; labeled recorded-session-duration, never agent time',
      basis: 'T10 accountTime · session durations', records, coverageNote: recordsNote }));
  }
  return metrics.map(metric => stamped(metric, context));
}

function usageMetrics(usage, context) {
  if (usage == null) {
    return ['input', 'output', 'total', 'requests'].map(name => unavailableMetric({
      id: `metric:usage:${name}`,
      area: 'usage',
      label: { input: 'Input tokens', output: 'Output tokens', total: 'Total tokens', requests: 'Reported request coverage' }[name],
      note: 'Usage accounting not projected (no T10 result supplied).',
    }));
  }
  const requestRecords = usage.requests.map(request => request.request_id);
  const sourceRecords = usage.requests.flatMap(request => request.source_record_ids);
  const labels = { input_tokens: 'Input tokens', output_tokens: 'Output tokens', total_tokens: 'Total tokens' };
  const metrics = [];
  for (const [field, total] of Object.entries(usage.totals ?? {})) {
    metrics.push(valueMetric({ id: `metric:usage:${field}`, area: 'usage', label: labels[field] ?? field,
      value: total, unit: 'tokens',
      definition: `normalized total at declared grain ${usage.grain ?? 'physical-provider-invocation'}; unknown stays null`,
      basis: 'T10 normalizeUsage · duplicate delivery is not a new request; parent aggregates never sum with children',
      records: [...requestRecords, ...sourceRecords],
      coverageNote: total === null ? 'unknown (null) — not zero' : null }));
  }
  const { requests_with_usage, distinct_request_ids } = usage.coverage ?? {};
  metrics.push(valueMetric({ id: 'metric:usage:coverage', area: 'usage', label: 'Reported request coverage',
    value: requests_with_usage ?? null, unit: 'requests',
    definition: 'usage reported for N of M recorded requests; this does not establish that a share of tokens was captured',
    basis: 'T10 normalizeUsage coverage',
    records: requestRecords,
    coverage: distinct_request_ids != null ? { reported: requests_with_usage, total: distinct_request_ids } : null,
    coverageNote: distinct_request_ids == null
      ? 'denominator unknown — stated, not invented' : `usage reported for ${requests_with_usage} of ${distinct_request_ids} recorded requests; the totals cover only the reporting requests` }));
  if (usage.parent_aggregate_requests_excluded?.length) {
    metrics.push(valueMetric({ id: 'metric:usage:parent-excluded', area: 'usage', label: 'Parent aggregates excluded from totals',
      value: usage.parent_aggregate_requests_excluded.length, unit: 'requests',
      definition: 'parent aggregate requests are displayed separately and never summed with their child records',
      basis: 'T10 normalizeUsage · parent/child no-double-count',
      records: usage.parent_aggregate_requests_excluded }));
  }
  return metrics.map(metric => stamped(metric, context));
}

// The §8.1 subset fixture view: declared subsets render as subsets of their
// category and are never added again (100 incl. cached 40 + 50 incl.
// reasoning 20 totals 150, not 210).
function subsetMetrics(subsets, context) {
  if (subsets == null) return [];
  const records = subsets.source_record_ids ?? [];
  const subsetNote = (label, subset, total) => subset == null ? null
    : `${label} ${subset} is a subset of the ${total} total — displayed as a subset, never added again`;
  return [
    valueMetric({ id: 'metric:usage:subsets:input', area: 'usage', label: 'Input tokens (incl. declared subset)',
      value: subsets.input_total, unit: 'tokens', definition: 'provider input total; already includes its declared cached subset',
      basis: 'T10 usageWithSubsets · declared subset categories', records,
      coverageNote: subsetNote('cached', subsets.cached_input, subsets.input_total) }),
    valueMetric({ id: 'metric:usage:subsets:output', area: 'usage', label: 'Output tokens (incl. declared subset)',
      value: subsets.output_total, unit: 'tokens', definition: 'provider output total; already includes its declared reasoning subset',
      basis: 'T10 usageWithSubsets · declared subset categories', records,
      coverageNote: subsetNote('reasoning', subsets.reasoning_output, subsets.output_total) }),
    valueMetric({ id: 'metric:usage:subsets:total', area: 'usage', label: 'Total tokens (subsets never added again)',
      value: subsets.total_tokens, unit: 'tokens',
      definition: `input total + output total; ${subsets.subset_rule}`,
      basis: 'T10 usageWithSubsets', records,
      coverageNote: subsets.total_tokens === null ? 'unknown (null) — not zero' : null }),
  ].map(metric => stamped(metric, context));
}

// Git/CI COUNT metrics only. The stage tables, dirty bindings and PR subject
// fields render in the Git pane — the two panes stay visually distinct so a
// Git stage can never read as a token count or vice versa.
function gitCountMetrics(git) {
  if (git == null || git.status !== 'observed') {
    return [unavailableMetric({ id: 'metric:git:changed-paths', area: 'git-ci', label: 'Changed paths (union across worktrees)',
      note: `Git facts unavailable (${git?.unavailableReason ?? 'no git model supplied'}); not zero and not clean.` })];
  }
  const observedWorktrees = git.worktrees.filter(worktree => worktree.status === 'observed');
  const unionTotal = observedWorktrees.reduce((sum, worktree) => sum + (worktree.uncommitted.counts?.union ?? 0), 0);
  const unmergedTotal = observedWorktrees.reduce((sum, worktree) => sum + (worktree.uncommitted.counts?.unmerged ?? 0), 0);
  const truncated = observedWorktrees.some(worktree => worktree.uncommitted.counts?.truncated);
  const worktreeRecords = observedWorktrees.map(worktree => worktree.recordId ?? worktree.id);
  const metrics = [
    valueMetric({ id: 'metric:git:worktrees', area: 'git-ci', label: 'Worktrees observed',
      value: observedWorktrees.length, unit: 'worktrees',
      definition: 'observed worktrees of the repository (T11 worktree list)',
      basis: 'T11 collectLocalGitFacts',
      records: worktreeRecords,
      coverage: git.coverage ? { reported: git.coverage.worktrees_reported, total: git.coverage.worktrees_total } : null,
      coverageNote: git.coverage?.worktrees_truncated ? 'worktree list truncated at the collector limit' : null }),
    valueMetric({ id: 'metric:git:changed-paths', area: 'git-ci', label: 'Changed paths (union across worktrees)',
      value: unionTotal, unit: 'paths',
      definition: 'per worktree the union of staged/unstaged/untracked/unmerged (one path with staged+unstaged changes counts once), summed across distinct worktrees',
      basis: 'T11 collectLocalGitFacts · union path counting', records: worktreeRecords,
      coverageNote: truncated ? 'at least one worktree path list was truncated; counts stay exact' : null }),
    valueMetric({ id: 'metric:git:unmerged', area: 'git-ci', label: 'Actual unmerged index paths',
      value: unmergedTotal, unit: 'paths',
      definition: 'actual unmerged index state — the only class that is a real Git conflict',
      basis: 'T11 collectLocalGitFacts · actual_unmerged_index', records: worktreeRecords,
      zeroNote: 'no unmerged index paths observed (exact zero)' }),
    valueMetric({ id: 'metric:git:binary-counts', area: 'git-ci', label: 'Binary diff line counts',
      value: null, unit: 'lines', definition: 'line counts for binary diffs',
      basis: 'T11 collectLocalGitFacts · binary_diff_counts',
      records: worktreeRecords, coverageNote: 'unavailable — binary line counts are labeled unavailable where appropriate' }),
  ];
  const pr = git.pullRequests;
  metrics.push(pr.status === 'observed'
    ? valueMetric({ id: 'metric:git:open-prs', area: 'git-ci', label: 'Observed pull requests',
      value: pr.list.length, unit: 'pull requests', definition: 'PRs listed by the gh collector for the observed remote',
      basis: 'T11 collectRemoteFacts', records: pr.list.map(entry => `pr:${entry.number}`),
      coverage: pr.coverage, coverageNote: pr.coverage?.total == null ? 'list hit the collector limit; denominator unknown' : null })
    : unavailableMetric({ id: 'metric:git:open-prs', area: 'git-ci', label: 'Observed pull requests',
      note: `Remote PR observation unavailable (${pr.reason}); this is not zero pull requests.` }));
  return metrics;
}

// Full metric drill-down document (spec §8 table): every metric carries
// repository/runtime scope, optional filters, a time window, definition, unit,
// basis, source records, coverage, as-of time and projection revision.
export function metricsDetailModel({ scope, filters = [], window: usageWindow = null, asOf,
  projectionRevision = null, accounting = {}, git = null }) {
  if (scope == null || asOf == null) throw new Error('SCOPE_AND_AS_OF_REQUIRED');
  const context = { scope, filters, window: usageWindow, asOf, projectionRevision };
  const time = accounting.time ?? null;
  const usage = accounting.usage ?? null;
  const subsets = accounting.subsets ?? null;
  const sections = [
    { id: 'metrics:time', title: 'Time accounting', kind: 'time',
      note: 'Elapsed/wall/agent per spec §8.1 — Git stages never appear in this section.',
      metrics: timeMetrics(time, context) },
    { id: 'metrics:usage', title: 'Token usage', kind: 'usage',
      note: 'Normalized at the declared grain; declared subsets render as subsets; unallocated usage stays visible rather than being invented onto plans.',
      metrics: [...usageMetrics(usage, context), ...subsetMetrics(subsets, context)] },
    { id: 'metrics:git-ci', title: 'Git and CI (counts)', kind: 'git-ci',
      note: 'Count summaries only — stage tables, dirty bindings and PR/CI subjects render in the Git pane, never here.',
      metrics: gitCountMetrics(git).map(metric => stamped(metric, context)) },
  ];
  return { viewId: 'metrics-detail', asOf, scope, filters, window: usageWindow, projectionRevision, sections };
}

export { formatMinutes, shortOid, stableKey };
