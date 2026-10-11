// T14 Overview projection adapter — a PURE read-only composition over already
// projected project records (projectSnapshot + T07 graph edges/readiness/
// progress + T10 usage/time + T11 git facts). It never reads files, never
// fetches, never schedules and never mutates its inputs; every displayed value
// carries the identities of the records that produced it so the view can open
// them. Presentation vocabulary reuses the T03 spike model (project-presentation).
export class OverviewProjectionError extends Error {
  constructor(code, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'OverviewProjectionError';
    this.code = code;
  }
}

// Spec §5 display grouping, kept in one place: live execution (active/paused),
// future work (draft/planned) and retained history. This mirrors the T07
// progress buckets; only the vocabulary lives here because the dashboard core
// must not import the project core at distribution time.
const LIFECYCLE_GROUPS = Object.freeze({ active: 'active', paused: 'active', draft: 'future', planned: 'future',
  completed: 'historical', superseded: 'historical', abandoned: 'historical' });
const lifecycleGroup = lifecycle => {
  const group = LIFECYCLE_GROUPS[lifecycle];
  if (!group) throw new OverviewProjectionError('UNKNOWN_LIFECYCLE', lifecycle);
  return group;
};

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const chip = (state, label) => ({ state, label });
const unique = values => [...new Set(values)];

function assertSnapshot(snapshot) {
  if (!isPlainObject(snapshot)) throw new OverviewProjectionError('SNAPSHOT_REQUIRED', 'overviewFixture needs a project snapshot');
  for (const field of ['project_id', 'plans', 'items', 'summary']) {
    if (!(field in snapshot)) throw new OverviewProjectionError('SNAPSHOT_SHAPE', `snapshot.${field} is required`);
  }
  if (!Array.isArray(snapshot.plans) || !Array.isArray(snapshot.items) || !isPlainObject(snapshot.summary)) {
    throw new OverviewProjectionError('SNAPSHOT_SHAPE', 'snapshot collections must be arrays and summary an object');
  }
}

// T11 observed local-git facts: count changed paths as one global union — a
// path staged AND unstaged, or changed in two worktrees, counts once.
function gitChangedPathCount(git) {
  if (!git || git.status !== 'observed') return null;
  const paths = new Set();
  for (const worktree of git.worktrees ?? []) {
    if (worktree.status !== 'observed' || !worktree.changed) continue;
    for (const group of ['staged', 'unstaged', 'untracked', 'unmerged']) {
      for (const entry of worktree.changed[group]?.paths ?? []) paths.add(typeof entry === 'string' ? entry : entry.path);
    }
  }
  return paths.size;
}

function gitCurrentWorktree(git) {
  if (!git || git.status !== 'observed') return null;
  return (git.worktrees ?? []).find(worktree => worktree.current && worktree.status === 'observed') ?? null;
}

function planVerificationChips(plan, readiness) {
  if (plan.stale_item_ids?.length) return chip('stale', `${plan.stale_item_ids.length} stale baseline references`);
  const assessment = readiness?.[plan.id];
  if (!assessment) return chip('unavailable', 'Readiness not projected');
  const { required, satisfied } = assessment.criteria ?? { required: 0, satisfied: 0 };
  if (!required) return chip('unavailable', 'No required criteria recorded');
  if (satisfied < required) return chip('attention', `${satisfied} of ${required} criteria satisfied`);
  return chip('verified', `${required} criteria satisfied`);
}

function gateCheckChildren(plan, readiness) {
  const assessment = readiness?.[plan.id];
  const entries = assessment?.criteria?.entries;
  if (!entries?.length) return undefined;
  return entries.map(entry => ({
    id: `${plan.id}#criterion:${entry.task_id}:${entry.criterion_id}`,
    kind: 'gate-check',
    title: `Check — ${entry.criterion_id} (${entry.task_id})`,
    summary: `Required criterion at revision ${entry.revision}.`,
    execution: chip('neutral', 'Recorded'),
    verification: entry.status === 'satisfied' ? chip('verified', `Satisfied at revision ${entry.revision}`)
      : entry.status === 'stale-criterion-revision' ? chip('stale', 'Stale after criterion change')
        : chip('attention', `Pending at revision ${entry.revision}`),
    meta: 'Gate check',
  }));
}

function formatMinutes(value) {
  if (value == null) return 'unknown';
  return `${Number(value.toFixed ? value.toFixed(1) : value)} min`;
}

export function overviewFixture(bundle) {
  if (bundle === null || bundle === undefined) throw new OverviewProjectionError('SNAPSHOT_REQUIRED', 'overviewFixture composes a project snapshot');
  if (typeof bundle !== 'object' || Array.isArray(bundle)) throw new OverviewProjectionError('BUNDLE_REQUIRED', 'overviewFixture composes a projection bundle');
  const snapshot = bundle.snapshot;
  assertSnapshot(snapshot);
  const planIds = new Set(snapshot.plans.map(plan => plan.id));
  const itemById = new Map(snapshot.items.map(item => [item.id, item]));
  const readiness = bundle.readiness ?? {};
  for (const planId of Object.keys(readiness)) {
    if (!planIds.has(planId)) throw new OverviewProjectionError('UNKNOWN_PLAN', `readiness references ${planId}`);
  }
  const planEdges = bundle.planEdges ?? [];
  for (const edge of planEdges) {
    if (!planIds.has(edge.from_plan_id)) throw new OverviewProjectionError('UNKNOWN_PLAN', `edge ${edge.id} references ${edge.from_plan_id}`);
    if (edge.to_plan_id != null && !planIds.has(edge.to_plan_id)) throw new OverviewProjectionError('UNKNOWN_PLAN', `edge ${edge.id} references ${edge.to_plan_id}`);
    if (edge.item_id != null && !itemById.has(edge.item_id)) throw new OverviewProjectionError('UNKNOWN_ITEM', `edge ${edge.id} references ${edge.item_id}`);
  }
  const externalPrerequisites = bundle.external_prerequisites ?? [];
  for (const prerequisite of externalPrerequisites) {
    if (!planIds.has(prerequisite.plan_id)) throw new OverviewProjectionError('UNKNOWN_PLAN', `external prerequisite references ${prerequisite.plan_id}`);
    if (!itemById.has(prerequisite.item_id)) throw new OverviewProjectionError('UNKNOWN_ITEM', `external prerequisite references ${prerequisite.item_id}`);
  }

  const plansByGroup = { active: [], future: [], historical: [] };
  for (const plan of snapshot.plans) plansByGroup[lifecycleGroup(plan.declared_lifecycle)].push(plan);

  const pendingProposals = (snapshot.proposals ?? []).filter(proposal => proposal.state === 'proposed');
  const acceptedItems = snapshot.items.filter(item => item.state === 'accepted');

  const nodes = [];
  const edges = [];
  const seenEdges = new Set();
  const nodeIds = new Set();
  const addNode = node => { nodeIds.add(node.id); nodes.push(node); };
  const addEdge = (from, to, kind, label) => {
    // Edges may only connect rendered nodes: a proposal citing a non-feature
    // baseline item (no feature-area node) simply skips that visual edge.
    if (from === to || !nodeIds.has(from) || !nodeIds.has(to) || seenEdges.has(key(from, to, kind))) return;
    seenEdges.add(key(from, to, kind));
    edges.push({ from, to, kind, label });
  };
  const key = (from, to, kind) => `${from}\u0000${to}\u0000${kind}`;

  // Durable feature areas from accepted feature items.
  for (const item of acceptedItems.filter(entry => entry.kind === 'feature')) {
    const contributors = item.contributing_plan_ids ?? [];
    const activeContributor = contributors.some(planId => plansByGroup.active.some(plan => plan.id === planId));
    addNode({
      id: item.id, kind: 'feature-area', title: item.title,
      summary: `${item.text ? item.text.slice(0, 140) : 'Accepted feature definition.'}`,
      execution: activeContributor ? chip('active', 'Active plan contributing') : chip('neutral', `${contributors.length} contributing plan${contributors.length === 1 ? '' : 's'}`),
      verification: ['changed', 'missing'].includes(item.source_freshness) ? chip('stale', 'Source changed after acceptance') : chip('unavailable', 'No verification fact projected'),
      meta: contributors.length ? contributors.join(', ') : 'No contributing plan (unassigned)',
    });
  }

  // Plans with their criterion gate checks as collapsible groups.
  for (const plan of snapshot.plans) {
    const children = gateCheckChildren(plan, readiness);
    addNode({
      id: plan.id, kind: 'plan',
      title: plan.preparation ? `${plan.title} (${plan.preparation})` : plan.title,
      summary: `Lifecycle: ${plan.declared_lifecycle}. ${plan.stale_item_ids?.length ? `${plan.stale_item_ids.length} baseline references stale.` : `Baseline references ${plan.baseline_reference_status}.`}`,
      execution: plan.declared_lifecycle === 'active' ? chip('active', 'Lifecycle: active')
        : plan.declared_lifecycle === 'paused' ? chip('attention', 'Lifecycle: paused (reason recorded)')
          : chip('neutral', `Lifecycle: ${plan.declared_lifecycle}`),
      verification: planVerificationChips(plan, readiness),
      meta: `${plan.native_runs?.length ?? 0} linked native run${(plan.native_runs?.length ?? 0) === 1 ? '' : 's'} · revision ${plan.revision}`,
      collapsed: true,
      ...(children ? { children } : {}),
    });
  }

  // Typed T07 inter-plan edges. Only the declared execution dependencies gate;
  // other relationships render as non-execution grouping edges.
  for (const edge of planEdges) {
    if (edge.kind === 'contributes-to-feature') {
      addEdge(edge.item_id, edge.from_plan_id, 'group', edge.note ? `contributes to feature · ${edge.note}` : 'contributes to feature');
    } else if (edge.kind === 'depends-on-specific-outcome' || edge.kind === 'depends-on-gate') {
      addEdge(edge.from_plan_id, edge.to_plan_id, 'dependency', `${edge.kind} · ${edge.note ?? 'declared execution prerequisite'}`);
    } else if (edge.kind === 'supersedes') {
      addEdge(edge.from_plan_id, edge.to_plan_id, 'history', 'supersession link');
    } else {
      addEdge(edge.from_plan_id, edge.to_plan_id, 'group', `${edge.kind} · not an execution edge`);
    }
  }

  // External decision prerequisites terminate at labeled boundary nodes.
  for (const prerequisite of externalPrerequisites) {
    const item = itemById.get(prerequisite.item_id);
    addNode({
      id: `boundary:${prerequisite.item_id}`, kind: 'boundary',
      title: `External — decision ${prerequisite.item_id} at revision ${prerequisite.item_revision}`,
      summary: `${item?.title ?? ''} An accepted external decision gates downstream admission; the dashboard observes it, it does not own it.`.trim(),
      execution: chip('unavailable', 'External'),
      verification: chip('unavailable', 'Decision outcome unknown here'),
      meta: 'Boundary node',
    });
    addEdge(`boundary:${prerequisite.item_id}`, prerequisite.plan_id, 'external', 'external decision accepted prerequisite');
  }

  // Pending proposals (T06) and unresolved reconciliations (T08) are the
  // durable attention items; they stay proposals until accepted through
  // authority and never resolve themselves in a view.
  for (const proposal of pendingProposals) {
    addNode({
      id: proposal.id, kind: 'conflict',
      title: `Pending baseline proposal — ${proposal.summary}`,
      summary: `${proposal.unresolved ?? 'Unresolved decision attached.'} Remains a proposal until accepted through the shared authority.`,
      execution: chip('attention', 'Open · decision pending'),
      verification: chip('unavailable', 'Not applicable'),
      meta: 'Attention queue item',
    });
    for (const planId of proposal.impact?.plan_ids ?? []) addEdge(proposal.id, planId, 'conflict', 'proposal impacts plan');
    for (const itemId of proposal.impact?.item_ids ?? []) addEdge(proposal.id, itemId, 'conflict', 'proposal cites baseline item');
  }

  const activePlanIds = plansByGroup.active.map(plan => plan.id);
  const blockingPlans = snapshot.plans.filter(plan => plan.stale_item_ids?.length
    || (readiness[plan.id]?.criteria?.required ?? 0) > (readiness[plan.id]?.criteria?.satisfied ?? 0));
  const changedPaths = gitChangedPathCount(bundle.git);
  const currentWorktree = gitCurrentWorktree(bundle.git);
  const observedWorktrees = (bundle.git?.worktrees ?? []).filter(worktree => worktree.status === 'observed');

  const statement = bundle.statement ?? {
    text: `${bundle.project_name ?? snapshot.project_id}: repository ${snapshot.repository_key} under ${snapshot.runtime}; `
      + `${snapshot.summary.accepted_requirements} accepted requirements; ${snapshot.summary.plan_count} plans `
      + `(${plansByGroup.active.length} active, ${plansByGroup.future.length} future, ${plansByGroup.historical.length} historical).`,
    coverage: 'Derived from the accepted project projection only; absence of a finding is not project health.',
  };

  const statusSentence = { text: '', clauses: [] };
  const clause = (id, text, ref, records, unavailable = false) => statusSentence.clauses.push({ id, text, ref, records, unavailable });
  if (activePlanIds.length) clause('clause:delivery', `declared active plan: ${activePlanIds[0]}`, activePlanIds[0], activePlanIds);
  for (const planId of activePlanIds.filter(id => readiness[id] == null)) {
    clause(`clause:readiness:${planId}`, `readiness not projected for ${planId}`, planId, [], true);
  }
  if (pendingProposals.length) {
    clause('clause:decisions', `${pendingProposals.length} baseline decision${pendingProposals.length === 1 ? '' : 's'} pending`, pendingProposals[0].id, pendingProposals.map(proposal => proposal.id));
  }
  for (const plan of blockingPlans) {
    const records = unique([...(plan.stale_item_ids ?? []),
      ...(readiness[plan.id]?.criteria?.entries ?? []).filter(entry => !entry.satisfied).map(entry => `criterion:${entry.criterion_id}@${entry.revision}`)]);
    clause(`clause:gate:${plan.id}`, `verification gate blocking ${plan.id}`, plan.id, records.length ? records : [plan.id]);
  }
  if (changedPaths != null && changedPaths > 0) {
    clause('clause:git', `Git changes not yet committed (${changedPaths} changed path${changedPaths === 1 ? '' : 's'})`, null, observedWorktrees.map(worktree => `worktree:${worktree.branch ?? worktree.root}`));
  }
  if (bundle.git == null || bundle.git.status !== 'observed') {
    clause('clause:git', 'Git observation not projected', null, [], true);
  }
  statusSentence.text = statusSentence.clauses.map(entry => entry.text).join('; ') + '.';

  const usage = bundle.usage;
  const usageTotals = usage?.totals ?? {};
  const inputTokens = usageTotals.input_tokens ?? null;
  const outputTokens = usageTotals.output_tokens ?? null;
  const totalTokens = inputTokens == null && outputTokens == null ? null : (inputTokens ?? 0) + (outputTokens ?? 0);
  const time = bundle.time;

  const metrics = [
    { id: 'metric:plans', label: 'Plans', value: `${plansByGroup.active.length} active · ${plansByGroup.future.length} future · ${plansByGroup.historical.length} historical`,
      coverage: 'declared plan lifecycle counts', records: snapshot.plans.map(plan => plan.id) },
    { id: 'metric:active-progress', label: 'Active delivery', value: bundle.progress ? `${bundle.progress.summary.active_satisfied} of ${bundle.progress.summary.active_required} obligations satisfied` : null,
      coverage: bundle.progress ? 'unique required tasks and criteria among active plans' : 'progress not projected',
      records: bundle.progress ? bundle.progress.plans.active : [] },
    { id: 'metric:baseline', label: 'Accepted baseline', value: `${snapshot.summary.accepted_features} features · ${snapshot.summary.accepted_requirements} requirements · ${snapshot.summary.accepted_principles} principles · ${snapshot.summary.accepted_decisions} decisions`,
      coverage: `accepted baseline revision ${snapshot.baseline_revision}`, records: acceptedItems.map(item => item.id) },
    { id: 'metric:unassigned', label: 'Unassigned requirements', value: `${snapshot.summary.unassigned_item_ids.length} accepted requirement${snapshot.summary.unassigned_item_ids.length === 1 ? '' : 's'} without a plan`,
      coverage: snapshot.summary.unassigned_item_ids.length ? 'accepted items with no contributing plan' : 'none unassigned (exact zero)',
      records: snapshot.summary.unassigned_item_ids },
    { id: 'metric:usage', label: 'Usage', value: usage ? `${totalTokens} tokens · ${usage.coverage.requests_with_usage} of ${usage.coverage.distinct_request_ids} requests reported` : null,
      coverage: usage ? 'declared subsets never add to totals' : 'usage not projected',
      records: usage ? usage.requests.map(request => request.request_id) : [] },
    { id: 'metric:time', label: 'Time', value: time ? `${formatMinutes(time.elapsed_minutes)} elapsed · ${formatMinutes(time.observed_execution_wall_minutes)} wall · ${formatMinutes(time.recorded_agent_minutes)} agent · peak ${time.peak_concurrency}` : null,
      coverage: time ? (time.source_record_ids?.length ? 'observed intervals per distinct agent' : 'contributing interval records not supplied') : 'time accounting not projected',
      records: time?.source_record_ids ?? [] },
    { id: 'metric:git', label: 'Git', value: changedPaths != null ? `${changedPaths} changed path${changedPaths === 1 ? '' : 's'} · ${observedWorktrees.length} worktree${observedWorktrees.length === 1 ? '' : 's'}` : null,
      coverage: changedPaths != null ? 'local Git facts, union across observed worktrees' : 'git facts not projected',
      records: observedWorktrees.map(worktree => `worktree:${worktree.branch ?? worktree.root}`) },
  ];
  for (const metric of metrics) if (metric.value == null) { metric.unavailable = true; metric.value = 'unavailable'; }

  const attentionQueue = [];
  for (const proposal of pendingProposals) {
    attentionQueue.push({ id: `queue:proposal:${proposal.id}`, kind: 'proposal', title: `Baseline decision pending — ${proposal.summary}`,
      detail: proposal.unresolved ?? 'Unresolved decision attached.',
      records: unique([proposal.id, ...(proposal.impact?.plan_ids ?? []), ...(proposal.impact?.item_ids ?? [])]) });
  }
  for (const reconciliation of snapshot.reconciliations ?? []) {
    if (!reconciliation.unresolved_proposal_ids?.length) continue;
    attentionQueue.push({ id: `queue:reconciliation:${reconciliation.id}`, kind: 'reconciliation', title: `Reconciliation open — ${reconciliation.id}`,
      detail: `${reconciliation.unresolved_proposal_ids.length} unresolved proposal${reconciliation.unresolved_proposal_ids.length === 1 ? '' : 's'}.`,
      records: unique([reconciliation.id, ...reconciliation.unresolved_proposal_ids]) });
  }
  for (const plan of snapshot.plans) {
    if (!plan.stale_item_ids?.length) continue;
    attentionQueue.push({ id: `queue:stale:${plan.id}`, kind: 'stale-baseline', title: `Stale baseline references — ${plan.id}`,
      detail: `References moved past revisions: ${plan.stale_item_ids.join(', ')}.`,
      records: unique([plan.id, ...plan.stale_item_ids]) });
  }
  for (const [planId, assessment] of Object.entries(readiness)) {
    if (!assessment?.blockers?.length) continue;
    attentionQueue.push({ id: `queue:readiness:${planId}`, kind: 'blocked-readiness', title: `Readiness blocked — ${planId}`,
      detail: assessment.blockers.map(blocker => blocker.code).join(', '),
      records: unique([planId, ...assessment.blockers.map(blocker => blocker.code)]) });
  }

  return {
    viewId: 'overview', level: 'project', docId: `overview:${snapshot.project_id}`,
    title: bundle.project_name ?? snapshot.project_id,
    subtitle: 'Macro map · durable feature areas, plans, inter-plan dependencies and attention (read-only projection)',
    statement, nodes, edges, statusSentence, metrics, attentionQueue,
    context: bundle.context ?? (currentWorktree ? { branch: currentWorktree.branch, head: currentWorktree.head,
      observed_at: bundle.git.observed_at } : null),
    projection: { project_id: snapshot.project_id, runtime: snapshot.runtime, repository_key: snapshot.repository_key,
      revision: snapshot.revision, baseline_revision: snapshot.baseline_revision, observation_revision: snapshot.observation_revision },
  };
}
