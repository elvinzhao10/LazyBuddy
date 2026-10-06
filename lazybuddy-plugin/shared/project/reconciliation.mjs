// Reconciliation (spec §6). Reconciliation is an observable workflow with its
// own requests, results and unresolved choices: triggers are coalesced by the
// changed revisions, deterministic checks produce typed conflict records, agent
// assessments are labeled assessments with citations (never verifier verdicts),
// and a resolution consumes recorded authority through the same command route
// the UI uses. Deterministic semantic contradictions between accepted baseline
// text and a proposal's conflicting passage cite both sources and produce an
// exact patch; unrelated work is never blocked by a pending conflict.
import { fail } from './contract.mjs';

const CONFLICT_TYPES = Object.freeze(['deterministic-contract-violation', 'suspected-semantic-contradiction',
  'overlapping-edit-scope', 'actual-git-conflict', 'predicted-merge-conflict', 'stale-assumption',
  'missing-evidence']);

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function fields(value, allowed, path) {
  if (!plain(value)) fail('INVALID_VALUE', `${path} must be a plain object`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key)) fail('UNKNOWN_FIELD', `${path} has an unsupported field`);
  }
}

// Coalesce triggers by their changed-revision signature so the agent is never
// asked the same question twice for identical inputs.
export function coalesceTriggers(triggers) {
  if (!Array.isArray(triggers)) fail('INVALID_VALUE', 'Triggers must be an array');
  const seen = new Map();
  const accepted = [];
  for (const trigger of triggers) {
    fields(trigger, ['kind', 'changed'], 'trigger');
    if (typeof trigger.kind !== 'string' || !trigger.kind.length) fail('INVALID_VALUE', 'A trigger needs its kind');
    if (!Array.isArray(trigger.changed)) fail('INVALID_VALUE', 'A trigger carries its changed-revision signature');
    const signature = JSON.stringify([trigger.kind, [...trigger.changed].sort()]);
    if (seen.has(signature)) { seen.get(signature).count += 1; continue; }
    const record = { kind: trigger.kind, changed: [...trigger.changed], count: 1 };
    seen.set(signature, record); accepted.push(record);
  }
  return accepted;
}

// Which accepted objects a changed set touches: the items themselves, plans
// that reference them at any revision, and proposals targeting them.
export function affectedScope(state, changedItemIds) {
  if (!Array.isArray(changedItemIds)) fail('INVALID_VALUE', 'changedItemIds must be an array');
  const itemIds = new Set(changedItemIds);
  const plans = []; const proposals = [];
  for (const plan of state.plans ?? []) {
    if ((plan.baseline_refs ?? []).some(reference => itemIds.has(reference.item_id))) plans.push(plan.id);
  }
  for (const proposal of state.proposals ?? []) {
    if ((proposal.targets ?? []).some(target => itemIds.has(target))) proposals.push(proposal.id);
  }
  return { item_ids: [...itemIds], plan_ids: plans, proposal_ids: proposals };
}

// Deterministic checks over current accepted state. Each finding is typed per
// the §6 taxonomy and cites its sources; none of them claims semantic meaning
// beyond what the structures themselves establish.
export function deterministicChecks(state) {
  const findings = [];
  for (const plan of state.plans ?? []) {
    for (const reference of plan.baseline_refs ?? []) {
      const item = (state.items ?? []).find(entry => entry.id === reference.item_id);
      if (!item) {
        findings.push({ type: 'deterministic-contract-violation', subject: { kind: 'plan', id: plan.id },
          detail: `Plan ${plan.id} references unknown item ${reference.item_id}`,
          citations: [{ kind: 'plan', id: plan.id }] });
        continue;
      }
      if (item.superseded_by != null && !(plan.baseline_refs ?? []).some(other => other.item_id === item.superseded_by)) {
        findings.push({ type: 'stale-assumption', subject: { kind: 'plan', id: plan.id },
          detail: `Plan ${plan.id} still cites superseded ${item.id} without its successor ${item.superseded_by}`,
          citations: [{ kind: 'item', id: item.id, revision: item.revision }, { kind: 'item', id: item.superseded_by }] });
      }
    }
  }
  const byTarget = new Map();
  for (const proposal of state.proposals ?? []) {
    for (const target of proposal.targets ?? []) {
      const list = byTarget.get(target) ?? [];
      list.push(proposal.id); byTarget.set(target, list);
    }
  }
  for (const [target, proposalIds] of byTarget) {
    if (proposalIds.length > 1) {
      findings.push({ type: 'overlapping-edit-scope', subject: { kind: 'item', id: target },
        detail: `Proposals ${proposalIds.join(', ')} all target ${target}; overlap is advisory until conflicting content is established`,
        citations: proposalIds.map(id => ({ kind: 'proposal', id })) });
    }
  }
  for (const item of state.items ?? []) {
    if (item.state === 'accepted' && (item.plans ?? []).length === 0 && item.kind === 'requirement') {
      findings.push({ type: 'missing-evidence', subject: { kind: 'item', id: item.id },
        detail: `Accepted requirement ${item.id} has no contributing plan; it stays visible as unassigned`,
        citations: [{ kind: 'item', id: item.id, revision: item.revision }] });
    }
  }
  return findings;
}

// An agent assessment of a suspected semantic contradiction. It is labeled an
// assessment, carries citations on both sides, and grants nothing: no
// verification, no acceptance, no schedule change.
export function recordSemanticAssessment(state, assessment) {
  fields(assessment, ['id', 'conflict_id', 'conclusion', 'citations', 'assessed_by', 'assessed_at'], 'assessment');
  if (typeof assessment.id !== 'string' || !assessment.id.length) fail('INVALID_ID', 'An assessment needs an identity');
  if (assessment.conclusion !== 'suspected-semantic-contradiction') {
    fail('INVALID_VALUE', 'A recorded assessment of this module is a suspected contradiction, never a verdict');
  }
  if (!Array.isArray(assessment.citations) || assessment.citations.length < 2) {
    fail('INVALID_VALUE', 'A semantic contradiction assessment cites BOTH passages');
  }
  for (const citation of assessment.citations) {
    fields(citation, ['kind', 'id', 'anchor', 'excerpt_sha256'], 'citation');
    if (!['item', 'plan-document'].includes(citation.kind)) {
      fail('INVALID_VALUE', 'A citation points at an accepted item or a plan document passage');
    }
    if (typeof citation.id !== 'string' || !citation.id.length) fail('INVALID_ID', 'A citation needs its target');
  }
  if (typeof assessment.assessed_by !== 'string' || !assessment.assessed_by.length) {
    fail('INVALID_VALUE', 'An assessment names its assessing agent');
  }
  return { id: assessment.id, conflict_id: assessment.conflict_id, label: 'assessment-not-verdict',
    conclusion: assessment.conclusion, citations: assessment.citations.map(citation => ({ ...citation })),
    assessed_by: assessment.assessed_by, assessed_at: assessment.assessed_at };
}

// Resolve a suspected contradiction by consuming recorded authority. A user
// instruction that already chooses the behavior is sufficient authority (spec
// §6 step 6): retain the accepted side and revise the proposal's passage, or
// amend the requirement (which the caller then accepts through amend_baseline).
// Either way the result is an exact patch plus a reconciliation record, and no
// unrelated plan is touched.
export function resolveContradictionWithAuthority(state, { conflict_id, choice, authority, patch }, options = {}) {
  fields(authority, ['kind', 'reference'], 'authority');
  if (authority.kind !== 'user-instruction') {
    fail('INVALID_VALUE', 'This resolution consumes a recorded user instruction; an unaccepted suggestion is not authority');
  }
  if (typeof authority.reference !== 'string' || !authority.reference.length) {
    fail('INVALID_VALUE', 'The consumed instruction carries its reference');
  }
  if (!['retain-baseline-revise-proposal', 'amend-baseline'].includes(choice)) {
    fail('INVALID_VALUE', 'A resolution chooses which side changes');
  }
  const amendBaseline = options.amendBaseline ?? null;
  const record = { conflict_id, choice, authority: { kind: authority.kind, reference: authority.reference },
    consumed_at: options.occurredAt ?? null };
  if (choice === 'retain-baseline-revise-proposal') {
    fields(patch, ['proposal_id', 'revised_passage'], 'patch');
    const proposal = (state.proposals ?? []).find(entry => entry.id === patch.proposal_id);
    if (!proposal) fail('UNKNOWN_ITEM', 'The conflicting proposal must exist to be revised');
    fields(patch.revised_passage, ['text', 'anchor'], 'revised_passage');
    if (typeof patch.revised_passage.text !== 'string' || !patch.revised_passage.text.length) {
      fail('INVALID_VALUE', 'The revised passage is the exact replacement text');
    }
    proposal.passage = { ...patch.revised_passage };
    proposal.resolution = { conflict_id, retained: 'baseline', authority_reference: authority.reference };
    record.patch = { kind: 'proposal-passage-revision', proposal_id: proposal.id,
      revised_text: patch.revised_passage.text, still_a_proposal: true };
    record.acceptance_effect = 'none — the revised idea remains a proposal until accepted through the baseline authority';
    return record;
  }
  if (!amendBaseline) fail('INVALID_VALUE', 'Amending the baseline routes through the existing amendment authority');
  fields(patch, ['amendment'], 'patch');
  record.patch = { kind: 'baseline-amendment-request', amendment: patch.amendment,
    note: 'apply through amend_baseline; this record never accepts it by itself' };
  record.acceptance_effect = 'deferred — amend_baseline applies the accepted change atomically';
  return record;
}

export const RECONCILIATION_CONFLICT_TYPES = CONFLICT_TYPES;
