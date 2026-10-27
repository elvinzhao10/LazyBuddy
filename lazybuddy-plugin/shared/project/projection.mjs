import { assertProjectState, assertProjectionOptions, fail } from './contract.mjs';
import { sha256Text } from './history.mjs';

const clone = value => JSON.parse(JSON.stringify(value));
const runKey = value => JSON.stringify([value.runtime, value.native_project_id, value.run_id]);

export function projectSnapshot(state, options = {}) {
  assertProjectState(state); assertProjectionOptions(options);
  const identity = options.identity ?? null;
  const sourceById = new Map(state.sources.map(source => [source.id, source]));
  const observations = new Map((options.sourceObservations ?? []).map(value => [value.source_id, value]));
  for (const observation of observations.values()) {
    if (!sourceById.has(observation.source_id)) fail('UNKNOWN_SOURCE', 'An observation references an unregistered source');
  }
  const runObservations = new Map((options.runObservations ?? []).map(value => [runKey(value), value]));
  for (const observation of runObservations.values()) {
    if (observation.runtime !== state.runtime) fail('FOREIGN_RUNTIME', 'A run observation belongs to another runtime');
  }
  const issues = [];
  function sourceStatus(sourceId, acceptedHash) {
    const source = sourceById.get(sourceId); const observation = observations.get(sourceId);
    if (!observation) return 'unobserved';
    if (observation.status !== 'available') return observation.status;
    return observation.sha256 === acceptedHash && (!observation.path || observation.path === source.path) ? 'current' : 'changed';
  }
  const sources = state.sources.map(source => {
    const observation = observations.get(source.id);
    const status = sourceStatus(source.id, source.accepted_sha256);
    if (status !== 'current') issues.push({ code: `SOURCE_${status.toUpperCase()}`, subject_id: source.id, source_id: source.id });
    return { ...clone(source), observation: { status, sha256: observation?.sha256 ?? null,
      path: observation?.path ?? null, observed_at: observation?.observed_at ?? null } };
  });
  const itemById = new Map(state.items.map(item => [item.id, item]));
  const plans = state.plans.map(plan => {
    const stale = plan.baseline_refs.filter(reference => itemById.get(reference.item_id).revision !== reference.item_revision).map(reference => reference.item_id);
    const referenceStatus = stale.length ? 'stale' : plan.baseline_refs.length ? 'current' : 'unassessed';
    if (stale.length) issues.push({ code: 'STALE_BASELINE_REFERENCES', subject_id: plan.id, source_id: plan.source.source_id });
    return { ...clone(plan), alignment: 'unassessed', baseline_reference_status: referenceStatus,
      stale_item_ids: stale, source_freshness: sourceStatus(plan.source.source_id, plan.source.sha256),
      native_observations: plan.native_runs.map(reference => runObservations.get(runKey(reference))).filter(Boolean).map(clone) };
  });
  const items = state.items.map(item => ({ ...clone(item), source_freshness: sourceStatus(item.source.source_id, item.source.sha256),
    contributing_plan_ids: state.plans.filter(plan => plan.baseline_refs.some(reference => reference.item_id === item.id)).map(plan => plan.id) }));
  const retainedObservations = (state.observations ?? []).map(clone);
  const architecture = (state.architecture ?? []).map(element => ({ ...clone(element),
    observed_via_observation_ids: retainedObservations.filter(observation => observation.subject.kind === 'architecture'
      && observation.subject.id === element.id).map(observation => observation.id) }));
  const accepted = items.filter(item => item.state === 'accepted');
  // Invalidation facts retained by accepted amendments: the exact plan
  // relationships a behavioral baseline change invalidated. Carried-forward
  // references moved in the same transaction; the rest stay pending until
  // reconciliation (T08) assesses them. Historical plans keep their considered
  // revisions here — their completion is never reopened.
  const invalidations = state.receipts.flatMap(entry => (entry.receipt.invalidations ?? []).map(fact => ({
    command_id: entry.command.command_id, occurred_at: entry.receipt.occurred_at,
    item_id: fact.item_id, from_revision: fact.from_revision, to_revision: fact.to_revision,
    reason: fact.reason, affected: fact.affected.map(entry => ({ plan_id: entry.plan_id,
      considered_revision: entry.considered_revision, carried_forward: entry.carried_forward })),
  })));
  const snapshot = { schema_version: 1, project_id: state.project_id, runtime: state.runtime,
    repository_key: identity ? identity.repository_key : state.repository_key,
    revision: state.revision, baseline_revision: state.baseline_revision,
    observation_revision: state.observation_revision ?? 0,
    sources, items, plans,
    proposals: (state.proposals ?? []).map(clone), architecture, research: (state.research ?? []).map(clone),
    reconciliations: (state.reconciliations ?? []).map(clone), observations: retainedObservations,
    invalidations,
    artifacts: (state.artifacts ?? []).map(clone), requests: (state.requests ?? []).map(clone),
    summary: {
      accepted_features: accepted.filter(item => item.kind === 'feature').length,
      accepted_principles: accepted.filter(item => item.kind === 'principle').length,
      accepted_requirements: accepted.filter(item => item.kind === 'requirement').length,
      accepted_decisions: accepted.filter(item => item.kind === 'decision').length,
      plan_count: plans.length,
      unassigned_item_ids: accepted.filter(item => item.contributing_plan_ids.length === 0).map(item => item.id),
      pending_proposals: (state.proposals ?? []).filter(proposal => proposal.state === 'proposed').length,
    }, issues };
  if (identity) snapshot.identity = { repository_key: identity.repository_key, basis: identity.basis,
    legacy_repository_key: identity.legacy_repository_key ?? null };
  if (options.worktreeObservations) {
    // Worktrees of one repository share the registry identity while carrying separate
    // working revisions; without a registry each root keeps its own path-derived key.
    const shared = Boolean(identity && identity.basis === 'registry');
    snapshot.worktrees = { status: 'observed',
      identity: { basis: identity ? identity.basis : 'canonical-path',
        repository_key: identity ? identity.repository_key : state.repository_key, shared },
      entries: options.worktreeObservations.map(entry => ({ ...entry,
        ...(shared ? {} : { repository_key: `repo:${sha256Text(entry.root)}` }) })) };
  }
  return snapshot;
}
