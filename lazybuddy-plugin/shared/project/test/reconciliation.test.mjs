import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createProject, applyProjectCommand } from '../model.mjs';
import { assertProjectState } from '../contract.mjs';
import { coalesceTriggers, affectedScope, deterministicChecks, recordSemanticAssessment,
  resolveContradictionWithAuthority } from '../reconciliation.mjs';

// Every state below is produced by the real command route (applyProjectCommand
// over registered document captures), never hand-shaped: reconciliation runs
// against exactly the records the contract can persist (F-06 regression).
const CREATED_AT = '2026-10-05T15:00:00.000Z';
const PROJECT_ID = 'project:offline-notebook';
const INITIAL = Object.freeze({
  projectId: PROJECT_ID,
  runtime: 'LazyBuddy',
  repositoryKey: 'repo:offline-notebook',
  createdAt: CREATED_AT,
});
const hash = content => createHash('sha256').update(content).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const byId = (records, id) => {
  const result = records.find(record => record.id === id);
  assert.ok(result, `Expected a record for ${id}`);
  return result;
};

const REQUIREMENTS_BASE = readFileSync(new URL('./fixtures/offline-notebook/requirements.md', import.meta.url), 'utf8');
const DECISIONS = readFileSync(new URL('./fixtures/offline-notebook/decisions.md', import.meta.url), 'utf8');
const COLLABORATION = readFileSync(new URL('./fixtures/offline-notebook/plans/collaboration.md', import.meta.url), 'utf8');
const REQUIREMENTS = `${REQUIREMENTS_BASE}\n## requirement:export — Export without add-ons\n\nData export produces a portable file without a network.\n`;

const SOURCES = Object.freeze([
  { id: 'source:requirements', path: 'docs/project/requirements.md', role: 'requirements', content: REQUIREMENTS },
  { id: 'source:decisions', path: 'docs/project/decisions.md', role: 'decision', content: DECISIONS },
  { id: 'source:collaboration', path: '.omo/plans/collaboration.md', role: 'plan', content: COLLABORATION },
]);

function harness() {
  const capturedSources = SOURCES.map(source => ({ source_id: source.id, path: source.path,
    sha256: hash(source.content), content: source.content }));
  const h = {
    state: createProject(INITIAL),
    capturedSources,
    nextId: 0,
    context(extra = {}) {
      return { actor: 'user:test', occurredAt: CREATED_AT, capturedSources: this.capturedSources, ...extra };
    },
    command(operation, payload) {
      return { schema_version: 1, command_id: `command:${++this.nextId}`, project_id: PROJECT_ID,
        expected_revision: this.state.revision, operation, payload };
    },
    apply(operation, payload, contextExtra = {}) {
      const before = clone(this.state);
      const result = applyProjectCommand(this.state, this.command(operation, payload), this.context(contextExtra));
      assert.deepEqual(this.state, before, 'Applying a command must not mutate its input state');
      assert.equal(result.receipt.status, 'saved', operation);
      this.state = result.state;
      return result;
    },
  };
  return h;
}

function sourceReference(h, sourceId, anchorId = 'document') {
  const source = h.capturedSources.find(record => record.source_id === sourceId);
  assert.ok(source, `Expected captured source ${sourceId}`);
  return { source_id: sourceId, sha256: source.sha256, anchor_id: anchorId };
}

function reconciledProject() {
  const h = harness();
  for (const { id, path, role } of SOURCES) h.apply('register_source', { id, path, role });
  h.apply('record_baseline_items', { items: [
    { id: 'feature:notes', kind: 'feature', state: 'accepted',
      source: sourceReference(h, 'source:requirements', 'heading:feature:notes — Personal notes') },
    { id: 'requirement:offline', kind: 'requirement', state: 'accepted',
      source: sourceReference(h, 'source:requirements', 'heading:requirement:offline — Work without a network') },
    { id: 'requirement:export', kind: 'requirement', state: 'accepted',
      source: sourceReference(h, 'source:requirements', 'heading:requirement:export — Export without add-ons') },
    { id: 'decision:standard-import-format', kind: 'decision', state: 'accepted',
      chosen: 'Adopt the standard import format once the migration period ends.',
      rejected: ['Extending the legacy import format further.'],
      source: sourceReference(h, 'source:decisions', 'heading:decision:standard-import-format — Adopt the standard import format') },
    { id: 'decision:legacy-import-format', kind: 'decision', state: 'accepted',
      chosen: 'Keep the legacy import format through the migration period.',
      rejected: ['Removing it before the migration period ends.'],
      superseded_by: 'decision:standard-import-format',
      source: sourceReference(h, 'source:decisions', 'heading:decision:legacy-import-format — Keep the legacy import format') },
  ] });
  h.apply('plan.create', { id: 'plan:collaboration', declared_lifecycle: 'planned',
    source: sourceReference(h, 'source:collaboration'),
    baseline_refs: [{ item_id: 'requirement:offline', item_revision: 1 }] });
  h.apply('record_baseline_proposal', { id: 'proposal:cloud-signin',
    summary: 'The collaboration plan proposes mandatory cloud sign-in against the accepted offline requirement.',
    patches: [{ source_id: 'source:requirements', anchor_id: 'heading:requirement:offline — Work without a network',
      current_sha256: hash(REQUIREMENTS),
      proposed_text: 'Optional cloud sign-in must never block local reading or search.' }],
    options: [
      { id: 'option:retain-offline', title: 'Retain offline operation', summary: 'Revise sign-in to be optional.' },
      { id: 'option:amend-requirement', title: 'Amend the requirement', summary: 'Accept mandatory sign-in with its consequences.' },
    ],
    impact: { item_ids: ['requirement:offline'], plan_ids: [], architecture_ids: [] },
    evidence_observation_ids: [] });
  assertProjectState(h.state);
  return h;
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

test('affected scope covers referencing plans and impacting proposals on real state', () => {
  const h = reconciledProject();
  const scope = affectedScope(h.state, ['requirement:offline']);
  assert.deepEqual(scope.item_ids, ['requirement:offline']);
  assert.deepEqual(scope.plan_ids, ['plan:collaboration']);
  assert.deepEqual(scope.proposal_ids, ['proposal:cloud-signin']);
  const untouched = affectedScope(h.state, ['requirement:export']);
  assert.deepEqual(untouched.plan_ids, []);
  assert.deepEqual(untouched.proposal_ids, []);
});

test('deterministic checks read the real contract: referenced requirements are not unassigned', () => {
  const h = reconciledProject();
  const findings = deterministicChecks(h.state);
  const unassigned = findings.find(finding => finding.type === 'missing-evidence');
  assert.equal(unassigned.subject.id, 'requirement:export');
  assert.equal(findings.some(finding => finding.type === 'missing-evidence'
    && finding.subject.id === 'requirement:offline'), false,
  'an accepted requirement referenced by a plan is not flagged as missing a contributing plan');
});

test('a plan citing a superseded decision without its successor is a stale assumption', () => {
  const h = reconciledProject();
  h.apply('plan.edit', { id: 'plan:collaboration', source: sourceReference(h, 'source:collaboration'),
    baseline_refs: [{ item_id: 'requirement:offline', item_revision: 1 },
      { item_id: 'decision:legacy-import-format', item_revision: 1 }] });
  const findings = deterministicChecks(h.state);
  const stale = findings.find(finding => finding.type === 'stale-assumption');
  assert.ok(stale, 'expected a stale-assumption finding');
  assert.equal(stale.subject.id, 'plan:collaboration');
  assert.match(stale.detail, /decision:standard-import-format/);
});

test('overlapping proposals over the same item fire through impact.item_ids', () => {
  const h = reconciledProject();
  h.apply('record_baseline_proposal', { id: 'proposal:offline-rewrite',
    summary: 'Rewrite the offline requirement from another angle.',
    patches: [], options: [],
    impact: { item_ids: ['requirement:offline'], plan_ids: [], architecture_ids: [] },
    evidence_observation_ids: [] });
  const findings = deterministicChecks(h.state);
  const finding = findings.find(entry => entry.type === 'overlapping-edit-scope');
  assert.ok(finding, 'expected an overlapping-edit-scope finding');
  assert.equal(finding.subject.id, 'requirement:offline');
  assert.match(finding.detail, /advisory until conflicting content is established/);
  assert.deepEqual(finding.citations.map(citation => citation.id).sort(), ['proposal:cloud-signin', 'proposal:offline-rewrite']);
});

test('a semantic assessment cites both passages and is labeled an assessment, never a verdict', () => {
  const h = reconciledProject();
  const assessment = recordSemanticAssessment(h.state, {
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
  assert.throws(() => recordSemanticAssessment(h.state, {
    id: 'assess:2', conflict_id: 'c', conclusion: 'verified', citations: [], assessed_by: 'x', assessed_at: '2026-10-06T14:00:00Z',
  }), error => error.code === 'INVALID_VALUE');
  assert.throws(() => recordSemanticAssessment(h.state, {
    id: 'assess:3', conflict_id: 'c', conclusion: 'suspected-semantic-contradiction',
    citations: [{ kind: 'item', id: 'one' }], assessed_by: 'x', assessed_at: '2026-10-06T14:00:00Z',
  }), error => error.code === 'INVALID_VALUE');
});

test('the offline-vs-mandatory-cloud conflict resolves by consuming a user instruction and stays contract-valid', () => {
  const h = reconciledProject();
  const working = clone(h.state);
  const before = JSON.stringify(working.plans.find(plan => plan.id === 'plan:collaboration'));
  const record = resolveContradictionWithAuthority(working, {
    conflict_id: 'conflict:offline-vs-cloud',
    choice: 'retain-baseline-revise-proposal',
    authority: { kind: 'user-instruction', reference: 'chat 2026-10-06: keep offline operation; sign-in becomes optional' },
    patch: { proposal_id: 'proposal:cloud-signin',
      revised_passage: { text: 'Cloud sign-in is optional; every primary workflow stays available offline.',
        anchor: 'heading:requirement:offline — Work without a network' } },
  }, { occurredAt: '2026-10-06T14:05:00Z' });
  // The resolution may only produce records the accepted-state contract can
  // persist: no invented proposal fields survive assertProjectState.
  assertProjectState(working);
  const proposal = working.proposals.find(entry => entry.id === 'proposal:cloud-signin');
  assert.equal(proposal.patches[0].proposed_text, 'Cloud sign-in is optional; every primary workflow stays available offline.');
  assert.equal(proposal.state, 'proposed'); // still a proposal: no silent acceptance
  assert.equal(record.patch.still_a_proposal, true);
  assert.match(record.acceptance_effect, /remains a proposal/);
  // Unrelated work stays runnable: the accepted plan and its references are untouched.
  assert.equal(JSON.stringify(working.plans.find(plan => plan.id === 'plan:collaboration')), before);
  assert.equal(working.plans.find(plan => plan.id === 'plan:collaboration').declared_lifecycle, 'planned');
  // A revision that names no patch of the proposal is refused.
  assert.throws(() => resolveContradictionWithAuthority(clone(h.state), {
    conflict_id: 'c', choice: 'retain-baseline-revise-proposal',
    authority: { kind: 'user-instruction', reference: 'r' },
    patch: { proposal_id: 'proposal:cloud-signin', revised_passage: { text: 'x', anchor: 'heading:unknown — Not a patch' } },
  }), error => error.code === 'INVALID_REFERENCE');
  // An unaccepted suggestion is not authority.
  assert.throws(() => resolveContradictionWithAuthority(clone(h.state), {
    conflict_id: 'c', choice: 'retain-baseline-revise-proposal',
    authority: { kind: 'agent-suggestion', reference: 'maybe offline wins' },
    patch: { proposal_id: 'proposal:cloud-signin', revised_passage: { text: 'x', anchor: 'heading:requirement:offline — Work without a network' } },
  }), error => error.code === 'INVALID_VALUE');
});

test('amend-baseline resolutions defer to the existing amendment authority', () => {
  const h = reconciledProject();
  let applied = null;
  const record = resolveContradictionWithAuthority(h.state, {
    conflict_id: 'conflict:offline-vs-cloud', choice: 'amend-baseline',
    authority: { kind: 'user-instruction', reference: 'chat 2026-10-06: network sign-in becomes required' },
    patch: { amendment: { item_id: 'requirement:offline', text: 'Primary workflows prefer a network; offline stays best-effort.' } },
  }, { amendBaseline: (stateArg, payload) => { applied = payload; return { changedIds: ['requirement:offline'] }; } });
  assert.equal(record.patch.kind, 'baseline-amendment-request');
  assert.match(record.acceptance_effect, /amend_baseline applies/);
  assert.equal(applied, null); // this record never applies the amendment by itself
  assertProjectState(h.state);
  assert.throws(() => resolveContradictionWithAuthority(h.state, {
    conflict_id: 'c', choice: 'amend-baseline',
    authority: { kind: 'user-instruction', reference: 'r' }, patch: { amendment: {} },
  }), error => error.code === 'INVALID_VALUE'); // no amendBaseline route wired
});
