import { PLAN_LIFECYCLES, PREPARATION_STAGES, fail } from '../contract.mjs';

export { PLAN_LIFECYCLES, PREPARATION_STAGES };

// Typed legal lifecycle transitions. Terminal histories (superseded, abandoned)
// never restart; retirement always carries its reason and supersession link.
// This module derives and assesses; only the shared command route (model.mjs
// plan.transition) mutates the accepted state.
export const LIFECYCLE_TRANSITIONS = Object.freeze({
  draft: Object.freeze(['planned', 'superseded', 'abandoned']),
  planned: Object.freeze(['active', 'superseded', 'abandoned']),
  active: Object.freeze(['paused', 'completed', 'superseded', 'abandoned']),
  paused: Object.freeze(['active', 'completed', 'superseded', 'abandoned']),
  completed: Object.freeze(['superseded']),
  superseded: Object.freeze([]),
  abandoned: Object.freeze([]),
});

const RETIRING = Object.freeze(['superseded', 'abandoned']);

// Future work has not started native execution yet, current work belongs to the
// active delivery denominators, and historical work is retained intent only.
export function planBucket(lifecycle) {
  if (!PLAN_LIFECYCLES.includes(lifecycle)) fail('INVALID_VALUE', 'An unknown lifecycle has no bucket');
  if (lifecycle === 'draft' || lifecycle === 'planned') return 'future';
  if (lifecycle === 'superseded' || lifecycle === 'abandoned') return 'historical';
  return 'current';
}

// Read-only assessment of a requested transition against the same typed rules
// the shared command route enforces, so callers can explain legality without
// mutating accepted state.
export function assessPlanTransition(state, planId, toLifecycle, payload = {}) {
  const reasons = [];
  const plan = state.plans.find(entry => entry.id === planId);
  if (!plan) reasons.push({ code: 'UNKNOWN_PLAN', detail: 'The plan must exist before a lifecycle transition' });
  else {
    if (!PLAN_LIFECYCLES.includes(toLifecycle)) reasons.push({ code: 'INVALID_VALUE', detail: 'An unknown lifecycle was requested' });
    else if (!LIFECYCLE_TRANSITIONS[plan.declared_lifecycle].includes(toLifecycle)) {
      reasons.push({ code: 'INVALID_TRANSITION', detail: `The declared lifecycle cannot move to ${toLifecycle}` });
    }
    if (toLifecycle === 'active' && !plan.native_runs.length) {
      reasons.push({ code: 'NATIVE_RUN_REQUIRED', detail: 'Active requires a linked native run' });
    }
    if (RETIRING.includes(toLifecycle) && !payload.reason) {
      reasons.push({ code: 'MISSING_FIELD', detail: 'Retiring a plan requires its reason' });
    }
    if (toLifecycle === 'superseded' && !payload.successor_plan_id) {
      reasons.push({ code: 'MISSING_FIELD', detail: 'Superseding a plan requires its replacement link' });
    }
    if (payload.successor_plan_id != null &&
        (payload.successor_plan_id === planId || !state.plans.some(entry => entry.id === payload.successor_plan_id))) {
      reasons.push({ code: 'INVALID_REFERENCE', detail: 'A successor must be another registered plan' });
    }
  }
  return { allowed: reasons.length === 0, from: plan?.declared_lifecycle ?? null, to: toLifecycle, reasons };
}

export function assessPreparationStage(plan, preparation) {
  if (!PREPARATION_STAGES.includes(preparation)) fail('INVALID_VALUE', 'An unknown preparation stage was requested');
  if (plan.declared_lifecycle !== 'draft') fail('INVALID_VALUE', 'A preparation stage applies to draft plans only');
  return { plan_id: plan.id, preparation, lifecycle: plan.declared_lifecycle };
}

// Archiving is a visibility setting: it never changes the declared lifecycle,
// the transition history or progress denominators — it only removes a plan from
// the default view listing.
export function planVisibility(state, archivedPlanIds = []) {
  if (!Array.isArray(archivedPlanIds)) fail('INVALID_VALUE', 'archivedPlanIds must be an array of plan identities');
  const seen = new Set();
  for (const id of archivedPlanIds) {
    if (typeof id !== 'string' || !id.length) fail('INVALID_VALUE', 'An archived plan identity must be text');
    if (seen.has(id)) fail('DUPLICATE_ID', 'An archived plan identity was listed twice');
    seen.add(id);
    if (!state.plans.some(entry => entry.id === id)) fail('UNKNOWN_PLAN', 'An archived plan must be registered');
  }
  const archived = new Set(archivedPlanIds);
  return {
    entries: state.plans.map(plan => ({
      plan_id: plan.id, lifecycle: plan.declared_lifecycle, bucket: planBucket(plan.declared_lifecycle),
      archived: archived.has(plan.id), visible_in_default_view: !archived.has(plan.id),
    })),
  };
}

// Derived baseline alignment. It is never a user-settable status: it follows
// from the plan's baseline references against the current accepted items.
//   unassessed          — the plan carries no baseline references
//   conflicting         — the plan still cites a superseded decision without its successor
//   needs-reconciliation— a referenced item moved past the referenced revision
//   aligned             — every reference is current
// A completed plan keeps its historical result; current alignment is a separate
// derived assessment and never rewrites that history.
export function derivePlanAlignment(state, plan) {
  if (!plan.baseline_refs.length) return 'unassessed';
  const referenced = new Set(plan.baseline_refs.map(reference => reference.item_id));
  for (const reference of plan.baseline_refs) {
    const item = state.items.find(entry => entry.id === reference.item_id);
    if (!item) fail('UNKNOWN_ITEM', 'A plan references an unknown baseline item');
    if (item.superseded_by != null && !referenced.has(item.superseded_by)) return 'conflicting';
  }
  for (const reference of plan.baseline_refs) {
    const item = state.items.find(entry => entry.id === reference.item_id);
    if (item.revision !== reference.item_revision) return 'needs-reconciliation';
  }
  return 'aligned';
}
