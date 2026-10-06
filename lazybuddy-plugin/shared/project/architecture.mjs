// Architecture projections (spec §7.3, §12 T13). Persistent component
// identities map to authored intent (accepted or proposed ArchitectureElement
// records), observed code (git-observation components at a content revision)
// and contributing plans (contributes-to-feature edges). Current/Planned/Change
// views share identities; collector coverage is explicit; inferred
// relationships are labeled inferred and never masquerade as verified
// implementation.
import { fail } from './contract.mjs';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function fields(value, allowed, path) {
  if (!plain(value)) fail('INVALID_VALUE', `${path} must be a plain object`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key)) fail('UNKNOWN_FIELD', `${path} has an unsupported field`);
  }
}

// Authored architecture records come from the accepted baseline state. Each
// element carries containment and typed relationships; a proposed element is
// visibly distinguished from an accepted one and never renders as implemented.
function authoredElements(state) {
  const elements = (state.architecture ?? []).map(element => ({
    id: element.id, role: element.role ?? null,
    contains: [...(element.contains ?? [])],
    relationships: (element.relationships ?? []).map(relationship => ({
      kind: relationship.kind, to: relationship.to, basis: relationship.basis ?? 'authored',
    })),
    state: element.state === 'proposed' ? 'proposed' : 'accepted',
    contributing_plans: [],
  }));
  const byId = new Map(elements.map(element => [element.id, element]));
  for (const plan of state.plans ?? []) {
    for (const edge of plan.edges ?? []) {
      if (edge.kind === 'shares-component' && byId.has(edge.component_id)) {
        byId.get(edge.component_id).contributing_plans.push(plan.id);
      }
    }
  }
  for (const graph of state.graphs ?? []) {
    for (const edge of graph.edges ?? []) {
      if (edge.kind === 'shares-component' && byId.has(edge.component_id)) {
        byId.get(edge.component_id).contributing_plans.push(graph.plan_id);
      }
    }
  }
  for (const element of elements) element.contributing_plans = [...new Set(element.contributing_plans)];
  return byId;
}

// Observed components come from collectors at a declared content revision with
// declared coverage. An observation never claims more than its basis.
function observedComponents(observations) {
  if (observations !== undefined && !Array.isArray(observations)) fail('INVALID_VALUE', 'Observations must be an array');
  const byId = new Map();
  for (const observation of observations ?? []) {
    fields(observation, ['component_id', 'observed_at', 'content_revision', 'paths', 'coverage', 'basis'], 'observation');
    if (typeof observation.component_id !== 'string' || !observation.component_id.length) {
      fail('INVALID_ID', 'An observation names its component');
    }
    if (typeof observation.observed_at !== 'string' || !observation.observed_at.length) {
      fail('MISSING_FIELD', 'An observation carries its observed-at timestamp');
    }
    if (!Array.isArray(observation.paths)) fail('INVALID_VALUE', 'An observation lists its source paths');
    const current = byId.get(observation.component_id);
    if (!current || observation.observed_at >= current.observed_at) {
      byId.set(observation.component_id, { id: observation.component_id, observed_at: observation.observed_at,
        content_revision: observation.content_revision ?? null, paths: [...observation.paths],
        coverage: observation.coverage ?? null, basis: observation.basis ?? 'collector' });
    }
  }
  return byId;
}

// The three views over one identity set. Change highlights additions
// (observed without authored intent), open migrations (authored without
// observation) and replacements (authored supersession links). Implementation
// and verification stay separate: an observed component with no verification
// evidence is implemented-not-verified, never green.
export function projectArchitecture(state, { observations, verification_evidence } = {}) {
  if (verification_evidence !== undefined && !Array.isArray(verification_evidence)) {
    fail('INVALID_VALUE', 'Verification evidence must be an array of component identities with current proof');
  }
  const authored = authoredElements(state);
  const observed = observedComponents(observations);
  const verified = new Set((verification_evidence ?? []).map(entry => {
    if (plain(entry)) return entry.component_id;
    if (typeof entry === 'string') return entry;
    return fail('INVALID_VALUE', 'Verification evidence identifies components');
  }));
  const identities = new Set([...authored.keys(), ...observed.keys()]);
  const current = []; const planned = []; const change = { additions: [], open_migrations: [], replacements: [] };
  for (const id of identities) {
    const intent = authored.get(id) ?? null;
    const observation = observed.get(id) ?? null;
    if (observation) {
      current.push({ id, paths: observation.paths, content_revision: observation.content_revision,
        coverage: observation.coverage, observed_at: observation.observed_at,
        implementation: 'observed', verification: verified.has(id) ? 'verified' : 'not-verified',
        authored_intent: intent ? intent.state : 'none' });
    }
    if (intent) {
      planned.push({ id, state: intent.state, role: intent.role, contains: intent.contains,
        relationships: intent.relationships, contributing_plans: intent.contributing_plans,
        treatment: intent.state === 'proposed' ? 'ghost' : 'accepted' });
    }
    if (observation && !intent) change.additions.push({ id, detail: 'Observed component without authored intent', basis: 'collector' });
    if (intent && !observation) change.open_migrations.push({ id, detail: intent.state === 'proposed'
      ? 'Proposed component not yet observed in code'
      : 'Accepted intent with no current observation — migration or collector gap', state: intent.state });
    if (intent?.relationships.some(relationship => relationship.kind === 'replaces')) {
      change.replacements.push({ id, detail: 'Authored replacement link', basis: 'authored' });
    }
  }
  return { identities: [...identities].sort(), current, planned, change,
    coverage_note: 'current reflects observations at their declared content revisions with declared coverage; inferred relationships are labeled and never verified' };
}

// A plain-language product journey (spec §7.3) assembled from authored steps.
// Each step is authored content with source references; the system promises no
// automatic understanding of every language or dependency.
export function productJourney(state, journey) {
  if (!Array.isArray(journey)) fail('INVALID_VALUE', 'A journey is an ordered array of authored steps');
  const steps = journey.map((step, index) => {
    fields(step, ['component_id', 'interaction', 'source'], `journey[${index}]`);
    if (typeof step.component_id !== 'string' || !step.component_id.length) fail('INVALID_ID', 'A journey step names its component');
    if (typeof step.interaction !== 'string' || !step.interaction.length) fail('INVALID_VALUE', 'A journey step describes the interaction');
    return { component_id: step.component_id, interaction: step.interaction,
      source: step.source ?? null, basis: 'agent-authored' };
  });
  const authored = authoredElements(state);
  const unknown = steps.filter(step => !authored.has(step.component_id)).map(step => step.component_id);
  if (unknown.length) fail('UNKNOWN_ITEM', `Journey steps reference unauthored components: ${unknown.join(', ')}`);
  return { steps, basis: 'agent-authored with source references; deterministic collectors identify their own coverage' };
}
