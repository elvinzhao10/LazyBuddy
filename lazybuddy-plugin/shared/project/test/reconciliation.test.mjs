import test from 'node:test';
import assert from 'node:assert/strict';
import { coalesceTriggers, affectedScope, deterministicChecks, recordSemanticAssessment,
  resolveContradictionWithAuthority } from '../reconciliation.mjs';

function state() {
  return {
    revision: 4,
    items: [
      { id: 'requirement:offline', kind: 'requirement', revision: 1, state: 'accepted', superseded_by: null,
        text: 'All primary workflows work without a network.', plans: ['plan:search'] },
      { id: 'requirement:unassigned', kind: 'requirement', revision: 1, state: 'accepted', superseded_by: null,
        text: 'Data export produces a portable file.', plans: [] },
    ],
    plans: [
      { id: 'plan:search', revision: 1, declared_lifecycle: 'active', native_runs: ['run:1'],
        baseline_refs: [{ item_id: 'requirement:offline', item_revision: 1 }] },
      { id: 'plan:collaboration', revision: 1, declared_lifecycle: 'planned', native_runs: [],
        baseline_refs: [] },
    ],
    proposals: [
      { id: 'proposal:cloud-signin', targets: ['requirement:offline'],
        passage: { text: 'Require cloud sign-in before a workspace opens.', anchor: 'plans/collaboration.md#signin' },
        state: 'proposed' },
    ],
  };
}

test('triggers coalesce by changed-revision signature', () => {
  const coalesced = coalesceTriggers([
    { kind: 'source-change', changed: ['b', 'a'] },
    { kind: 'source-change', changed: ['a', 'b'] },
    { kind: 'source-change', changed: ['a', 'b', 'c'] },
  ]);
  assert.equal(coalesced.length, 2);
  assert.equal(coalesced[0].count, 2);
  assert.deepEqual(coalesced[0].changed, ['b', 'a']);
});

test('affected scope covers referencing plans and targeting proposals, nothing else', () => {
  const scope = affectedScope(state(), ['requirement:offline']);
  assert.deepEqual(scope.item_ids, ['requirement:offline']);
  assert.deepEqual(scope.plan_ids, ['plan:search']);
  assert.deepEqual(scope.proposal_ids, ['proposal:cloud-signin']);
});

test('deterministic checks report typed findings with citations', () => {
  const findings = deterministicChecks(state());
  const unassigned = findings.find(finding => finding.type === 'missing-evidence');
  assert.equal(unassigned.subject.id, 'requirement:unassigned');
  const stale = state();
  stale.items[0].superseded_by = 'requirement:offline-v2';
  const staleFindings = deterministicChecks(stale);
  assert.equal(staleFindings.some(finding => finding.type === 'stale-assumption'
    && finding.detail.includes('plan:search')), true);
  const overlap = state();
  overlap.proposals.push({ id: 'proposal:offline-rewrite', targets: ['requirement:offline'], passage: {}, state: 'proposed' });
  const overlapFindings = deterministicChecks(overlap);
  const finding = overlapFindings.find(entry => entry.type === 'overlapping-edit-scope');
  assert.match(finding.detail, /advisory until conflicting content is established/);
});

test('a semantic assessment cites both passages and is labeled an assessment, never a verdict', () => {
  const assessment = recordSemanticAssessment(state(), {
    id: 'assess:1', conflict_id: 'conflict:offline-vs-cloud',
    conclusion: 'suspected-semantic-contradiction',
    citations: [
      { kind: 'item', id: 'requirement:offline', anchor: 'requirements.md#offline', excerpt_sha256: 'a'.repeat(64) },
      { kind: 'plan-document', id: 'plan:collaboration', anchor: 'plans/collaboration.md#signin', excerpt_sha256: 'b'.repeat(64) },
    ],
    assessed_by: 'agent:root', assessed_at: '2026-10-06T14:00:00Z',
  });
  assert.equal(assessment.label, 'assessment-not-verdict');
  assert.equal(assessment.citations.length, 2);
  assert.throws(() => recordSemanticAssessment(state(), {
    id: 'assess:2', conflict_id: 'c', conclusion: 'verified', citations: [], assessed_by: 'x', assessed_at: '2026-10-06T14:00:00Z',
  }), error => error.code === 'INVALID_VALUE');
  assert.throws(() => recordSemanticAssessment(state(), {
    id: 'assess:3', conflict_id: 'c', conclusion: 'suspected-semantic-contradiction',
    citations: [{ kind: 'item', id: 'one' }], assessed_by: 'x', assessed_at: '2026-10-06T14:00:00Z',
  }), error => error.code === 'INVALID_VALUE');
});

test('the offline-vs-mandatory-cloud conflict resolves by consuming a user instruction and stays honest', () => {
  const working = state();
  const before = JSON.stringify(working.plans.find(plan => plan.id === 'plan:search'));
  const record = resolveContradictionWithAuthority(working, {
    conflict_id: 'conflict:offline-vs-cloud',
    choice: 'retain-baseline-revise-proposal',
    authority: { kind: 'user-instruction', reference: 'chat 2026-10-06: keep offline operation; sign-in becomes optional' },
    patch: { proposal_id: 'proposal:cloud-signin',
      revised_passage: { text: 'Cloud sign-in is optional; every primary workflow stays available offline.', anchor: 'plans/collaboration.md#signin' } },
  }, { occurredAt: '2026-10-06T14:05:00Z' });
  const proposal = working.proposals.find(entry => entry.id === 'proposal:cloud-signin');
  assert.equal(proposal.passage.text, 'Cloud sign-in is optional; every primary workflow stays available offline.');
  assert.equal(proposal.state, 'proposed'); // still a proposal: no silent acceptance
  assert.equal(record.patch.still_a_proposal, true);
  assert.match(record.acceptance_effect, /remains a proposal/);
  // Unrelated work stays runnable: the accepted plan and its references are untouched.
  assert.equal(JSON.stringify(working.plans.find(plan => plan.id === 'plan:search')), before);
  assert.equal(working.plans.find(plan => plan.id === 'plan:collaboration').declared_lifecycle, 'planned');
  // An unaccepted suggestion is not authority.
  assert.throws(() => resolveContradictionWithAuthority(state(), {
    conflict_id: 'c', choice: 'retain-baseline-revise-proposal',
    authority: { kind: 'agent-suggestion', reference: 'maybe offline wins' },
    patch: { proposal_id: 'proposal:cloud-signin', revised_passage: { text: 'x', anchor: 'y' } },
  }), error => error.code === 'INVALID_VALUE');
});

test('amend-baseline resolutions defer to the existing amendment authority', () => {
  let applied = null;
  const record = resolveContradictionWithAuthority(state(), {
    conflict_id: 'conflict:offline-vs-cloud', choice: 'amend-baseline',
    authority: { kind: 'user-instruction', reference: 'chat 2026-10-06: network sign-in becomes required' },
    patch: { amendment: { item_id: 'requirement:offline', text: 'Primary workflows prefer a network; offline stays best-effort.' } },
  }, { amendBaseline: (stateArg, payload) => { applied = payload; return { changedIds: ['requirement:offline'] }; } });
  assert.equal(record.patch.kind, 'baseline-amendment-request');
  assert.match(record.acceptance_effect, /amend_baseline applies/);
  assert.equal(applied, null); // this record never applies the amendment by itself
  assert.throws(() => resolveContradictionWithAuthority(state(), {
    conflict_id: 'c', choice: 'amend-baseline',
    authority: { kind: 'user-instruction', reference: 'r' }, patch: { amendment: {} },
  }), error => error.code === 'INVALID_VALUE'); // no amendBaseline route wired
});
