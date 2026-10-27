import { fail } from '../contract.mjs';
import { plansInScope } from './dependencies.mjs';
import { normalizeDependencyFacts } from './readiness.mjs';

// Group progress over unique required leaf work and criterion obligations at
// the selected scope. Future plans never inflate active delivery denominators:
// their obligations are reported separately and excluded from the fraction.
// Groups, retries, rendered copies and verifier substeps add no obligations.

function planOf(state, planId) {
  const plan = state.plans.find(entry => entry.id === planId);
  if (!plan) fail('UNKNOWN_PLAN', 'Progress needs a registered plan');
  return plan;
}

function graphCurrent(state, graph) {
  const plan = planOf(state, graph.plan_id);
  return graph.plan_revision === plan.revision && graph.content_sha256 === plan.source.sha256;
}

function taskSatisfied(state, graph, task, facts) {
  const plan = planOf(state, graph.plan_id);
  const fact = facts.latest.get(`task\u0000${graph.plan_id}\u0000${task.id}\u0000execution-finished`);
  if (!fact || fact.value !== true) return false;
  return fact.basis.plan_revision === plan.revision &&
    (fact.basis.content_sha256 == null || fact.basis.content_sha256 === plan.source.sha256);
}

function criterionSatisfied(state, graph, task, criterion, facts) {
  const fact = facts.latest.get(`task\u0000${graph.plan_id}\u0000${task.id}\u0000independent-verification-confirmed`);
  if (!fact || fact.value !== true) return false;
  const plan = planOf(state, graph.plan_id);
  if (fact.basis.plan_revision !== plan.revision) return false;
  return fact.basis.criterion_revisions[criterion.id] === criterion.revision;
}

export function groupProgress(state, set, factsInput, { scope }) {
  if (scope === undefined || scope === null) fail('MISSING_FIELD', 'Progress needs a selected scope');
  const facts = factsInput?.latest instanceof Map && Array.isArray(factsInput.list) ? factsInput
    : factsInput === undefined || factsInput === null ? normalizeDependencyFacts([])
      : normalizeDependencyFacts(factsInput);
  const scopePlanIds = plansInScope(set, scope);
  const buckets = { active: [], future: [], historical: [] };
  const byBucket = { active: new Map(), future: new Map(), historical: new Map() };
  // Progress buckets follow the spec's three groups: draft/planned work is
  // future, retired and completed work is historical, and only live execution
  // (active or paused) enters the active delivery denominators. This is
  // deliberately distinct from planBucket's lifecycle display vocabulary.
  const progressBucket = lifecycle => lifecycle === 'active' || lifecycle === 'paused' ? 'active'
    : lifecycle === 'draft' || lifecycle === 'planned' ? 'future' : 'historical';
  for (const planId of scopePlanIds) {
    const plan = planOf(state, planId);
    const graph = set.graphFor(planId);
    const bucket = progressBucket(plan.declared_lifecycle);
    buckets[bucket].push(planId);
    byBucket[bucket].set(planId, { plan, graph });
  }
  const summaries = {};
  const obligations = { active: [], future: [], historical: [] };
  for (const bucket of ['active', 'future', 'historical']) {
    let requiredTasks = 0; let satisfiedTasks = 0;
    let requiredCriteria = 0; let satisfiedCriteria = 0;
    const seen = new Set();
    for (const [planId, { graph }] of byBucket[bucket]) {
      if (!graph || !graphCurrent(state, graph)) continue;
      for (const task of graph.tasks) {
        if (!task.required) continue;
        // One unique obligation per plan/task identity: reaching a plan through
        // several scope edges, re-rendering it, or retrying attempts never
        // creates a second obligation.
        const taskKey = `${planId}\u0000${task.id}`;
        if (seen.has(taskKey)) continue;
        seen.add(taskKey);
        requiredTasks += 1;
        const taskOk = taskSatisfied(state, graph, task, facts);
        if (taskOk) satisfiedTasks += 1;
        obligations[bucket].push({ kind: 'task', plan_id: planId, task_id: task.id, satisfied: taskOk });
        for (const criterion of task.criteria) {
          if (!criterion.required) continue;
          requiredCriteria += 1;
          const ok = criterionSatisfied(state, graph, task, criterion, facts);
          if (ok) satisfiedCriteria += 1;
          obligations[bucket].push({ kind: 'criterion', plan_id: planId, task_id: task.id,
            criterion_id: criterion.id, satisfied: ok });
        }
      }
    }
    const total = requiredTasks + requiredCriteria;
    const satisfied = satisfiedTasks + satisfiedCriteria;
    summaries[bucket] = {
      plan_ids: buckets[bucket], required_tasks: requiredTasks, satisfied_tasks: satisfiedTasks,
      required_criteria: requiredCriteria, satisfied_criteria: satisfiedCriteria,
      required: total, satisfied, unique_obligations: obligations[bucket].length,
    };
  }
  const active = summaries.active;
  return {
    scope,
    plans: { active: buckets.active, future: buckets.future, historical: buckets.historical },
    summary: {
      active_required: active.required, active_satisfied: active.satisfied,
      active_unique_obligations: active.unique_obligations,
      future_required: summaries.future.required,
      historical_required: summaries.historical.required,
      fraction_among_active: active.required === 0 ? null : active.satisfied / active.required,
    },
    buckets: summaries,
  };
}
