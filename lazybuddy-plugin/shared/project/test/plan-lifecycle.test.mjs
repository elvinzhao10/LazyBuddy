import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { authorPlanGraph, composeGraphSet, plansInScope, EDGE_KINDS } from '../plans/dependencies.mjs';
import { LIFECYCLE_TRANSITIONS, assessPlanTransition, planBucket, planVisibility, derivePlanAlignment } from '../plans/lifecycle.mjs';
import { normalizeDependencyFacts, evaluateTaskGate, derivePlanReadiness, previewAdmission, recheckAdmission } from '../plans/readiness.mjs';
import { groupProgress } from '../plans/progress.mjs';

const HASH = seed => createHash('sha256').update(seed).digest('hex');
const NOW = '2026-10-06T12:00:00Z';
const LATER = '2026-10-06T12:05:00Z';

function planState(overrides = {}) {
  return {
    revision: 7, runtime: 'buddy',
    plans: [
      { id: 'plan:upstream', revision: 1, declared_lifecycle: 'active', native_runs: ['run:u1'],
        baseline_refs: [], source: { sha256: HASH('upstream') } },
      { id: 'plan:downstream', revision: 1, declared_lifecycle: 'planned', native_runs: [],
        baseline_refs: [], source: { sha256: HASH('downstream') } },
    ],
    items: [],
    ...overrides,
  };
}
function upstreamGraph(criterionRevision = 1) {
  return { schema_version: 1, plan_id: 'plan:upstream', plan_revision: 1, content_sha256: HASH('upstream'),
    tasks: [{ id: 'u1', title: 'Upstream work', criteria: [{ id: 'c1', revision: criterionRevision }], dependencies: [] }] };
}
function downstreamGraph(dependencies, join) {
  return { schema_version: 1, plan_id: 'plan:downstream', plan_revision: 1, content_sha256: HASH('downstream'),
    tasks: [{ id: 'd1', title: 'Downstream work', criteria: [{ id: 'd-c1', revision: 1 }], dependencies, join }] };
}
const verifyDep = () => ({ id: 'dep:verify', kind: 'depends-on-gate',
  condition: 'independent-verification-confirmed', gate_id: 'gate:u1-verified',
  target: { type: 'task', plan_id: 'plan:upstream', task_id: 'u1' } });
const verifyFact = (id, { value = true, criterion = { c1: 1 }, planRevision = 1, observedAt = NOW } = {}) => ({
  id, kind: 'task', condition: 'independent-verification-confirmed', value, observed_at: observedAt,
  plan_id: 'plan:upstream', task_id: 'u1',
  basis: { plan_revision: planRevision, content_sha256: HASH('upstream'), criterion_revisions: criterion },
});
const finishedFact = (id, { value = true, observedAt = NOW } = {}) => ({
  id, kind: 'task', condition: 'execution-finished', value, observed_at: observedAt,
  plan_id: 'plan:upstream', task_id: 'u1', basis: { plan_revision: 1, content_sha256: HASH('upstream') },
});

test('lifecycle transitions are typed and assessed read-only', () => {
  const state = planState();
  assert.deepEqual(LIFECYCLE_TRANSITIONS.draft, ['planned', 'superseded', 'abandoned']);
  assert.equal(assessPlanTransition(state, 'plan:upstream', 'draft').allowed, false);
  assert.equal(assessPlanTransition(state, 'plan:downstream', 'active').reasons.map(r => r.code).includes('NATIVE_RUN_REQUIRED'), true);
  assert.equal(assessPlanTransition(state, 'plan:downstream', 'superseded').reasons.map(r => r.code).includes('MISSING_FIELD'), true);
  const supersededState = planState({ plans: [...state.plans.map(p => ({ ...p })), { id: 'plan:next', revision: 1, declared_lifecycle: 'draft', native_runs: [], baseline_refs: [], source: { sha256: HASH('next') } }] });
  const ok = assessPlanTransition(supersededState, 'plan:downstream', 'superseded', { reason: 'scope moved', successor_plan_id: 'plan:next' });
  assert.equal(ok.allowed, true);
  assert.equal(assessPlanTransition(state, 'plan:missing', 'planned').reasons[0].code, 'UNKNOWN_PLAN');
  assert.equal(planBucket('planned'), 'future'); assert.equal(planBucket('active'), 'current'); assert.equal(planBucket('abandoned'), 'historical');
  const visibility = planVisibility(supersededState, ['plan:downstream']);
  const archived = visibility.entries.find(entry => entry.plan_id === 'plan:downstream');
  assert.equal(archived.archived, true); assert.equal(archived.visible_in_default_view, false);
  assert.equal(archived.bucket, 'future');
});

test('future plans never inflate active progress denominators', () => {
  const state = planState();
  const set = composeGraphSet([upstreamGraph(), downstreamGraph([verifyDep()])], { state });
  const facts = normalizeDependencyFacts([finishedFact('fact:u1-exec'), verifyFact('fact:u1-verify')]);
  const progress = groupProgress(state, set, facts, { scope: { kind: 'project' } });
  assert.deepEqual(progress.plans.active, ['plan:upstream']);
  assert.deepEqual(progress.plans.future, ['plan:downstream']);
  // Active obligations: u1 task + c1 criterion only. The planned plan's d1/d-c1
  // obligations are reported separately and never enter the active fraction.
  assert.equal(progress.summary.active_required, 2);
  assert.equal(progress.summary.active_satisfied, 2);
  assert.equal(progress.summary.future_required, 2);
  assert.equal(progress.summary.fraction_among_active, 1);
});

test('a stale verifier gate blocks a downstream task despite finished upstream execution', () => {
  const state = planState();
  const set = composeGraphSet([upstreamGraph(2), downstreamGraph([verifyDep()])], { state });
  const facts = normalizeDependencyFacts([finishedFact('fact:u1-exec'), verifyFact('fact:verify-old-criterion')]);
  const graph = set.graphFor('plan:downstream');
  const gate = evaluateTaskGate(graph, graph.tasks[0], { state, set, facts });
  assert.equal(gate.status, 'blocked');
  const dep = gate.inputs.find(input => input.input_id === 'dep:verify');
  assert.equal(dep.status, 'stale-criterion-revision');
  assert.match(dep.detail, /does not satisfy a current gate/);
});

test('a green predecessor from an old plan revision does not satisfy a current gate', () => {
  const state = planState();
  state.plans[0].revision = 2; // plan moved on after the fact was established
  const set = composeGraphSet([upstreamGraph(), downstreamGraph([verifyDep()])], { state });
  const facts = normalizeDependencyFacts([verifyFact('fact:old-plan-rev', { planRevision: 1 })]);
  const graph = set.graphFor('plan:downstream');
  const gate = evaluateTaskGate(graph, graph.tasks[0], { state, set, facts });
  const dep = gate.inputs.find(input => input.input_id === 'dep:verify');
  // The accepted graph is also stale against plan revision 2: currency is reported honestly.
  assert.equal(['stale-plan-revision', 'target-graph-stale'].includes(dep.status), true);
});

test('a change between preview and launch is rechecked and refuses admission', () => {
  const state = planState();
  const set = composeGraphSet([upstreamGraph()], { state });
  const facts = normalizeDependencyFacts([finishedFact('fact:u1-exec'), verifyFact('fact:u1-verify')]);
  const preview = previewAdmission(state, set, facts, { plan_id: 'plan:upstream', task_id: 'u1' });
  assert.equal(preview.status, 'eligible');
  const sameAgain = recheckAdmission(state, set, facts, preview);
  assert.equal(sameAgain.status, 'admitted');
  const bumped = planState();
  bumped.plans[0].revision = 2; bumped.revision = 8;
  const stale = recheckAdmission(bumped, set, facts, preview);
  assert.equal(stale.status, 'refused');
  assert.equal(stale.reason.code, 'STALE_PREVIEW');
  assert.match(stale.reason.detail, /plan_revision/);
  // A gate invalidated between preview and launch refuses a DEPENDENT task's
  // admission: preview the downstream task with its gate satisfied, then
  // retract the upstream verification fact before launch.
  const activeDownstream = planState();
  activeDownstream.plans[1].declared_lifecycle = 'active';
  activeDownstream.plans[1].native_runs = ['run:d1'];
  const downSet = composeGraphSet([upstreamGraph(), downstreamGraph([verifyDep()])], { state: activeDownstream });
  const downFacts = normalizeDependencyFacts([
    finishedFact('fact:u1-exec'), verifyFact('fact:u1-verify'),
    { id: 'fact:d1-exec', kind: 'task', condition: 'execution-finished', value: true, observed_at: NOW,
      plan_id: 'plan:downstream', task_id: 'd1', basis: { plan_revision: 1, content_sha256: HASH('downstream') } },
    { id: 'fact:d1-verify', kind: 'task', condition: 'independent-verification-confirmed', value: true, observed_at: NOW,
      plan_id: 'plan:downstream', task_id: 'd1', basis: { plan_revision: 1, content_sha256: HASH('downstream'), criterion_revisions: { 'd-c1': 1 } } },
  ]);
  const downPreview = previewAdmission(activeDownstream, downSet, downFacts, { plan_id: 'plan:downstream', task_id: 'd1' });
  assert.equal(downPreview.status, 'eligible');
  const retracted = recheckAdmission(activeDownstream, downSet, normalizeDependencyFacts([
    finishedFact('fact:u1-exec-2', { observedAt: LATER }),
    verifyFact('fact:u1-retracted', { value: false, observedAt: LATER }),
    downFacts.list[2], downFacts.list[3],
  ]), downPreview);
  assert.equal(retracted.status, 'refused');
  assert.equal(retracted.reason.code, 'GATE_INVALIDATED');
});

test('invalid cycles cannot be accepted, and retries are attempts never cycles', () => {
  const state = planState({ plans: [
    planState().plans[0], planState().plans[1],
    { id: 'plan:a', revision: 1, declared_lifecycle: 'active', native_runs: [], baseline_refs: [], source: { sha256: HASH('a') } },
    { id: 'plan:b', revision: 1, declared_lifecycle: 'active', native_runs: [], baseline_refs: [], source: { sha256: HASH('b') } },
  ] });
  const graphA = { schema_version: 1, plan_id: 'plan:a', plan_revision: 1, content_sha256: HASH('a'),
    tasks: [{ id: 't1', title: 'A', criteria: [], dependencies: [{ id: 'dep:a-on-b', kind: 'depends-on-specific-outcome',
      condition: 'execution-finished', outcome_id: 'outcome:b-t1', target: { type: 'task', plan_id: 'plan:b', task_id: 't1' } }] }] };
  const graphB = { schema_version: 1, plan_id: 'plan:b', plan_revision: 1, content_sha256: HASH('b'),
    tasks: [{ id: 't1', title: 'B', criteria: [], dependencies: [{ id: 'dep:b-on-a', kind: 'depends-on-specific-outcome',
      condition: 'execution-finished', outcome_id: 'outcome:a-t1', target: { type: 'task', plan_id: 'plan:a', task_id: 't1' } }] }] };
  assert.throws(() => composeGraphSet([graphA, graphB], { state }), error => error.code === 'INVALID_CYCLE' && /form a cycle/.test(error.message));
  assert.throws(() => authorPlanGraph({ ...graphA, tasks: [{ ...graphA.tasks[0],
    dependencies: [{ id: 'dep:self', kind: 'depends-on-specific-outcome', condition: 'execution-finished',
      target: { type: 'task', plan_id: 'plan:a', task_id: 't1' } }] }] }), error => error.code === 'INVALID_CYCLE');
});

test('join semantics are authored: all, explicit subset and permitted any', () => {
  const stateWithDecision = planState({ items: [{ id: 'decision:launch', kind: 'decision', revision: 1, state: 'accepted', superseded_by: null }] });
  const make = (join, decisionValue) => {
    const deps = [verifyDep(), { id: 'dep:second', kind: 'depends-on-gate',
      condition: 'external-decision-accepted', gate_id: 'gate:decision',
      target: { type: 'decision', item_id: 'decision:launch', item_revision: 1 } }];
    const set = composeGraphSet([upstreamGraph(), downstreamGraph(deps, join)], { state: stateWithDecision });
    const facts = normalizeDependencyFacts([
      finishedFact('fact:u1-exec'), verifyFact('fact:u1-verify'),
      { id: 'fact:decision', kind: 'decision', condition: 'external-decision-accepted', value: decisionValue,
        observed_at: NOW, item_id: 'decision:launch', basis: { item_revision: 1 } },
    ]);
    return evaluateTaskGate(set.graphFor('plan:downstream'), set.graphFor('plan:downstream').tasks[0], { state: stateWithDecision, set, facts });
  };
  assert.equal(make(undefined, false).status, 'blocked'); // default all
  assert.equal(make({ mode: 'subset', subset: ['dep:verify'] }, false).status, 'satisfied');
  assert.equal(make({ mode: 'any', alternatives_permitted: true }, false).status, 'satisfied');
  // 'any' without authored alternatives is rejected at authoring time.
  assert.throws(() => authorPlanGraph(downstreamGraph([verifyDep()], { mode: 'any' })),
    error => error.code === 'INVALID_VALUE' && /permits alternatives/.test(error.message));
});

test('baseline alignment is derived from references, never settable', () => {
  const state = planState({ items: [{ id: 'requirement:offline', kind: 'requirement', revision: 2, state: 'accepted', superseded_by: null }] });
  assert.equal(derivePlanAlignment(state, { baseline_refs: [] }), 'unassessed');
  assert.equal(derivePlanAlignment(state, { baseline_refs: [{ item_id: 'requirement:offline', item_revision: 2 }] }), 'aligned');
  assert.equal(derivePlanAlignment(state, { baseline_refs: [{ item_id: 'requirement:offline', item_revision: 1 }] }), 'needs-reconciliation');
  const supersededState = planState({ items: [
    { id: 'decision:old', kind: 'decision', revision: 1, state: 'accepted', superseded_by: 'decision:new' },
    { id: 'decision:new', kind: 'decision', revision: 1, state: 'accepted', superseded_by: null },
  ] });
  assert.equal(derivePlanAlignment(supersededState, { baseline_refs: [{ item_id: 'decision:old', item_revision: 1 }] }), 'conflicting');
});

test('readiness is derived across components and reports its blockers', () => {
  const state = planState();
  const set = composeGraphSet([upstreamGraph(), downstreamGraph([verifyDep()])], { state });
  const facts = normalizeDependencyFacts([finishedFact('fact:u1-exec'), verifyFact('fact:u1-verify')]);
  const upstream = derivePlanReadiness(state, set, facts, { plan_id: 'plan:upstream' });
  assert.equal(upstream.ready, true);
  assert.deepEqual(upstream.blockers, []);
  const downstream = derivePlanReadiness(state, set, facts, { plan_id: 'plan:downstream' });
  assert.equal(downstream.ready, false);
  const codes = downstream.blockers.map(blocker => blocker.code);
  assert.equal(codes.includes('CRITERIA_UNSATISFIED'), true);
  assert.equal(codes.includes('NATIVE_RUN_NOT_LINKED'), true);
});

test('feature scope follows contributes-to-feature edges and visual edges never gate', () => {
  const state = planState({ items: [{ id: 'feature:search', kind: 'feature', revision: 1, state: 'accepted', superseded_by: null }] });
  const contributing = upstreamGraph();
  contributing.edges = [{ id: 'edge:contributes', kind: 'contributes-to-feature', from_plan_id: 'plan:upstream', item_id: 'feature:search' }];
  const related = downstreamGraph([]);
  related.edges = [{ id: 'edge:extends', kind: 'extends', from_plan_id: 'plan:downstream', to_plan_id: 'plan:upstream' }];
  const set = composeGraphSet([contributing, related], { state });
  assert.deepEqual(plansInScope(set, { kind: 'feature', item_id: 'feature:search' }), ['plan:upstream']);
  const facts = normalizeDependencyFacts([]);
  const graph = set.graphFor('plan:downstream');
  const gate = evaluateTaskGate(graph, graph.tasks[0], { state, set, facts });
  assert.equal(gate.status, 'unconstrained'); // an extends edge gates nothing
});

test('authoring rejects smuggled flags and ungrounded execution edges', () => {
  const state = planState();
  assert.throws(() => authorPlanGraph({ ...upstreamGraph(), tasks: [{ ...upstreamGraph().tasks[0], readiness: 'ready' }] }), error => error.code === 'UNKNOWN_FIELD');
  const ungrounded = upstreamGraph();
  ungrounded.edges = [{ id: 'edge:x', kind: 'depends-on-specific-outcome', from_plan_id: 'plan:upstream', to_plan_id: 'plan:downstream' }];
  assert.throws(() => composeGraphSet([ungrounded, downstreamGraph([])], { state }), error => error.code === 'INVALID_VALUE' && /grounded/.test(error.message));
  assert.throws(() => composeGraphSet([upstreamGraph()], { state: planState({ plans: [] }) }), error => error.code === 'UNKNOWN_PLAN');
  assert.equal(EDGE_KINDS.includes('research-citation'), false);
});
