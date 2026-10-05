import { assertProjectState, assertProjectionOptions, fail } from './contract.mjs';

const clone = value => JSON.parse(JSON.stringify(value));
const runKey = value => JSON.stringify([value.runtime, value.native_project_id, value.run_id]);

export function projectSnapshot(state, options = {}) {
  assertProjectState(state); assertProjectionOptions(options);
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
  const accepted = items.filter(item => item.state === 'accepted');
  return { schema_version: 1, project_id: state.project_id, runtime: state.runtime,
    repository_key: state.repository_key, revision: state.revision, baseline_revision: state.baseline_revision,
    sources, items, plans, summary: {
      accepted_features: accepted.filter(item => item.kind === 'feature').length,
      accepted_principles: accepted.filter(item => item.kind === 'principle').length,
      accepted_requirements: accepted.filter(item => item.kind === 'requirement').length,
      accepted_decisions: accepted.filter(item => item.kind === 'decision').length,
      plan_count: plans.length,
      unassigned_item_ids: accepted.filter(item => item.contributing_plan_ids.length === 0).map(item => item.id),
    }, issues };
}
