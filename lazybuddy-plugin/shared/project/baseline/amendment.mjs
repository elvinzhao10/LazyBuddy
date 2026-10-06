import { fail, unique } from '../contract.mjs';
import { canonicalJSON } from '../history.mjs';
import { captureFor, performSourceEdit } from '../source-edit/editing.mjs';
import { extractSourceAnchor, normalizeHeadingTitle, skeletonText } from '../source-edit/markdown.mjs';

// Accepted baseline amendments (spec §3.3). One authorized command applies the
// source edit through the T05 transactional editor, re-records the affected
// baseline records against the amended content, and carries linked plan
// references forward in a single journaled transaction. A wording-only
// difference preserves semantic versions; only a behavioral change creates a
// new baseline revision plus invalidation facts naming the affected plans.
const clone = value => JSON.parse(JSON.stringify(value));
const sameJSON = (left, right) => canonicalJSON(left) === canonicalJSON(right);
const compact = value => Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));

const HISTORICAL_LIFECYCLES = Object.freeze(['completed', 'superseded', 'abandoned']);
const METADATA_KEYS = Object.freeze(['kind', 'state', 'strength', 'related_item_ids', 'applicability',
  'rationale', 'authority', 'chosen', 'rejected', 'superseded_by']);

function resolveAmendedSource(state, reference, context) {
  const source = state.sources.find(entry => entry.id === reference.source_id);
  if (!source) fail('UNKNOWN_SOURCE', 'The document must be registered before binding a baseline item');
  if (source.accepted_sha256 !== reference.sha256) fail('SOURCE_REVISION_MISMATCH', 'Amended items must bind the accepted post-amendment source digest');
  const capture = captureFor(state, source.id, context, source.path, reference.sha256);
  return { source, ...extractSourceAnchor(capture.content, reference.anchor_id, source.path) };
}

function validateItemInput(state, input, knownIds) {
  const existing = state.items.find(entry => entry.id === input.id);
  if (existing && existing.kind !== input.kind) fail('IDENTITY_KIND_MISMATCH', 'An existing item cannot change kind');
  const related = input.related_item_ids ?? [];
  unique(related, value => value, 'related items');
  if (related.some(value => value === input.id || !knownIds.has(value))) fail('INVALID_REFERENCE', 'A related item must reference another known baseline identity');
  if (input.superseded_by != null) {
    const successor = state.items.find(entry => entry.id === input.superseded_by);
    if (!successor || successor.kind !== 'decision' || successor.id === input.id) {
      fail('INVALID_REFERENCE', 'A supersession link must reference another decision item');
    }
  }
  if (input.applicability?.scope === 'component') for (const subject of input.applicability.subject_ids ?? []) {
    const knownArchitecture = (state.architecture ?? []).some(entry => entry.id === subject);
    if (!knownIds.has(subject) && !knownArchitecture) fail('INVALID_REFERENCE', 'An applicability scope references an unknown identity');
  }
}

// Semantic equality reuses the source-edit skeleton concept: whitespace-only
// differences outside fenced examples are wording, not meaning.
function itemSemanticallyEqual(details, prior) {
  if (!METADATA_KEYS.every(key => sameJSON(details[key], prior[key]))) return false;
  return normalizeHeadingTitle(details.title) === normalizeHeadingTitle(prior.title) &&
    skeletonText(details.text) === skeletonText(prior.text);
}

function invalidationFact(state, itemId, fromRevision, toRevision) {
  const affected = state.plans
    .filter(plan => plan.baseline_refs.some(reference => reference.item_id === itemId &&
      reference.item_revision < toRevision))
    .map(plan => ({ plan_id: plan.id,
      considered_revision: plan.baseline_refs.find(reference => reference.item_id === itemId).item_revision,
      carried_forward: false }));
  if (!affected.length) return null;
  return { item_id: itemId, from_revision: fromRevision, to_revision: toRevision,
    reason: 'BEHAVIORAL_REQUIREMENT_CHANGE', affected };
}

// Applies the explicitly accepted item records. `priorById` holds each item's
// pre-command content so the T05 edit ripple (which compares extracted text
// exactly) can be reclassified against amendment semantics.
function applyAmendedItems(state, inputs, context, priorById) {
  unique(inputs, entry => entry.id, 'amendment items');
  const knownIds = new Set([...state.items.map(entry => entry.id), ...inputs.map(entry => entry.id)]);
  const payloadIds = new Set(inputs.map(entry => entry.id));
  const changedIds = [];
  const invalidations = [];
  let baselineChanged = false;
  for (const input of inputs) {
    validateItemInput(state, input, knownIds);
    const source = resolveAmendedSource(state, input.source, context);
    const details = clone(compact({ kind: input.kind, title: source.title, text: source.text, state: input.state,
      strength: input.strength ?? (input.kind === 'principle' ? 'binding' : 'advisory'),
      related_item_ids: [...(input.related_item_ids ?? [])], applicability: input.applicability,
      rationale: input.rationale, authority: input.authority, chosen: input.chosen,
      rejected: input.rejected, superseded_by: input.superseded_by }));
    const existing = state.items.find(entry => entry.id === input.id);
    if (!existing) {
      state.items.push({ id: input.id, ...details, source: clone(input.source), revision: 1,
        recorded_by: context.actor, recorded_at: context.occurredAt });
      changedIds.push(input.id);
      baselineChanged = true;
      continue;
    }
    const prior = priorById.get(input.id) ?? clone(existing);
    if (itemSemanticallyEqual(details, prior)) {
      // Wording-only: the record's bytes follow the amended document while the
      // semantic version — and every reference pinned to it — stay unchanged.
      if (existing.revision > prior.revision) existing.revision = prior.revision;
      if (sameJSON(details, compact(Object.fromEntries(Object.keys(details).map(key => [key, existing[key]]))))) continue;
      const replacement = { ...clone(existing), ...details, source: clone(input.source),
        recorded_by: context.actor, recorded_at: context.occurredAt };
      state.items[state.items.indexOf(existing)] = replacement;
      changedIds.push(input.id);
      continue;
    }
    const toRevision = Math.max(existing.revision, prior.revision + 1);
    const replacement = { id: input.id, ...details, source: clone(input.source),
      revision: toRevision, recorded_by: context.actor, recorded_at: context.occurredAt };
    state.items[state.items.indexOf(existing)] = replacement;
    changedIds.push(input.id);
    baselineChanged = true;
    const fact = invalidationFact(state, input.id, prior.revision, toRevision);
    if (fact) invalidations.push(fact);
  }
  // Collateral ripple: the T05 edit already bumped items bound to the amended
  // document that this acceptance did not re-record. Those stay behavioral.
  for (const [itemId, prior] of priorById) {
    if (payloadIds.has(itemId)) continue;
    const current = state.items.find(entry => entry.id === itemId);
    if (current.revision > prior.revision) {
      baselineChanged = true;
      const fact = invalidationFact(state, itemId, prior.revision, current.revision);
      if (fact) invalidations.push(fact);
    }
  }
  return { changedIds, invalidations, baselineChanged };
}

function applyPlanReferenceUpdates(state, updates, invalidations, context) {
  unique(updates, entry => entry.plan_id, 'amendment plan updates');
  const changedIds = [];
  for (const update of updates) {
    const plan = state.plans.find(entry => entry.id === update.plan_id);
    if (!plan) fail('UNKNOWN_PLAN', 'A linked plan update references an unknown plan');
    if (HISTORICAL_LIFECYCLES.includes(plan.declared_lifecycle)) {
      fail('HISTORICAL_PLAN_IMMUTABLE', 'A historical plan keeps the baseline revisions it considered');
    }
    unique(update.baseline_refs, reference => reference.item_id, 'plan baseline references');
    for (const reference of update.baseline_refs) {
      const item = state.items.find(entry => entry.id === reference.item_id);
      if (!item) fail('UNKNOWN_ITEM', 'A plan references an unknown baseline item');
      if (reference.item_revision > item.revision) fail('INVALID_REFERENCE', 'A plan cannot reference an unknown future baseline revision');
    }
    if (sameJSON(update.baseline_refs, plan.baseline_refs)) continue;
    plan.baseline_refs = clone(update.baseline_refs);
    plan.revision += 1;
    plan.updated_at = context.occurredAt;
    changedIds.push(plan.id);
  }
  // References this same transaction carried to the amended revision are not
  // pending reconciliation work; everything else stays an open invalidation.
  for (const fact of invalidations) for (const entry of fact.affected) {
    const plan = state.plans.find(candidate => candidate.id === entry.plan_id);
    const reference = plan?.baseline_refs.find(candidate => candidate.item_id === fact.item_id);
    if (reference && reference.item_revision >= fact.to_revision) entry.carried_forward = true;
  }
  return changedIds;
}

// The amend_baseline reducer. `state` is the command's working clone; any
// refusal discards it whole, so a rejected amendment leaves no partial effect.
export function amendBaseline(state, payload, context) {
  if (!payload.items.length) fail('EMPTY_CHANGE', 'At least one amended baseline item is required');
  let proposal = null;
  if (payload.proposal_id != null) {
    proposal = (state.proposals ?? []).find(entry => entry.id === payload.proposal_id);
    if (!proposal) fail('UNKNOWN_PROPOSAL', 'The acceptance references an unknown proposal');
    if (proposal.state !== 'proposed') fail('INVALID_VALUE', 'Only a proposed amendment can be accepted');
    if (!proposal.patches.every(patch => patch.source_id === payload.source.source_id)) {
      fail('PROPOSAL_SOURCE_MISMATCH', 'The acceptance must amend the source its proposal targets');
    }
  }
  // The transaction's contract is checked before any content moves, so an
  // incoherent acceptance is a typed refusal rather than a partial ripple.
  // Within this transaction an item can advance at most one revision: by
  // explicit re-recording or by the edit ripple on the amended source.
  const amendable = new Set([...payload.items.map(entry => entry.id),
    ...state.items.filter(entry => entry.source.source_id === payload.source.source_id).map(entry => entry.id)]);
  unique(payload.plan_updates, entry => entry.plan_id, 'amendment plan updates');
  for (const update of payload.plan_updates) {
    const plan = state.plans.find(entry => entry.id === update.plan_id);
    if (!plan) fail('UNKNOWN_PLAN', 'A linked plan update references an unknown plan');
    if (HISTORICAL_LIFECYCLES.includes(plan.declared_lifecycle)) {
      fail('HISTORICAL_PLAN_IMMUTABLE', 'A historical plan keeps the baseline revisions it considered');
    }
    for (const reference of update.baseline_refs) {
      const item = state.items.find(entry => entry.id === reference.item_id);
      if (!item) fail('UNKNOWN_ITEM', 'A plan references an unknown baseline item');
      if (reference.item_revision > item.revision + (amendable.has(item.id) ? 1 : 0)) {
        fail('INVALID_REFERENCE', 'A plan cannot reference a revision this transaction cannot reach');
      }
    }
  }
  const source = state.sources.find(entry => entry.id === payload.source.source_id);
  if (!source) fail('UNKNOWN_SOURCE', 'The amendment targets an unregistered source');
  const priorBaseline = state.baseline_revision;
  const priorById = new Map(state.items
    .filter(entry => entry.source.source_id === payload.source.source_id)
    .map(entry => [entry.id, clone(entry)]));
  // The whole edit set applies through the T05 transactional editor, so fenced
  // examples, unrelated prose and line endings keep their exact bytes and the
  // file write lands inside this command's journaled transaction.
  const outcome = payload.edits.length ? performSourceEdit(state, {
    authority: payload.authority, source_id: payload.source.source_id,
    expected_sha256: payload.source.expected_sha256,
    expected_source_revision: payload.source.expected_source_revision, edits: payload.edits,
  }, context) : { changed_ids: [], writes: [] };
  const amendedContext = outcome.writes.length ? { ...context,
    capturedSources: [...context.capturedSources.filter(entry => entry.source_id !== payload.source.source_id),
      { source_id: payload.source.source_id, path: source.path, sha256: source.accepted_sha256,
        content: outcome.writes[0].content }] } : context;

  const items = applyAmendedItems(state, payload.items, amendedContext, priorById);
  const planIds = applyPlanReferenceUpdates(state, payload.plan_updates, items.invalidations, context);
  // One accepted command moves the accepted baseline revision at most once.
  state.baseline_revision = priorBaseline + (items.baselineChanged ? 1 : 0);
  if (proposal) {
    proposal.state = 'accepted';
    proposal.authority = payload.authority;
    proposal.revision += 1;
  }
  const changedIds = [...outcome.changed_ids];
  for (const identity of [...items.changedIds, ...planIds]) if (!changedIds.includes(identity)) changedIds.push(identity);
  if (proposal && !changedIds.includes(proposal.id)) changedIds.push(proposal.id);
  return { changed_ids: changedIds, writes: outcome.writes, invalidations: items.invalidations };
}
