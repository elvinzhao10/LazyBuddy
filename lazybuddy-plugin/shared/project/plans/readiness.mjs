import { fail } from '../contract.mjs';
import { DEPENDENCY_CONDITIONS } from './dependencies.mjs';
import { derivePlanAlignment, planBucket } from './lifecycle.mjs';

// Readiness is a DERIVED assessment. Nothing in this module writes a readiness
// flag anywhere: it recomputes from the current accepted state, the accepted
// graph set and the dependency facts the native runtime reports.

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const TASK_CONDITIONS = Object.freeze(['execution-finished', 'result-available', 'independent-verification-confirmed']);
const CONDITION_KINDS = Object.freeze({
  'execution-finished': 'task',
  'result-available': 'task',
  'independent-verification-confirmed': 'task',
  'external-decision-accepted': 'decision',
  'resource-declared': 'resource',
});

const isId = value => typeof value === 'string' && ID_PATTERN.test(value);
const isHash = value => typeof value === 'string' && HASH_PATTERN.test(value);
const isRevision = value => Number.isSafeInteger(value) && value > 0;
const isTimestamp = value => typeof value === 'string' && TIMESTAMP_PATTERN.test(value) && Date.parse(value) !== Number.NaN;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function fields(value, allowed, path) {
  if (!plain(value)) fail('INVALID_VALUE', `${path} must be a plain object`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key)) fail('UNKNOWN_FIELD', `${path} has an unsupported field`);
  }
}

function criterionRevisionMap(map, path) {
  if (!plain(map)) fail('INVALID_VALUE', `${path} must be a plain object`);
  const revisions = {};
  for (const [criterionId, revision] of Object.entries(map)) {
    if (!isId(criterionId) || criterionId.includes('\u0000')) fail('INVALID_ID', `${path} has an invalid criterion identity`);
    if (!isRevision(revision)) fail('INVALID_VALUE', `${path}.${criterionId} must be a positive revision`);
    revisions[criterionId] = revision;
  }
  return revisions;
}

// A dependency fact is what the native runtime reports about one condition of
// one subject, together with the revisions the fact was established against.
// Retries are new fact records with a later observed_at — never graph changes.
function dependencyFact(fact, path) {
  fields(fact, ['id', 'kind', 'condition', 'value', 'observed_at', 'plan_id', 'task_id', 'item_id',
    'resource_id', 'basis'], path);
  if (!isId(fact.id)) fail('INVALID_ID', `${path}.id is not a valid identity`);
  if (!DEPENDENCY_CONDITIONS.includes(fact.condition)) fail('INVALID_VALUE', `${path}.condition must be a declared dependency condition`);
  if (typeof fact.value !== 'boolean') fail('INVALID_VALUE', `${path}.value must be a boolean`);
  if (!isTimestamp(fact.observed_at)) fail('INVALID_VALUE', `${path}.observed_at must be a UTC timestamp`);
  const expectedKind = CONDITION_KINDS[fact.condition];
  if (fact.kind !== expectedKind) fail('INVALID_VALUE', `${path}.kind must match the condition subject`);
  const normalized = { id: fact.id, kind: fact.kind, condition: fact.condition, value: fact.value,
    observed_at: fact.observed_at, basis: null };
  if (expectedKind === 'task') {
    if (!isId(fact.plan_id ?? null) || !isId(fact.task_id ?? null)) fail('MISSING_FIELD', `${path} needs plan and task identities`);
    if (fact.item_id !== undefined || fact.resource_id !== undefined) fail('INVALID_VALUE', `${path} is a task fact`);
    normalized.plan_id = fact.plan_id; normalized.task_id = fact.task_id;
    if (fact.basis === undefined) fail('MISSING_FIELD', `${path} needs the revisions it was established against`);
    fields(fact.basis, ['plan_revision', 'content_sha256', 'criterion_revisions'], `${path}.basis`);
    if (!isRevision(fact.basis.plan_revision)) fail('INVALID_VALUE', `${path}.basis.plan_revision must be positive`);
    if (fact.basis.content_sha256 !== undefined && fact.basis.content_sha256 !== null && !isHash(fact.basis.content_sha256)) {
      fail('INVALID_VALUE', `${path}.basis.content_sha256 must be a digest or null`);
    }
    normalized.basis = { plan_revision: fact.basis.plan_revision,
      content_sha256: fact.basis.content_sha256 ?? null,
      criterion_revisions: fact.basis.criterion_revisions === undefined ? {}
        : criterionRevisionMap(fact.basis.criterion_revisions, `${path}.basis.criterion_revisions`) };
  } else if (expectedKind === 'decision') {
    if (!isId(fact.item_id ?? null)) fail('MISSING_FIELD', `${path} needs an item identity`);
    if (fact.plan_id !== undefined || fact.task_id !== undefined || fact.resource_id !== undefined) {
      fail('INVALID_VALUE', `${path} is a decision fact`);
    }
    normalized.item_id = fact.item_id;
    if (fact.basis === undefined) fail('MISSING_FIELD', `${path} needs the revision it was established against`);
    fields(fact.basis, ['item_revision'], `${path}.basis`);
    if (!isRevision(fact.basis.item_revision)) fail('INVALID_VALUE', `${path}.basis.item_revision must be positive`);
    normalized.basis = { item_revision: fact.basis.item_revision };
  } else {
    if (!isId(fact.resource_id ?? null)) fail('MISSING_FIELD', `${path} needs a resource identity`);
    if (fact.plan_id !== undefined || fact.task_id !== undefined || fact.item_id !== undefined) {
      fail('INVALID_VALUE', `${path} is a resource fact`);
    }
    normalized.resource_id = fact.resource_id;
    if (fact.basis !== undefined) fail('INVALID_VALUE', `${path} carries no revision basis`);
  }
  return normalized;
}

// Validate and index facts. The latest record per subject+condition wins, so a
// retry attempt replaces an earlier attempt without creating new obligations.
export function normalizeDependencyFacts(facts) {
  if (!Array.isArray(facts) || facts.length > 10000) fail('INVALID_VALUE', 'Dependency facts must be a bounded array');
  const normalized = facts.map((fact, index) => dependencyFact(fact, `facts[${index}]`));
  const seen = new Set();
  for (const fact of normalized) {
    if (seen.has(fact.id)) fail('DUPLICATE_ID', 'A dependency fact identity was recorded twice');
    seen.add(fact.id);
  }
  const index = new Map();
  for (const fact of normalized) {
    const key = fact.kind === 'task' ? `task\u0000${fact.plan_id}\u0000${fact.task_id}\u0000${fact.condition}`
      : fact.kind === 'decision' ? `decision\u0000${fact.item_id}` : `resource\u0000${fact.resource_id}`;
    const existing = index.get(key);
    if (!existing || fact.observed_at >= existing.observed_at) index.set(key, fact);
  }
  return { list: normalized, latest: index,
    attempts: normalized.reduce((counts, fact) => {
      const key = fact.kind === 'task' ? `task\u0000${fact.plan_id}\u0000${fact.task_id}\u0000${fact.condition}`
        : fact.kind === 'decision' ? `decision\u0000${fact.item_id}` : `resource\u0000${fact.resource_id}`;
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {}) };
}

function planOf(state, planId) {
  return state.plans.find(entry => entry.id === planId) ?? null;
}

function graphCurrency(state, graph) {
  const plan = planOf(state, graph.plan_id);
  if (!plan) return { problem: 'PLAN_UNKNOWN', plan_revision: null, content_sha256: null };
  if (graph.plan_revision !== plan.revision) return { problem: 'GRAPH_STALE', plan_revision: plan.revision, content_sha256: plan.source.sha256 };
  if (graph.content_sha256 !== plan.source.sha256) {
    return { problem: 'GRAPH_STALE', plan_revision: plan.revision, content_sha256: plan.source.sha256 };
  }
  return { problem: null, plan_revision: plan.revision, content_sha256: plan.source.sha256 };
}

// Evaluate one declared dependency input against current state, current graphs
// and current facts. A satisfied-looking fact bound to an old plan revision,
// old document content or an old criterion revision is STALE and does not
// satisfy the gate.
export function evaluateDependency(input, { state, set, facts }) {
  const result = { input_id: input.id, kind: input.kind, condition: input.condition,
    target: input.target, status: 'not-established', detail: null };
  if (input.target.type === 'task') {
    const target = set.taskAt(input.target.plan_id, input.target.task_id);
    if (!target) return { ...result, status: 'unknown-target', detail: 'The target task is outside the accepted graph set' };
    const currency = graphCurrency(state, target.graph);
    if (currency.problem) {
      return { ...result, status: currency.problem === 'PLAN_UNKNOWN' ? 'unknown-target' : 'target-graph-stale',
        detail: `The target plan graph is ${currency.problem === 'PLAN_UNKNOWN' ? 'unregistered' : 'stale against the current plan revision'}` };
    }
    const fact = facts.latest.get(`task\u0000${input.target.plan_id}\u0000${input.target.task_id}\u0000${input.condition}`);
    if (!fact || fact.value !== true) return { ...result, detail: 'No current fact establishes the condition' };
    if (fact.basis.plan_revision !== currency.plan_revision) {
      return { ...result, status: 'stale-plan-revision',
        detail: `The condition was established against plan revision ${fact.basis.plan_revision}, not the current revision ${currency.plan_revision}` };
    }
    if (fact.basis.content_sha256 != null && fact.basis.content_sha256 !== currency.content_sha256) {
      return { ...result, status: 'stale-content', detail: 'The condition predates the current plan document content' };
    }
    if (input.condition === 'independent-verification-confirmed') {
      for (const criterion of target.task.criteria.filter(entry => entry.required)) {
        const verifiedAt = fact.basis.criterion_revisions[criterion.id];
        if (verifiedAt == null) {
          return { ...result, status: 'stale-criterion-revision',
            detail: `The verdict does not cover required criterion ${criterion.id}` };
        }
        if (verifiedAt !== criterion.revision) {
          return { ...result, status: 'stale-criterion-revision',
            detail: `Criterion ${criterion.id} moved from revision ${verifiedAt} to ${criterion.revision}; a green predecessor from an old criterion revision does not satisfy a current gate` };
        }
      }
    }
    return { ...result, status: 'satisfied', detail: null };
  }
  if (input.target.type === 'decision') {
    const item = state.items.find(entry => entry.id === input.target.item_id);
    if (!item) return { ...result, status: 'unknown-target', detail: 'The decision item is not registered' };
    if (item.kind !== 'decision') return { ...result, status: 'unknown-target', detail: 'The target item is not a decision' };
    const fact = facts.latest.get(`decision\u0000${input.target.item_id}`);
    if (!fact || fact.value !== true) return { ...result, detail: 'No current fact establishes the decision acceptance' };
    if (item.state !== 'accepted') return { ...result, status: 'not-established', detail: 'The decision item is not currently accepted' };
    if (fact.basis.item_revision !== item.revision || input.target.item_revision !== item.revision) {
      return { ...result, status: 'stale-item-revision',
        detail: `The decision was accepted at revision ${Math.max(fact.basis.item_revision, input.target.item_revision)}, not the current revision ${item.revision}` };
    }
    return { ...result, status: 'satisfied', detail: null };
  }
  const ownerGraph = [...set.plans.values()].find(graph =>
    graph.resources.some(resource => resource.id === input.target.resource_id)) ?? null;
  if (!ownerGraph) return { ...result, status: 'unknown-target', detail: 'The resource is not declared by any accepted graph' };
  const currency = graphCurrency(state, ownerGraph);
  if (currency.problem) return { ...result, status: 'target-graph-stale', detail: 'The declaring plan graph is not current' };
  const fact = facts.latest.get(`resource\u0000${input.target.resource_id}`);
  if (!fact || fact.value !== true) return { ...result, detail: 'No current fact declares the resource available' };
  return { ...result, status: 'satisfied', detail: null };
}

// Evaluate a task's join gate. 'all' requires every input; 'subset' requires
// exactly the authored subset; 'any' (only where alternatives are permitted)
// needs one. Join semantics are authored, never inferred from visual edges.
export function evaluateTaskGate(graph, task, environment) {
  const inputs = task.dependencies.map(input => evaluateDependency(input, environment));
  const mode = task.join.mode;
  let status;
  if (!inputs.length) status = 'unconstrained';
  else if (mode === 'all') status = inputs.every(input => input.status === 'satisfied') ? 'satisfied' : 'blocked';
  else if (mode === 'subset') {
    const memberIds = new Set(task.join.subset);
    status = inputs.filter(input => memberIds.has(input.input_id)).every(input => input.status === 'satisfied')
      ? 'satisfied' : 'blocked';
  } else status = inputs.some(input => input.status === 'satisfied') ? 'satisfied' : 'blocked';
  return { plan_id: graph.plan_id, task_id: task.id, join: { mode, subset: task.join.subset,
    alternatives_permitted: task.join.alternatives_permitted }, status, inputs };
}

function criteriaStatus(graph, facts) {
  const entries = [];
  for (const task of graph.tasks) {
    for (const criterion of task.criteria) {
      if (!criterion.required) continue;
      const fact = facts.latest.get(`task\u0000${graph.plan_id}\u0000${task.id}\u0000independent-verification-confirmed`);
      const verifiedAt = fact && fact.value === true ? fact.basis.criterion_revisions[criterion.id] ?? null : null;
      entries.push({ task_id: task.id, criterion_id: criterion.id, revision: criterion.revision,
        satisfied: verifiedAt === criterion.revision,
        status: verifiedAt == null ? 'unverified' : verifiedAt === criterion.revision ? 'satisfied' : 'stale-criterion-revision' });
    }
  }
  return entries;
}

// Derived readiness over the five spec components. The returned badge is a
// function of the current inputs; there is no authorable or user-settable flag.
export function derivePlanReadiness(state, set, factsInput, { plan_id }) {
  if (!isId(plan_id)) fail('INVALID_ID', 'readiness needs a plan identity');
  const facts = factsInput?.latest instanceof Map && Array.isArray(factsInput.list) ? factsInput : normalizeDependencyFacts(factsInput ?? []);
  const plan = planOf(state, plan_id);
  if (!plan) fail('UNKNOWN_PLAN', 'Readiness needs a registered plan');
  const graph = set.graphFor(plan_id);
  const blockers = [];
  const scope = { valid: false, problems: [] };
  if (!graph) scope.problems.push('GRAPH_MISSING');
  else {
    const currency = graphCurrency(state, graph);
    if (currency.problem) scope.problems.push(currency.problem);
  }
  if (['superseded', 'abandoned'].includes(plan.declared_lifecycle)) scope.problems.push('PLAN_RETIRED');
  scope.valid = scope.problems.length === 0;
  if (!scope.valid) blockers.push({ component: 'scope', code: scope.problems[0], detail: 'The plan scope is not currently valid' });

  const gates = graph ? graph.tasks.map(task => evaluateTaskGate(graph, task, { state, set, facts })) : [];
  const blockedTaskIds = gates.filter(gate => gate.status === 'blocked').map(gate => gate.task_id);
  if (blockedTaskIds.length) {
    blockers.push({ component: 'dependencies', code: 'GATE_BLOCKED',
      detail: `Dependency gates block tasks ${blockedTaskIds.join(', ')}` });
  }
  const alignment = derivePlanAlignment(state, plan);
  if (alignment === 'needs-reconciliation' || alignment === 'conflicting') {
    blockers.push({ component: 'baseline-alignment', code: alignment === 'conflicting' ? 'ALIGNMENT_CONFLICTING' : 'ALIGNMENT_STALE',
      detail: `Baseline alignment is ${alignment}` });
  }
  const criteria = graph ? criteriaStatus(graph, facts) : [];
  const unsatisfiedCriteria = criteria.filter(entry => !entry.satisfied);
  if (unsatisfiedCriteria.length) {
    blockers.push({ component: 'criteria', code: 'CRITERIA_UNSATISFIED',
      detail: `${unsatisfiedCriteria.length} required criteria are not satisfied at their current revisions` });
  }
  const nativeCapability = { runtime: state.runtime, linked_runs: plan.native_runs.length,
    capable: plan.native_runs.length > 0 };
  if (!nativeCapability.capable) {
    blockers.push({ component: 'native-capability', code: 'NATIVE_RUN_NOT_LINKED',
      detail: `No native run of runtime ${state.runtime} is linked to the plan` });
  }
  return {
    plan_id, lifecycle: plan.declared_lifecycle, bucket: planBucket(plan.declared_lifecycle),
    scope, dependencies: { blocked_task_ids: blockedTaskIds, gates },
    baseline_alignment: alignment,
    criteria: { required: criteria.length, satisfied: criteria.length - unsatisfiedCriteria.length,
      entries: criteria },
    native_capability: nativeCapability,
    ready: blockers.length === 0, blockers,
  };
}

// The revision basis an admission decision was computed against. Any drift in
// these values between preview and launch invalidates the preview.
export function admissionBasis(state, set, { plan_id, task_id }) {
  const plan = planOf(state, plan_id);
  if (!plan) fail('UNKNOWN_PLAN', 'An admission basis needs a registered plan');
  const located = set.taskAt(plan_id, task_id);
  if (!located) fail('UNKNOWN_TASK', 'An admission basis needs a task in the accepted graph set');
  const { graph, task } = located;
  const currency = graphCurrency(state, graph);
  return {
    project_revision: state.revision,
    plan_revision: plan.revision,
    content_sha256: plan.source.sha256,
    graph_plan_revision: graph.plan_revision,
    graph_content_sha256: graph.content_sha256,
    criterion_revisions: Object.fromEntries(task.criteria.map(criterion => [criterion.id, criterion.revision])),
    graph_current: currency.problem === null,
    graph_problem: currency.problem,
  };
}

// Preview: derive eligibility now and pin the revision basis. This is a derived
// view only — it authorizes nothing by itself.
export function previewAdmission(state, set, factsInput, { plan_id, task_id }) {
  const facts = factsInput?.latest instanceof Map && Array.isArray(factsInput.list) ? factsInput : normalizeDependencyFacts(factsInput ?? []);
  const plan = planOf(state, plan_id);
  if (!plan) fail('UNKNOWN_PLAN', 'An admission preview needs a registered plan');
  const located = set.taskAt(plan_id, task_id);
  if (!located) fail('UNKNOWN_TASK', 'An admission preview needs a task in the accepted graph set');
  const readiness = derivePlanReadiness(state, set, facts, { plan_id });
  const gate = evaluateTaskGate(located.graph, located.task, { state, set, facts });
  const blockers = [];
  if (!readiness.scope.valid) blockers.push({ code: 'SCOPE_INVALID', detail: readiness.scope.problems.join(', ') });
  for (const blocker of readiness.blockers) {
    if (blocker.component === 'dependencies') continue;
    blockers.push({ code: blocker.code, detail: blocker.component });
  }
  if (gate.status === 'blocked') {
    blockers.push({ code: 'GATE_BLOCKED', detail: gate.inputs.filter(input => input.status !== 'satisfied')
      .map(input => `${input.input_id}:${input.status}`).join(', ') });
  }
  return { plan_id, task_id, status: blockers.length ? 'blocked' : 'eligible', blockers,
    basis: admissionBasis(state, set, { plan_id, task_id }), gate };
}

// Native admission recheck: the function the selected runtime's admission path
// calls immediately before launching a dependent task. It recomputes gates and
// revision bases from the CURRENT state — a stale projection, or a plan,
// criterion or content revision that moved between preview and launch, refuses
// admission. This module never schedules anything; the native runtime remains
// the scheduler.
export function recheckAdmission(state, set, factsInput, preview) {
  if (!plain(preview) || preview.status === undefined || !plain(preview.basis)) {
    fail('INVALID_VALUE', 'A recheck needs the preview decision it revalidates');
  }
  const facts = factsInput?.latest instanceof Map && Array.isArray(factsInput.list) ? factsInput : normalizeDependencyFacts(factsInput ?? []);
  if (preview.status !== 'eligible') {
    return { status: 'refused', reason: { code: 'ADMIT_BLOCKED', detail: 'The preview itself was not eligible' },
      basis: null, gate: null };
  }
  const located = set.taskAt(preview.plan_id, preview.task_id);
  if (!located) {
    return { status: 'refused', reason: { code: 'GATE_INVALIDATED', detail: 'The task no longer exists in the accepted graph set' },
      basis: null, gate: null };
  }
  const currentBasis = admissionBasis(state, set, { plan_id: preview.plan_id, task_id: preview.task_id });
  const drift = Object.entries(currentBasis).filter(([key, value]) => {
    if (key === 'graph_current' || key === 'graph_problem') return false;
    const previous = preview.basis[key];
    if (value !== null && typeof value === 'object') {
      // criterion_revisions is a map: compare by value so an unchanged map of
      // criterion revisions never falsely reports drift. Key insertion order is
      // not content — the same entries in a different order are compared by key
      // set and per-key values, never by serialized shape.
      const previousMap = previous !== null && typeof previous === 'object' ? previous : {};
      const previousKeys = Object.keys(previousMap);
      const currentKeys = Object.keys(value);
      if (previousKeys.length !== currentKeys.length) return true;
      if (!currentKeys.every(key => Object.hasOwn(previousMap, key))) return true;
      return currentKeys.some(key => previousMap[key] !== value[key]);
    }
    return previous !== value;
  }).map(([key]) => key);
  if (drift.length) {
    return { status: 'refused', reason: { code: 'STALE_PREVIEW', detail: `Revisions moved between preview and launch: ${drift.join(', ')}` },
      basis: currentBasis, gate: null };
  }
  const gate = evaluateTaskGate(located.graph, located.task, { state, set, facts });
  if (gate.status === 'blocked') {
    return { status: 'refused', reason: { code: 'GATE_INVALIDATED', detail: 'The admission gate is no longer satisfied against current facts' },
      basis: currentBasis, gate };
  }
  return { status: 'admitted', reason: null, basis: currentBasis, gate };
}
