import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture, write, sha256 } from '../qa/helpers.mjs';
import { fenceSpans } from '../source-edit/markdown.mjs';

// T06 interface under test: accepted baseline records, applicability, and
// amendment proposals (spec §3.3). One authorized acceptance amends the
// baseline record AND its linked plan references in one journaled transaction;
// wording-only differences preserve semantic versions; behavioral changes emit
// invalidation facts; unaccepted proposals and missing authority never mutate
// the accepted baseline; historical completions are never reopened.
const CLI = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const PROJECT_ID = 'project:baseline';
const ACTOR = 'local:baseline-test';
const PLAN_RELATIVE = '.omo/plans/delivery.md';
const HISTORY_RELATIVE = '.omo/plans/history.md';

const PLAN = `# Delivery plan

Intro prose that must survive amendments untouched.

## Requirement — Offline operation

- [ ] Work without a network

## Unassigned — Telemetry opt-in

- [ ] Telemetry stays opt-in

## Tasks

- [ ] Unrelated task

\`\`\`bash
# Fenced example: must stay byte-identical through every amendment
- [ ] fake checklist item inside the fence
lazybuddy verify --strict
\`\`\`

Closing prose.
`;

const HISTORY = `# Historical delivery

An old completed plan whose execution stays closed.

## Scope

- [x] Delivered long ago
`;

function invoke(root, action, payload, options = {}) {
  const arguments_ = [CLI, action, '--project-root', root, '--project-id', options.projectId ?? PROJECT_ID, '--actor', ACTOR];
  const result = spawnSync(process.execPath, arguments_, {
    encoding: 'utf8', input: payload === undefined ? undefined : JSON.stringify(payload),
    timeout: 25000, maxBuffer: 12 * 1024 * 1024, env: { ...process.env, ...(options.env ?? {}) },
  });
  assert.equal(result.error, undefined, result.error?.message);
  return { ...result, json: (() => { try { return JSON.parse(result.stdout); } catch { return null; } })() };
}

function stateOf(root) {
  return JSON.parse(fs.readFileSync(path.join(root, '.lazybuddy/project/state.json'), 'utf8'));
}

function stateBytes(root) {
  return fs.readFileSync(path.join(root, '.lazybuddy/project/state.json'));
}

// Composes against the revision currently on disk and invokes the command
// route. Every helper composes this way — a stale expected_revision is never
// allowed to masquerade as a product failure.
function run(root, id, operation, payload) {
  const command = { schema_version: 1, command_id: id, project_id: PROJECT_ID,
    expected_revision: stateOf(root).revision, operation, payload };
  return invoke(root, 'command', command);
}

function sourceMap(root, sourceId = 'source:plan') {
  const result = run(root, 'map:probe', 'source.map', { source_id: sourceId });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.result.status, 'ok');
  return result.json.result;
}

function anchorFor(root, title) {
  const entry = sourceMap(root).anchors.find(candidate => candidate.title === title);
  assert.ok(entry, `expected a mapped anchor for ${title}`);
  return entry.anchor_id;
}

function digestOf(target) {
  return sha256(typeof target === 'string' ? Buffer.from(target, 'utf8') : target);
}

function setupProject(name) {
  const root = fixture(name);
  const planPath = write(root, PLAN_RELATIVE, PLAN);
  write(root, HISTORY_RELATIVE, HISTORY);
  const init = invoke(root, 'init');
  assert.equal(init.status, 0, init.stderr);
  const digest = digestOf(PLAN);
  const historyDigest = digestOf(HISTORY);
  const registered = run(root, 'cmd:register-source', 'register_source',
    { id: 'source:plan', path: PLAN_RELATIVE, role: 'plan' });
  assert.equal(registered.json.receipt.status, 'saved', registered.stdout);
  const historyRegistered = run(root, 'cmd:register-history', 'register_source',
    { id: 'source:history', path: HISTORY_RELATIVE, role: 'plan' });
  assert.equal(historyRegistered.json.receipt.status, 'saved', historyRegistered.stdout);
  const items = run(root, 'cmd:baseline', 'record_baseline_items', {
    items: [
      { id: 'requirement:offline', kind: 'requirement', state: 'accepted', strength: 'binding',
        source: { source_id: 'source:plan', sha256: digest, anchor_id: 'heading:Requirement — Offline operation' } },
      { id: 'requirement:telemetry', kind: 'requirement', state: 'accepted',
        source: { source_id: 'source:plan', sha256: digest, anchor_id: 'heading:Unassigned — Telemetry opt-in' } }] });
  assert.equal(items.json.receipt.status, 'saved', items.stdout);
  const planned = run(root, 'cmd:register-plan', 'register_plan', {
    id: 'plan:delivery', source: { source_id: 'source:plan', sha256: digest, anchor_id: 'document' },
    declared_lifecycle: 'planned', baseline_refs: [{ item_id: 'requirement:offline', item_revision: 1 }] });
  assert.equal(planned.json.receipt.status, 'saved', planned.stdout);
  const completed = run(root, 'cmd:register-history-plan', 'register_plan', {
    id: 'plan:history', source: { source_id: 'source:history', sha256: historyDigest, anchor_id: 'document' },
    declared_lifecycle: 'completed', baseline_refs: [{ item_id: 'requirement:offline', item_revision: 1 }] });
  assert.equal(completed.json.receipt.status, 'saved', completed.stdout);
  return { root, planPath, digest };
}

// Composes an amendment the way a real caller must: preview the document edit
// first, then bind the re-recorded items to the previewed post-amendment digest.
function previewEdit(root, edits) {
  const stored = stateOf(root);
  const source = stored.sources.find(entry => entry.id === 'source:plan');
  const result = run(root, 'preview:compose', 'source.edit.preview', {
    authority: 'user:instruction-preview', source_id: 'source:plan',
    expected_sha256: source.accepted_sha256, expected_source_revision: source.revision, edits });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.result.status, 'valid', result.stdout);
  return result.json.result.next_sha256;
}

function offlineItemInput(nextDigest, extra = {}) {
  return { id: 'requirement:offline', kind: 'requirement', state: 'accepted', strength: 'binding',
    source: { source_id: 'source:plan', sha256: nextDigest, anchor_id: 'heading:Requirement — Offline operation' },
    ...extra };
}

const BEHAVIORAL_TEXT = 'Work without a network and queue syncs for reconnect';

test('one authorized amendment updates the baseline record and linked plan atomically', () => {
  const { root, planPath } = setupProject('authorized-amendment');
  const before = fs.readFileSync(planPath, 'utf8');
  const baselineBefore = stateOf(root).baseline_revision;
  const requirementAnchor = anchorFor(root, 'Requirement — Offline operation');
  const nextDigest = previewEdit(root,
    [{ kind: 'set_task_text', anchor_id: requirementAnchor, item: 0, text: BEHAVIORAL_TEXT }]);

  const applied = run(root, 'amend:behavioral', 'amend_baseline', {
    authority: 'user:instruction-2026-10-05',
    source: { source_id: 'source:plan', expected_sha256: digestOf(before), expected_source_revision: 1 },
    edits: [{ kind: 'set_task_text', anchor_id: requirementAnchor, item: 0, text: BEHAVIORAL_TEXT }],
    items: [offlineItemInput(nextDigest)],
    plan_updates: [{ plan_id: 'plan:delivery',
      baseline_refs: [{ item_id: 'requirement:offline', item_revision: 2 }] }] });
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(applied.json.receipt.status, 'saved', applied.stdout);

  // Byte-verification of the real file the journaled T05 route wrote: only the
  // targeted checklist line changed; fences and prose keep their bytes.
  const after = fs.readFileSync(planPath, 'utf8');
  assert.equal(after, before.replace('- [ ] Work without a network', `- [ ] ${BEHAVIORAL_TEXT}`));
  assert.equal(fenceSpans(before).map(span => span.text).join('\u0000'),
    fenceSpans(after).map(span => span.text).join('\u0000'), 'Fenced examples must stay byte-identical');

  // One journaled transaction: the state and the file agree, the journal is
  // resolved, and exactly one receipt was appended.
  const stored = stateOf(root);
  assert.equal(stored.sources.find(entry => entry.id === 'source:plan').accepted_sha256, digestOf(after));
  assert.equal(stored.items.find(entry => entry.id === 'requirement:offline').revision, 2);
  assert.equal(stored.baseline_revision, baselineBefore + 1);
  assert.deepEqual(stored.plans.find(entry => entry.id === 'plan:delivery').baseline_refs,
    [{ item_id: 'requirement:offline', item_revision: 2 }]);
  assert.equal(stored.revision, applied.json.receipt.revision);
  assert.equal(stored.receipts.length, stored.revision);
  assert.equal(fs.readdirSync(path.join(root, '.lazybuddy/project/edit-journal')).length, 0,
    'A completed amendment leaves no journal entry');

  // The decision receipt retains the invalidation facts: the carried-forward
  // plan is marked as moved by this transaction; the historical plan is not.
  assert.deepEqual(applied.json.receipt.invalidations, [{
    item_id: 'requirement:offline', from_revision: 1, to_revision: 2,
    reason: 'BEHAVIORAL_REQUIREMENT_CHANGE',
    affected: [
      { plan_id: 'plan:delivery', considered_revision: 1, carried_forward: true },
      { plan_id: 'plan:history', considered_revision: 1, carried_forward: false },
    ] }]);

  const read = invoke(root, 'read');
  assert.equal(read.json.sources.find(entry => entry.id === 'source:plan').observation.status, 'current');
  assert.equal(read.json.plans.find(entry => entry.id === 'plan:delivery').baseline_reference_status, 'current');
  assert.deepEqual(read.json.invalidations, [{
    command_id: 'amend:behavioral', occurred_at: applied.json.receipt.occurred_at,
    item_id: 'requirement:offline', from_revision: 1, to_revision: 2,
    reason: 'BEHAVIORAL_REQUIREMENT_CHANGE',
    affected: [
      { plan_id: 'plan:delivery', considered_revision: 1, carried_forward: true },
      { plan_id: 'plan:history', considered_revision: 1, carried_forward: false },
    ] }]);
  // An accepted requirement without a contributing plan stays visible.
  assert.ok(read.json.summary.unassigned_item_ids.includes('requirement:telemetry'));
  assert.ok(!read.json.summary.unassigned_item_ids.includes('requirement:offline'));
});

test('an unaccepted proposal stays proposed with zero baseline effect until accepted through authority', () => {
  const { root, planPath } = setupProject('proposal-lifecycle');
  const digest = digestOf(fs.readFileSync(planPath, 'utf8'));

  const proposed = run(root, 'proposal:offline-sync', 'record_baseline_proposal', {
    id: 'proposal:offline-sync', summary: 'Queue offline syncs for reconnect',
    patches: [{ source_id: 'source:plan', anchor_id: 'heading:Requirement — Offline operation',
      current_sha256: digest, proposed_text: `- [ ] ${BEHAVIORAL_TEXT}` }],
    options: [{ id: 'option:queue', title: 'Queue syncs', summary: 'Accept reconnect sync queues.' }],
    impact: { item_ids: ['requirement:offline'], plan_ids: ['plan:delivery'], architecture_ids: [] },
    evidence_observation_ids: [], unresolved: 'Should reconnect sync be automatic?' });
  assert.equal(proposed.status, 0, proposed.stderr);
  assert.equal(proposed.json.receipt.status, 'saved', proposed.stdout);
  const afterProposal = stateOf(root);
  assert.equal(afterProposal.proposals[0].state, 'proposed');
  assert.equal(afterProposal.proposals[0].authority, null, 'An unaccepted proposal carries no acceptance authority');
  assert.equal(afterProposal.baseline_revision, 1, 'A proposal alone never moves the accepted baseline');
  assert.equal(afterProposal.items.find(entry => entry.id === 'requirement:offline').revision, 1);
  assert.equal(digestOf(fs.readFileSync(planPath, 'utf8')), digest, 'A proposal never rewrites the original');
  assert.equal(invoke(root, 'read').json.summary.pending_proposals, 1);

  // Accepting the proposal is the authorized amendment route: it records the
  // authority on the proposal and moves it out of proposed.
  const requirementAnchor = anchorFor(root, 'Requirement — Offline operation');
  const nextDigest = previewEdit(root,
    [{ kind: 'set_task_text', anchor_id: requirementAnchor, item: 0, text: BEHAVIORAL_TEXT }]);
  const accepted = run(root, 'amend:accept-proposal', 'amend_baseline', {
    authority: 'mandate:baseline-owner-delegates-acceptance',
    source: { source_id: 'source:plan', expected_sha256: digest, expected_source_revision: 1 },
    edits: [{ kind: 'set_task_text', anchor_id: requirementAnchor, item: 0, text: BEHAVIORAL_TEXT }],
    items: [offlineItemInput(nextDigest)],
    plan_updates: [{ plan_id: 'plan:delivery',
      baseline_refs: [{ item_id: 'requirement:offline', item_revision: 2 }] }],
    proposal_id: 'proposal:offline-sync' });
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(accepted.json.receipt.status, 'saved', accepted.stdout);
  const stored = stateOf(root);
  assert.equal(stored.proposals[0].state, 'accepted');
  assert.equal(stored.proposals[0].authority, 'mandate:baseline-owner-delegates-acceptance');
  assert.equal(stored.baseline_revision, 2);
});

test('a wording-only amendment preserves semantic versions', () => {
  const { root, planPath } = setupProject('wording-only');
  const requirementAnchor = anchorFor(root, 'Requirement — Offline operation');
  const before = fs.readFileSync(planPath, 'utf8');
  const baselineBefore = stateOf(root).baseline_revision;
  const nextDigest = previewEdit(root,
    [{ kind: 'set_task_text', anchor_id: requirementAnchor, item: 0, text: 'Work without a  network' }]);

  const applied = run(root, 'amend:wording', 'amend_baseline', {
    authority: 'user:instruction-wording',
    source: { source_id: 'source:plan', expected_sha256: digestOf(before), expected_source_revision: 1 },
    edits: [{ kind: 'set_task_text', anchor_id: requirementAnchor, item: 0, text: 'Work without a  network' }],
    items: [offlineItemInput(nextDigest)],
    plan_updates: [] });
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(applied.json.receipt.status, 'saved', applied.stdout);

  // The file bytes changed (whitespace reflow) but the semantic version, the
  // accepted baseline revision, and every pinned reference stayed put.
  const after = fs.readFileSync(planPath, 'utf8');
  assert.equal(after, before.replace('- [ ] Work without a network', '- [ ] Work without a  network'));
  const stored = stateOf(root);
  const item = stored.items.find(entry => entry.id === 'requirement:offline');
  assert.equal(item.revision, 1, 'A wording-only edit preserves the item semantic version');
  assert.ok(item.text.includes('without a  network'), 'The record bytes follow the amended document');
  assert.equal(stored.baseline_revision, baselineBefore, 'A wording-only edit preserves the baseline revision');
  assert.equal(stored.sources.find(entry => entry.id === 'source:plan').revision, 2,
    'The source-document revision stays a separate counter');
  assert.equal(applied.json.receipt.invalidations, undefined, 'No relationship was invalidated');
  const read = invoke(root, 'read');
  const delivery = read.json.plans.find(entry => entry.id === 'plan:delivery');
  assert.equal(delivery.baseline_reference_status, 'current');
  assert.deepEqual(delivery.stale_item_ids, []);
  assert.deepEqual(read.json.invalidations, []);
});

test('a behavioral applicability change bumps the revision and emits invalidation facts', () => {
  const { root, planPath } = setupProject('applicability-change');
  const digest = digestOf(fs.readFileSync(planPath, 'utf8'));
  const baselineBefore = stateOf(root).baseline_revision;

  // No document edit: the accepted record itself changes scope from
  // repository-wide to an explicit migration period.
  const applied = run(root, 'amend:applicability', 'amend_baseline', {
    authority: 'user:instruction-migration-window',
    source: { source_id: 'source:plan', expected_sha256: digest, expected_source_revision: 1 },
    edits: [],
    items: [offlineItemInput(digest, {
      applicability: { scope: 'migration', subject_ids: ['feature:offline-core'], period: '2026-10-01/2027-04-01' } })],
    plan_updates: [] });
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(applied.json.receipt.status, 'saved', applied.stdout);

  const stored = stateOf(root);
  const item = stored.items.find(entry => entry.id === 'requirement:offline');
  assert.equal(item.revision, 2, 'A scope change is behavioral');
  assert.deepEqual(item.applicability, { scope: 'migration', subject_ids: ['feature:offline-core'],
    period: '2026-10-01/2027-04-01' });
  assert.equal(stored.baseline_revision, baselineBefore + 1);
  assert.deepEqual(applied.json.receipt.invalidations, [{
    item_id: 'requirement:offline', from_revision: 1, to_revision: 2,
    reason: 'BEHAVIORAL_REQUIREMENT_CHANGE',
    affected: [
      { plan_id: 'plan:delivery', considered_revision: 1, carried_forward: false },
      { plan_id: 'plan:history', considered_revision: 1, carried_forward: false },
    ] }]);
  const read = invoke(root, 'read');
  for (const plan of read.json.plans) {
    assert.equal(plan.baseline_reference_status, 'stale');
    assert.ok(plan.stale_item_ids.includes('requirement:offline'));
    assert.equal(plan.alignment, 'unassessed');
  }
});

test('a completed historical plan keeps its completion with unassessed alignment', () => {
  const { root, planPath } = setupProject('historical-preservation');
  const historyRegistration = stateOf(root).plans.find(entry => entry.id === 'plan:history');
  const requirementAnchor = anchorFor(root, 'Requirement — Offline operation');
  const before = fs.readFileSync(planPath, 'utf8');
  const nextDigest = previewEdit(root,
    [{ kind: 'set_task_text', anchor_id: requirementAnchor, item: 0, text: BEHAVIORAL_TEXT }]);

  const applied = run(root, 'amend:later-baseline', 'amend_baseline', {
    authority: 'user:instruction-later-baseline',
    source: { source_id: 'source:plan', expected_sha256: digestOf(before), expected_source_revision: 1 },
    edits: [{ kind: 'set_task_text', anchor_id: requirementAnchor, item: 0, text: BEHAVIORAL_TEXT }],
    items: [offlineItemInput(nextDigest)],
    plan_updates: [] });
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(applied.json.receipt.status, 'saved', applied.stdout);

  const read = invoke(root, 'read');
  const history = read.json.plans.find(entry => entry.id === 'plan:history');
  assert.equal(history.declared_lifecycle, 'completed', 'The declared completion stands');
  assert.equal(history.alignment, 'unassessed', 'Alignment with the later baseline is unassessed, not reopened');
  assert.equal(history.baseline_reference_status, 'stale');
  assert.deepEqual(history.baseline_refs, [{ item_id: 'requirement:offline', item_revision: 1 }]);
  assert.equal(history.revision, historyRegistration.revision, 'No new plan revision was manufactured');
  assert.equal(history.native_runs.length, 0);
  assert.equal(Object.hasOwn(history, 'last_transition'), false, 'No transition was replayed');
  const fact = read.json.invalidations.find(entry => entry.item_id === 'requirement:offline');
  assert.equal(fact.affected.find(entry => entry.plan_id === 'plan:history').carried_forward, false);
});

test('an acceptance without authority is refused with zero baseline effect', () => {
  const { root, planPath } = setupProject('missing-authority');
  const before = fs.readFileSync(planPath, 'utf8');
  const requirementAnchor = anchorFor(root, 'Requirement — Offline operation');
  const nextDigest = previewEdit(root,
    [{ kind: 'set_task_text', anchor_id: requirementAnchor, item: 0, text: BEHAVIORAL_TEXT }]);

  // A recorded proposal exists and stays proposed; the amendment omits the
  // authority reference entirely.
  const proposed = run(root, 'proposal:unauthorized', 'record_baseline_proposal', {
    id: 'proposal:unauthorized', summary: 'Unauthorized suggestion',
    patches: [], options: [],
    impact: { item_ids: [], plan_ids: [], architecture_ids: [] }, evidence_observation_ids: [] });
  assert.equal(proposed.json.receipt.status, 'saved', proposed.stdout);
  const stateBefore = stateBytes(root);

  const payload = {
    source: { source_id: 'source:plan', expected_sha256: digestOf(before), expected_source_revision: 1 },
    edits: [{ kind: 'set_task_text', anchor_id: requirementAnchor, item: 0, text: BEHAVIORAL_TEXT }],
    items: [offlineItemInput(nextDigest)],
    plan_updates: [] };
  const refused = run(root, 'amend:no-authority', 'amend_baseline', payload);
  assert.notEqual(refused.status, 0, 'An acceptance without authority must be refused');
  assert.match(refused.stderr, /^MISSING_FIELD\n$/);
  assert.equal(refused.stdout, '', 'A refused acceptance must not emit an accepted snapshot');

  const empty = run(root, 'amend:empty-authority', 'amend_baseline', { ...payload, authority: '' });
  assert.notEqual(empty.status, 0);
  assert.match(empty.stderr, /^INVALID_VALUE\n$/);

  assert.equal(fs.readFileSync(planPath, 'utf8'), before, 'The original was never rewritten');
  assert.deepEqual(stateBytes(root).compare(stateBefore), 0, 'The accepted state never moved');
  const stored = stateOf(root);
  assert.equal(stored.baseline_revision, 1);
  assert.equal(stored.items.find(entry => entry.id === 'requirement:offline').revision, 1);
  assert.equal(stored.proposals.find(entry => entry.id === 'proposal:unauthorized').state, 'proposed',
    'The suggestion stays a proposal without acceptance authority');
});

test('an accepted amendment replays idempotently', () => {
  const { root, planPath } = setupProject('idempotent-replay');
  const requirementAnchor = anchorFor(root, 'Requirement — Offline operation');
  const before = fs.readFileSync(planPath, 'utf8');
  const nextDigest = previewEdit(root,
    [{ kind: 'set_task_text', anchor_id: requirementAnchor, item: 0, text: BEHAVIORAL_TEXT }]);
  const amendment = { schema_version: 1, command_id: 'amend:replay', project_id: PROJECT_ID,
    expected_revision: stateOf(root).revision, operation: 'amend_baseline', payload: {
      authority: 'user:instruction-replay',
      source: { source_id: 'source:plan', expected_sha256: digestOf(before), expected_source_revision: 1 },
      edits: [{ kind: 'set_task_text', anchor_id: requirementAnchor, item: 0, text: BEHAVIORAL_TEXT }],
      items: [offlineItemInput(nextDigest)],
      plan_updates: [{ plan_id: 'plan:delivery',
        baseline_refs: [{ item_id: 'requirement:offline', item_revision: 2 }] }] } };

  const applied = invoke(root, 'command', amendment);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(applied.json.receipt.status, 'saved', applied.stdout);
  const after = fs.readFileSync(planPath, 'utf8');
  const stored = stateOf(root);

  const replay = invoke(root, 'command', amendment);
  assert.equal(replay.status, 0, replay.stderr);
  assert.deepEqual(replay.json.receipt, applied.json.receipt,
    'A replayed amendment returns its original receipt');
  assert.equal(fs.readFileSync(planPath, 'utf8'), after, 'A replay rewrites nothing');
  const replayed = stateOf(root);
  assert.equal(replayed.revision, stored.revision);
  assert.equal(replayed.baseline_revision, stored.baseline_revision);
  assert.equal(replayed.receipts.length, replayed.revision);
  assert.equal(invoke(root, 'read').json.invalidations.length, 1, 'A replay does not duplicate invalidation facts');

  // Different content under the same command identity is a typed conflict.
  const conflicting = run(root, 'amend:replay', 'amend_baseline', {
    authority: 'user:instruction-other',
    source: { source_id: 'source:plan', expected_sha256: digestOf(before), expected_source_revision: 1 },
    edits: [], items: [offlineItemInput(digestOf(before))], plan_updates: [] });
  assert.notEqual(conflicting.status, 0);
  assert.match(conflicting.stderr, /^IDEMPOTENCY_CONFLICT\n$/);
});

test('hostile or incoherent amendments fail closed without side effects', () => {
  const { root, planPath } = setupProject('adversarial');
  const before = fs.readFileSync(planPath, 'utf8');
  const stateBefore = stateBytes(root);
  const requirementAnchor = anchorFor(root, 'Requirement — Offline operation');
  const digest = digestOf(before);
  const base = {
    authority: 'user:instruction-adversarial',
    source: { source_id: 'source:plan', expected_sha256: digest, expected_source_revision: 1 },
    edits: [{ kind: 'set_task_text', anchor_id: requirementAnchor, item: 0, text: 'Hostile replacement text' }],
    items: [offlineItemInput(digest)],
    plan_updates: [],
  };
  const attempts = [
    ['amend:unknown-plan', { ...base, plan_updates: [{ plan_id: 'plan:ghost', baseline_refs: [] }] }, /^UNKNOWN_PLAN\n$/],
    ['amend:historical-plan', { ...base, plan_updates: [{ plan_id: 'plan:history',
      baseline_refs: [{ item_id: 'requirement:offline', item_revision: 2 }] }] }, /^HISTORICAL_PLAN_IMMUTABLE\n$/],
    ['amend:future-revision', { ...base, plan_updates: [{ plan_id: 'plan:delivery',
      baseline_refs: [{ item_id: 'requirement:offline', item_revision: 99 }] }] }, /^INVALID_REFERENCE\n$/],
    ['amend:empty-items', { ...base, items: [] }, /^EMPTY_CHANGE\n$/],
    ['amend:unknown-proposal', { ...base, proposal_id: 'proposal:ghost' }, /^UNKNOWN_PROPOSAL\n$/],
    ['amend:stale-source', { ...base,
      source: { source_id: 'source:plan', expected_sha256: digest, expected_source_revision: 7 } },
      /^SOURCE_REVISION_CONFLICT\n$/],
    ['amend:foreign-source-digest', { ...base,
      items: [offlineItemInput(sha256(Buffer.from('forged digest content')))] }, /^SOURCE_REVISION_MISMATCH\n$/],
  ];
  for (const [id, payload, code] of attempts) {
    const refused = run(root, id, 'amend_baseline', payload);
    assert.notEqual(refused.status, 0, `${id} must be refused`);
    assert.match(refused.stderr, code, `${id} must fail with its typed code`);
    assert.equal(refused.stdout, '');
    assert.equal(fs.readFileSync(planPath, 'utf8'), before, `${id} must not rewrite the original`);
    assert.deepEqual(stateBytes(root).compare(stateBefore), 0, `${id} must not move accepted state`);
  }

  // A proposal targeting a different source cannot be accepted by an
  // amendment of this source.
  const proposed = run(root, 'proposal:elsewhere', 'record_baseline_proposal', {
    id: 'proposal:elsewhere', summary: 'Targets the history document',
    patches: [{ source_id: 'source:history', anchor_id: 'document',
      current_sha256: digestOf(HISTORY), proposed_text: '# Replacement' }],
    options: [], impact: { item_ids: [], plan_ids: [], architecture_ids: [] }, evidence_observation_ids: [] });
  assert.equal(proposed.json.receipt.status, 'saved', proposed.stdout);
  const mismatch = run(root, 'amend:proposal-mismatch', 'amend_baseline',
    { ...base, edits: [], proposal_id: 'proposal:elsewhere' });
  assert.notEqual(mismatch.status, 0);
  assert.match(mismatch.stderr, /^PROPOSAL_SOURCE_MISMATCH\n$/);
  assert.equal(stateOf(root).proposals.find(entry => entry.id === 'proposal:elsewhere').state, 'proposed');
});

test('the contract itself refuses the .lazyseries registry namespace', () => {
  const { root } = setupProject('registry-namespace');
  // The bare model/CLI route, not any compose layer, must refuse registry paths.
  for (const hostile of ['.lazyseries/project.json', '.lazyseries/anything/else.md', '.LazySeries/project.json']) {
    const refused = run(root, 'artifact:registry-hostile', 'artifact.register',
      { id: 'artifact:registry', type: 'verification_report', producer: 'probe', path: hostile });
    assert.notEqual(refused.status, 0, `${hostile} must be refused by the contract`);
    assert.match(refused.stderr, /^PROTECTED_REGISTRY_PATH\n$/, `${hostile} must fail with the typed code`);
  }
  // A registry path as a registered SOURCE is also refused fail-closed: the
  // bridge's markdown-only capture rule rejects it before the contract, and
  // the contract refuses any .md under the namespace regardless.
  const refusedSource = run(root, 'source:registry-hostile', 'register_source',
    { id: 'source:registry', path: '.lazyseries/project.json', role: 'requirements' });
  assert.notEqual(refusedSource.status, 0);
  assert.match(refusedSource.stderr, /^[A-Z_]+\n$/, 'A typed refusal, never an accepted registration');
  write(root, '.lazyseries/notes.md', '# Stray markdown inside the registry namespace\n');
  const refusedMarkdown = run(root, 'source:registry-markdown', 'register_source',
    { id: 'source:registry-md', path: '.lazyseries/notes.md', role: 'requirements' });
  assert.notEqual(refusedMarkdown.status, 0);
  assert.match(refusedMarkdown.stderr, /^PROTECTED_REGISTRY_PATH\n$/,
    'A markdown path inside the namespace reaches the contract and is refused there');
  assert.ok(fs.existsSync(path.join(root, '.lazyseries/project.json')),
    'The live registry itself stays untouched');

  // Ordinary artifact and source paths still register through the same route.
  const saved = run(root, 'artifact:ordinary', 'artifact.register',
    { id: 'artifact:report', type: 'verification_report', producer: 'probe', path: 'docs/evidence/report.txt' });
  assert.equal(saved.status, 0, saved.stderr);
  assert.equal(saved.json.receipt.status, 'saved', saved.stdout);
  assert.deepEqual(invoke(root, 'read').json.artifacts.map(entry => entry.id), ['artifact:report']);
});
